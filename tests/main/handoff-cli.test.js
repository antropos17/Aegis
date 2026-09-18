import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const cli = require('../../src/main/cli');
let root;
let file;
let output;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-handoff-cli-'));
  file = path.join(root, 'events.jsonl');
  output = [];
  cli._setDepsForTest({ writeFn: (text) => output.push(text) });
  fs.writeFileSync(
    file,
    JSON.stringify({
      hook_event_name: 'SubagentStart',
      session_id: 'PRIVATE_SESSION',
      agent_id: 'PRIVATE_AGENT',
    }) + '\n',
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  cli._resetForTest();
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

it.each(
  [
    [],
    ['claude-code'],
    ['PRIVATE'],
    ['claude-code', '--PRIVATE'],
    ['claude-code', 'x', 'PRIVATE'],
  ].map((args) => ({ args })),
)('rejects malformed arguments $args without echo', async ({ args }) => {
  expect(await cli.handleCLI(['--handoff-import-json', ...args])).toBe(1);
  expect(JSON.parse(output[0])).toEqual({ error: 'expected-handoff-import-arguments' });
});

it('rejects an unsupported adapter without reading', async () => {
  expect(await cli.handleCLI(['--handoff-import-json', 'PRIVATE', file])).toBe(1);
  expect(JSON.parse(output[0])).toEqual({ error: 'handoff-adapter-unsupported' });
});

it('distinguishes complete input, incomplete input and unavailable input', async () => {
  const args = ['--handoff-import-json', 'claude-code', file];
  expect(await cli.handleCLI(args)).toBe(0);
  fs.appendFileSync(file, '{PRIVATE\n');
  expect(await cli.handleCLI(args)).toBe(2);
  fs.unlinkSync(file);
  expect(await cli.handleCLI(args)).toBe(1);
  expect(output.join('')).not.toContain('PRIVATE');
});

it('runs real main.js before Electron starts and writes only redacted JSON', () => {
  const result = spawnSync(
    process.execPath,
    ['src/main/main.js', '--handoff-import-json', 'claude-code', file],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('PRIVATE');
  expect(JSON.parse(result.stdout)).toMatchObject({
    counts: { accepted: 1 },
    processBinding: 'unbound',
  });
  fs.appendFileSync(file, '{PRIVATE_PARSER_ERROR\n');
  const invalid = spawnSync(
    process.execPath,
    ['src/main/main.js', '--handoff-import-json', 'claude-code', file],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(invalid.status).toBe(2);
  expect(invalid.stderr).toBe('');
  expect(invalid.stdout).not.toContain('PRIVATE');
  expect(JSON.parse(invalid.stdout).diagnostics).toEqual([
    { code: 'invalid-json-record', record: 2 },
  ]);
});

it('does not initialize the monitoring, scoring or audit pipeline', () => {
  const program = `
    const before = new Set(Object.keys(require.cache));
    require('./src/main/handoff-import').importHandoffEvents('claude-code', process.argv[1]).then(() => {
      const loaded = Object.keys(require.cache).filter(p => !before.has(p));
      const names = loaded.map(p => require('node:path').basename(p)).sort();
      process.stdout.write(JSON.stringify(names));
    });`;
  const result = spawnSync(process.execPath, ['-e', program, file], {
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['handoff-import.js', 'handoff-reader.js']);
});
