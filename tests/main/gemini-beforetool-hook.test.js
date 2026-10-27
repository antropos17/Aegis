import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const hook = require('../../src/main/gemini-beforetool-hook');
const json = (value) => Buffer.from(JSON.stringify(value));
const DENY = { decision: 'deny', reason: 'AEGIS policy does not allow this tool request.' };
let root;
let policyPath;
let shellInput;

const policy = (extra = {}) => ({
  schemaVersion: 1,
  provider: 'gemini-cli',
  hook: 'BeforeTool',
  cwd: root,
  tool: 'run_shell_command',
  deny: [shellInput],
  ...extra,
});
const request = (extra = {}) => ({
  hook_event_name: 'BeforeTool',
  tool_name: 'run_shell_command',
  cwd: root,
  tool_input: shellInput,
  session_id: 'PRIVATE_SESSION',
  transcript_path: 'PRIVATE_TRANSCRIPT',
  ...extra,
});
const evaluate = async (p = policy(), r = request()) => {
  fs.writeFileSync(policyPath, Buffer.isBuffer(p) ? p : json(p));
  return hook.evaluateGeminiBeforeTool(policyPath, Buffer.isBuffer(r) ? r : json(r));
};

function launch(args, input, keepOpen = false) {
  const child = spawn(process.execPath, ['src/main/main.js', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdin.on('error', () => {});
  if (keepOpen) child.stdin.write(input);
  else child.stdin.end(input);
  const timer = setTimeout(() => child.kill(), 6000);
  return once(child, 'close').then(([code]) => {
    clearTimeout(timer);
    return { code, stdout, stderr };
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gemini-hook-'));
  policyPath = path.join(root, 'policy.json');
  shellInput = {
    command: 'Get-Content -LiteralPath "PRIVATE_FILE" | Out-Null',
    description: 'Read PRIVATE_FILE',
    dir_path: root,
    is_background: false,
  };
});

afterEach(() => {
  hook._resetForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Gemini BeforeTool exact denial', () => {
  it('exports the same policy validation used for an exact denial', () => {
    expect(hook.validGeminiPolicy(policy())).toBe(true);
    expect(hook.validGeminiPolicy(policy({ deny: [] }))).toBe(false);
    expect(hook.validGeminiPolicy(policy({ provider: 'other' }))).toBe(false);
  });
  it('denies the complete PowerShell argument object, regardless of JSON key order', async () => {
    const reordered = {
      is_background: false,
      dir_path: root,
      description: 'Read PRIVATE_FILE',
      command: 'Get-Content -LiteralPath "PRIVATE_FILE" | Out-Null',
    };
    expect(await evaluate(policy(), request({ tool_input: reordered }))).toBe(true);
    expect(request()).not.toHaveProperty('tool_use_id');
  });

  it('returns no decision when the command or any optional argument changes', async () => {
    for (const changed of [
      { command: shellInput.command + ' ' },
      { command: shellInput.command.toLowerCase() },
      { command: 'powershell -Command ' + shellInput.command },
      { description: 'Changed' },
      { dir_path: root + path.sep },
      { is_background: true },
      { extra: 'PRIVATE_EXTRA' },
    ]) {
      expect(await evaluate(policy(), request({ tool_input: { ...shellInput, ...changed } }))).toBe(
        false,
      );
    }
    expect(await evaluate(policy(), request({ tool_input: { command: shellInput.command } }))).toBe(
      false,
    );
  });

  it('ignores other valid events and tools without opening the policy', async () => {
    for (const extra of [
      { hook_event_name: 'AfterTool' },
      { tool_name: 'read_file' },
      { tool_name: 'Bash' },
    ]) {
      expect(await hook.evaluateGeminiBeforeTool('MISSING_POLICY', json(request(extra)))).toBe(
        false,
      );
    }
  });

  it('denies invalid in-scope input and cwd mismatches with no parser detail', async () => {
    for (const invalid of [
      Buffer.from([0xff]),
      Buffer.from('{"PRIVATE_PARSE_ERROR":'),
      json(request({ cwd: 'relative' })),
      json(request({ cwd: root + path.sep })),
      json(request({ tool_input: null })),
      json(request({ tool_input: { command: 3 } })),
      json(request({ hook_event_name: null })),
    ]) {
      expect(await evaluate(policy(), invalid)).toBe(true);
    }
  });

  it('rejects malformed, unknown, permissive, duplicate, and oversized policies', async () => {
    for (const invalid of [
      Buffer.from('{PRIVATE_POLICY_PARSE'),
      policy({ extra: 'PRIVATE' }),
      policy({ provider: 'claude-code' }),
      policy({ defaultDecision: 'allow' }),
      policy({ deny: [] }),
      policy({ deny: [shellInput, { ...shellInput }] }),
      policy({
        deny: Array.from({ length: hook.LIMITS.rules + 1 }, (_, i) => ({ command: `${i}` })),
      }),
      Buffer.alloc(hook.LIMITS.inputBytes + 1, 65),
    ]) {
      expect(await evaluate(invalid)).toBe(true);
    }
  });

  it('rereads changed policy and rejects missing, directory, junction, and stream paths', async () => {
    expect(await evaluate()).toBe(true);
    fs.writeFileSync(policyPath, json(policy({ deny: [{ command: 'other' }] })));
    expect(await hook.evaluateGeminiBeforeTool(policyPath, json(request()))).toBe(false);
    fs.unlinkSync(policyPath);
    expect(await hook.evaluateGeminiBeforeTool(policyPath, json(request()))).toBe(true);
    expect(await hook.evaluateGeminiBeforeTool(root, json(request()))).toBe(true);
    expect(await hook.evaluateGeminiBeforeTool(policyPath + ':PRIVATE', json(request()))).toBe(
      true,
    );

    const junction = path.join(root, 'policy-link');
    if (process.platform === 'win32') fs.symlinkSync(root, junction, 'junction');
    else fs.symlinkSync(root, junction);
    try {
      expect(await hook.evaluateGeminiBeforeTool(junction, json(request()))).toBe(true);
    } finally {
      fs.unlinkSync(junction);
    }
  });

  it('denies a detected policy mutation during read', async () => {
    fs.writeFileSync(policyPath, json(policy()));
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const read = handle.read.bind(handle);
      handle.read = async (...values) => {
        const result = await read(...values);
        fs.appendFileSync(policyPath, ' ');
        return result;
      };
      return handle;
    });
    expect(await hook.evaluateGeminiBeforeTool(policyPath, json(request()))).toBe(true);
  });
});

describe('Gemini hook CLI boundary', () => {
  it('exposes only a nonmatch as exit zero, without child output', async () => {
    fs.writeFileSync(policyPath, json(policy()));
    for (const [input, code] of [
      [json(request()), 1],
      [json(request({ tool_input: { command: 'Write-Output PRIVATE_OTHER' } })), 0],
      [json(request({ hook_event_name: 'OtherEvent' })), 0],
      [Buffer.from('{"command":"PRIVATE_BAD"'), 1],
      [Buffer.alloc(0), 1],
    ]) {
      const result = await launch(['--gemini-beforetool-exit-code', policyPath], input);
      expect(result).toEqual({ code, stdout: '', stderr: '' });
    }
    fs.writeFileSync(policyPath, 'invalid policy');
    const invalid = await launch(['--gemini-beforetool-exit-code', policyPath], json(request()));
    expect(invalid).toEqual({ code: 1, stdout: '', stderr: '' });
  });

  it('returns nonzero for invalid or mixed CLI flags and an open producer', async () => {
    for (const badArgs of [
      ['--gemini-beforetool-exit-code'],
      ['--gemini-beforetool-exit-code', policyPath, 'PRIVATE_EXTRA'],
      ['PRIVATE_ARG', '--gemini-beforetool-exit-code', policyPath],
      ['--action-policy-hook', '--gemini-beforetool-exit-code', policyPath],
      ['--gemini-beforetool-hook', '--gemini-beforetool-exit-code', policyPath],
      ['--gemini-beforetool-exit-code', policyPath, '--gemini-beforetool-hook'],
    ]) {
      const result = await launch(badArgs, 'PRIVATE_ARG');
      expect(result).toEqual({ code: 1, stdout: '', stderr: '' });
    }
    const held = await launch(['--gemini-beforetool-exit-code', policyPath], '{"PRIVATE":', true);
    expect(held).toEqual({ code: 1, stdout: '', stderr: '' });
  }, 8000);

  it.each(['throw', 'reject', 'invalid'])('treats %s evaluator output as nonzero', async (type) => {
    const input = new PassThrough();
    hook._setDepsForTest({
      input,
      evaluate: () => {
        if (type === 'throw') throw Error('PRIVATE_ERROR');
        if (type === 'reject') return Promise.reject(Error('PRIVATE_ERROR'));
        return null;
      },
    });
    const done = hook.handleGeminiBeforeToolExitCode(['--gemini-beforetool-exit-code', policyPath]);
    input.end('{}');
    expect(await done).toBe(1);
  });

  it('returns nonzero on oversized input and never changes a timed-out decision', async () => {
    const input = new PassThrough();
    const evaluator = vi.fn();
    hook._setDepsForTest({ input, evaluate: evaluator });
    const oversized = hook.handleGeminiBeforeToolExitCode([
      '--gemini-beforetool-exit-code',
      policyPath,
    ]);
    input.write(Buffer.alloc(hook.LIMITS.inputBytes + 1, 65));
    expect(await oversized).toBe(1);
    expect(evaluator).not.toHaveBeenCalled();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const delayedInput = new PassThrough();
    let complete;
    hook._setDepsForTest({
      input: delayedInput,
      evaluate: () => new Promise((resolve) => (complete = resolve)),
    });
    const delayed = hook.handleGeminiBeforeToolExitCode([
      '--gemini-beforetool-exit-code',
      policyPath,
    ]);
    delayedInput.end('{}');
    await new Promise(setImmediate);
    await vi.advanceTimersByTimeAsync(hook.LIMITS.deadlineMs);
    expect(await delayed).toBe(1);
    complete(false);
    await new Promise(setImmediate);
  });

  it('uses one bounded JSON response and never prints private input or errors', async () => {
    fs.writeFileSync(policyPath, json(policy()));
    for (const [input, expected] of [
      [json(request()), DENY],
      [json(request({ tool_input: { command: 'Write-Output PRIVATE_OTHER' } })), {}],
      [Buffer.from('{"command":"PRIVATE_BAD"'), DENY],
    ]) {
      const result = await launch(['--gemini-beforetool-hook', policyPath], input);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim().split('\n').map(JSON.parse)).toEqual([expected]);
      expect(result.stdout).not.toContain('PRIVATE');
    }
  });

  it('returns fixed deny for invalid argv and for a producer that never closes stdin', async () => {
    for (const badArgs of [
      ['--gemini-beforetool-hook'],
      ['--gemini-beforetool-hook', policyPath, 'PRIVATE_EXTRA'],
      ['PRIVATE_ARG', '--gemini-beforetool-hook', policyPath],
    ]) {
      const bad = await launch(badArgs, 'PRIVATE_ARG');
      expect(bad.code).toBe(0);
      expect(bad.stderr).toBe('');
      expect(JSON.parse(bad.stdout)).toEqual(DENY);
      expect(bad.stdout).not.toContain('PRIVATE');
    }

    const hung = await launch(['--gemini-beforetool-hook', policyPath], '{"PRIVATE":', true);
    expect(hung.code).toBe(0);
    expect(hung.stderr).toBe('');
    expect(JSON.parse(hung.stdout)).toEqual(DENY);
  }, 8000);

  it('denies oversized stdin before evaluation and suppresses a late nonmatch', async () => {
    const input = new PassThrough();
    const output = [];
    const evaluator = vi.fn();
    hook._setDepsForTest({ input, evaluate: evaluator });
    const done = hook.handleGeminiBeforeToolHook(['--gemini-beforetool-hook', policyPath], (text) =>
      output.push(text),
    );
    input.write(Buffer.alloc(hook.LIMITS.inputBytes + 1, 65));
    expect(await done).toBe(0);
    expect(evaluator).not.toHaveBeenCalled();
    expect(output.map(JSON.parse)).toEqual([DENY]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let complete;
    const input2 = new PassThrough();
    const output2 = [];
    hook._setDepsForTest({
      input: input2,
      evaluate: () => new Promise((resolve) => (complete = resolve)),
    });
    const done2 = hook.handleGeminiBeforeToolHook(
      ['--gemini-beforetool-hook', policyPath],
      (text) => output2.push(text),
    );
    input2.end('{}');
    await new Promise(setImmediate);
    await vi.advanceTimersByTimeAsync(hook.LIMITS.deadlineMs);
    expect(await done2).toBe(0);
    complete(false);
    await new Promise(setImmediate);
    expect(output2.map(JSON.parse)).toEqual([DENY]);
  });
});
