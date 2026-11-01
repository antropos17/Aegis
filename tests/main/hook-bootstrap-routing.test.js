import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const probe = fileURLToPath(new URL('../fixtures/hook-bootstrap.cjs', import.meta.url));
const source = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
const policy = fileURLToPath(
  new URL('../fixtures/bootstrap-policy-does-not-exist.json', import.meta.url),
);
const owned = '--aegis-owned-gui-profile';
const nativeProfile = `--user-data-dir=${path.resolve(tmpdir(), 'aegis-bootstrap-native-profile')}`;
const hooks = [
  ['--action-policy-hook', 0, 'claude'],
  ['--action-policy-after-hook', 0, 'silent'],
  ['--gemini-beforetool-hook', 0, 'gemini'],
  ['--gemini-beforetool-exit-code', 1, 'silent'],
];

function launch(argv, input = 'MALFORMED_PROVIDER_INPUT') {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(NODE_OPTIONS|NODE_DEBUG.*|NODE_COMPILE_CACHE|ELECTRON_.*|AEGIS_CLAUDE_GUARD_.*)$/i.test(
          key,
        ),
    ),
  );
  const result = spawnSync(process.execPath, [probe, JSON.stringify(argv)], {
    env,
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  return result;
}

function refusedHook(result, code, output) {
  expect(result.status).toBe(code);
  expect(result.stderr).toBe('');
  if (output === 'silent') expect(result.stdout).toBe('');
  else if (output === 'gemini')
    expect(JSON.parse(result.stdout)).toEqual({
      decision: 'deny',
      reason: 'AEGIS policy does not allow this tool request.',
    });
  else
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'AEGIS policy does not allow this tool request.',
      },
    });
}

describe('hook startup before GUI initialization', () => {
  it('evaluates the same selected allow policy through direct, spacer and source forms', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aegis-hook-bootstrap-'));
    const selected = path.join(directory, 'policy.json');
    writeFileSync(
      selected,
      JSON.stringify({
        schemaVersion: 1,
        cwd: directory,
        defaultDecision: 'deny',
        rules: [{ tool: 'Bash', input: { command: 'pwd' }, decision: 'allow' }],
      }),
    );
    try {
      const input = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        session_id: 'fixture-session',
        tool_use_id: 'fixture-tool',
        cwd: directory,
        tool_input: { command: 'pwd' },
      });
      for (const prefix of [[], ['app.asar'], [source]]) {
        const result = launch([...prefix, '--action-policy-hook', selected], input);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
      }
      for (const argv of [
        [nativeProfile, '--action-policy-hook', selected],
        ['--action-policy-hook', nativeProfile, selected],
        ['--action-policy-hook', selected, nativeProfile],
        [nativeProfile, 'app.asar', '--action-policy-hook', selected],
        ['app.asar', '--action-policy-hook', selected, nativeProfile],
      ]) {
        const result = launch(argv, input);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
      }
    } finally {
      unlinkSync(selected);
      rmdirSync(directory);
    }
  });

  it.each(hooks)('routes direct packaged %s without importing Electron', (flag, code, output) => {
    refusedHook(launch([flag, policy]), code, output);
  });

  it.each(hooks)('retains spacer and source routing for %s', (flag, code, output) => {
    for (const spacer of ['app.asar', source])
      refusedHook(launch([spacer, flag, policy]), code, output);
  });

  it.each(hooks)('normalizes one exact native profile option for %s', (flag, code, output) => {
    for (const argv of [
      [nativeProfile, flag, policy],
      [flag, nativeProfile, policy],
      [flag, policy, nativeProfile],
      ['app.asar', nativeProfile, flag, policy],
    ])
      refusedHook(launch(argv), code, output);
  });

  it.each(hooks)('refuses malformed native profile options for %s', (flag, code, output) => {
    for (const options of [
      ['--user-data-dir='],
      ['--user-data-dir=relative'],
      ['--user-data-dir', policy],
      ['--USER-DATA-DIR=' + path.resolve(tmpdir(), 'uppercase')],
      ['--user-data-directory=' + path.resolve(tmpdir(), 'near-spelling')],
      [nativeProfile, nativeProfile],
      [nativeProfile, owned, policy],
    ])
      refusedHook(
        launch([flag, policy, ...options]),
        flag === '--action-policy-hook' ? 2 : code,
        output,
      );
  });

  it.each(hooks)('refuses malformed direct %s before GUI initialization', (flag, code, output) => {
    for (const argv of [
      [flag],
      [flag, policy, 'EXTRA'],
      [flag, policy, owned, policy],
      [owned, flag, policy],
    ])
      refusedHook(launch(argv), flag === '--action-policy-hook' ? 2 : code, output);
  });

  it('rejects mixed pre/after modes without importing Electron', () => {
    refusedHook(
      launch(['--action-policy-hook', policy, '--action-policy-after-hook']),
      2,
      'claude',
    );
  });

  it('retains Claude refusal precedence when a Gemini JSON hook appears first', () => {
    refusedHook(launch(['--gemini-beforetool-hook', policy, '--action-policy-hook']), 2, 'claude');
  });

  it.each([[], ['app.asar'], [owned, policy], ['--version']])(
    'preserves ordinary GUI/direct non-hook routing for %j',
    (...argv) => {
      const result = launch(argv);
      expect(result.status).toBe(93);
      expect(result.stderr).toBe('GUI_IMPORT_REFUSED\n');
      expect(result.stdout).toBe('');
    },
  );

  it('preserves the ordinary source CLI version route', () => {
    const result = launch([source, '--version']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const declared = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(result.stdout.trim()).toBe(declared.version);
  });
});
