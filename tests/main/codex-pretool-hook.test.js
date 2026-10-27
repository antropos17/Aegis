import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const hook = require('../../src/main/codex-pretool-hook');
const dirs = [];
const deny = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'AEGIS policy does not allow this tool request.',
  },
};
const ask = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'AEGIS policy requires review; this Codex hook cannot request approval.',
  },
};
const payload = (
  cwd,
  toolInput = { command: 'echo private', description: 'PRIVATE_DESCRIPTION', timeout: 2000 },
) => ({
  session_id: 'private-session',
  transcript_path: path.join(cwd, 'private-transcript.jsonl'),
  cwd,
  hook_event_name: 'PreToolUse',
  model: 'selected-model',
  permission_mode: 'default',
  turn_id: 'private-turn',
  tool_name: 'Bash',
  tool_use_id: 'private-use',
  tool_input: toolInput,
});
function policy(rules = [], defaultDecision = 'deny') {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-codex-hook-'));
  const file = path.join(directory, 'policy.json');
  dirs.push({ directory, file });
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, cwd: directory, defaultDecision, rules }),
    { flag: 'wx' },
  );
  return { directory, file };
}
function boundary() {
  const input = new PassThrough();
  const output = [];
  hook._setDepsForTest({ input });
  return {
    input,
    output,
    run: (file) =>
      hook.handleCodexPreToolHook(['--codex-pretool-hook', file], (text) => output.push(text)),
  };
}
afterEach(() => {
  hook._resetForTest();
  vi.useRealTimers();
  for (const { directory, file } of dirs.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
    expect(path.basename(directory)).toMatch(/^aegis-codex-hook-/);
    unlinkSync(file);
    rmdirSync(directory);
  }
});

it('accepts the full documented envelope and matches all tool input fields with no override on allow', async () => {
  const input = { command: 'echo private', description: 'PRIVATE_DESCRIPTION', timeout: 2000 };
  const { directory, file } = policy([{ tool: 'Bash', input, decision: 'allow' }]);
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify(payload(directory, input)));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([{}]);
  expect(t.output.join()).not.toMatch(/PRIVATE|private|session|transcript|echo/);
});

it.each([
  ['deny', 'deny'],
  ['ask', 'ask'],
])('emits the fixed provider denial for shared policy %s', async (decision, expected) => {
  const input = { command: 'echo private', description: 'PRIVATE_DESCRIPTION', timeout: 2000 };
  const { directory, file } = policy([{ tool: 'Bash', input, decision }]);
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify(payload(directory, input)));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([expected === 'ask' ? ask : deny]);
  expect(t.output.join()).not.toMatch(/PRIVATE|private|session|transcript|echo/);
});

it('does not promote project review ask to an allow or unsupported provider ask', async () => {
  const { directory, file } = policy();
  writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 2,
      cwd: directory,
      profile: 'aegis-windows-project-review-v1',
    }),
  );
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify(payload(directory, { command: 'pwd' })));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([ask]);
});

it('retains the complete input when an otherwise allowed command has changed metadata', async () => {
  const input = { command: 'echo private', description: 'PRIVATE_DESCRIPTION', timeout: 2000 };
  const { directory, file } = policy([{ tool: 'Bash', input, decision: 'allow' }]);
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify(payload(directory, { ...input, timeout: 2001 })));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([deny]);
});

it.each([
  (v) => ({ ...v, turn_id: '' }),
  (v) => ({ ...v, model: null }),
  (v) => ({ ...v, permission_mode: 'unknown' }),
  (v) => ({ ...v, transcript_path: { private: 'PRIVATE_PATH' } }),
  (v) => ({ ...v, tool_name: 'apply_patch' }),
  (v) => ({ ...v, tool_input: null }),
  (v) => ({ ...v, unsupported: 'PRIVATE_FIELD' }),
  (v) => {
    const copy = { ...v };
    delete copy.turn_id;
    return copy;
  },
])('fails closed for malformed or unsupported envelope %#', async (change) => {
  const { directory, file } = policy();
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify(change(payload(directory))));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([deny]);
  expect(t.output.join()).not.toMatch(/PRIVATE|private/);
});

it('rejects duplicate keys instead of choosing one spelling', async () => {
  const { directory, file } = policy();
  const t = boundary();
  const value = JSON.stringify(payload(directory)).replace(
    '"tool_name":"Bash"',
    '"tool_name":"Bash","tool_name":"apply_patch"',
  );
  const result = t.run(file);
  t.input.end(value);
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([deny]);
});

it('accepts the documented null transcript path without reading a transcript', async () => {
  const input = { command: 'pwd' };
  const { directory, file } = policy([{ tool: 'Bash', input, decision: 'allow' }]);
  const t = boundary();
  const result = t.run(file);
  t.input.end(JSON.stringify({ ...payload(directory, input), transcript_path: null }));
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([{}]);
});

it('denies invalid JSON and bad hook arguments with fixed output', async () => {
  const t = boundary();
  const result = t.run('PRIVATE_POLICY_PATH');
  t.input.end('{"private":');
  expect(await result).toBe(0);
  expect(t.output.map(JSON.parse)).toEqual([deny]);
  const other = boundary();
  expect(
    await hook.handleCodexPreToolHook(['wrong-flag', 'PRIVATE_POLICY_PATH'], (text) =>
      other.output.push(text),
    ),
  ).toBe(0);
  expect(other.output.map(JSON.parse)).toEqual([deny]);
});

it('denies a stalled evaluator by the same deadline and emits no late response', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const input = new PassThrough();
  const output = [];
  let release;
  hook._setDepsForTest({
    input,
    evaluate: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const result = hook.handleCodexPreToolHook(['--codex-pretool-hook', 'PRIVATE_POLICY'], (text) =>
    output.push(text),
  );
  input.end(JSON.stringify(payload(path.resolve(tmpdir()), { command: 'pwd' })));
  await vi.advanceTimersByTimeAsync(hook.LIMITS.deadlineMs);
  expect(await result).toBe(0);
  expect(output.map(JSON.parse)).toEqual([deny]);
  release({ decision: 'allow' });
  await Promise.resolve();
  expect(output.map(JSON.parse)).toEqual([deny]);
});

it.each(['oversize', 'timeout', 'stream-error'])(
  'emits one fixed denial for %s',
  async (failure) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const t = boundary();
    const result = t.run('PRIVATE_POLICY_PATH');
    if (failure === 'oversize') t.input.write(Buffer.alloc(hook.LIMITS.inputBytes + 1, 65));
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(hook.LIMITS.deadlineMs);
    if (failure === 'stream-error') t.input.destroy(Error('PRIVATE_STREAM'));
    expect(await result).toBe(0);
    expect(t.input.destroyed).toBe(true);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
  },
);

it('uses the inherited Windows Electron pipe and fails closed if the pipe cannot be opened', async () => {
  const input = new PassThrough();
  const fallback = new PassThrough();
  fallback.end();
  const createSocket = vi.fn(() => input);
  const output = [];
  hook._setDepsForTest({
    runtime: { platform: 'win32', versions: { electron: '45.0.0' }, stdin: fallback },
    createSocket,
  });
  const result = hook.handleCodexPreToolHook(['--codex-pretool-hook', 'PRIVATE_POLICY'], (text) =>
    output.push(text),
  );
  input.end('{}');
  expect(await result).toBe(0);
  expect(createSocket).toHaveBeenCalledExactlyOnceWith({ fd: 0, readable: true, writable: false });
  expect(output.map(JSON.parse)).toEqual([deny]);
  const failed = [];
  hook._setDepsForTest({
    runtime: { platform: 'win32', versions: { electron: '45.0.0' } },
    createSocket: () => {
      throw Error('PRIVATE');
    },
  });
  expect(
    await hook.handleCodexPreToolHook(['--codex-pretool-hook', 'PRIVATE_POLICY'], (text) =>
      failed.push(text),
    ),
  ).toBe(0);
  expect(failed.map(JSON.parse)).toEqual([deny]);
});

it('passes the inherited Windows pipe bytes unchanged to the shared evaluator', async () => {
  const input = new PassThrough();
  const fallback = new PassThrough();
  fallback.end();
  const expected = Buffer.from(JSON.stringify(payload(path.resolve(tmpdir()), { command: 'pwd' })));
  let captured;
  const output = [];
  hook._setDepsForTest({
    runtime: { platform: 'win32', versions: { electron: '45.0.0' }, stdin: fallback },
    createSocket: () => input,
    evaluate: async (_file, raw) => {
      captured = Buffer.from(raw);
      return { decision: 'allow' };
    },
  });
  const result = hook.handleCodexPreToolHook(['--codex-pretool-hook', 'PRIVATE_POLICY'], (text) =>
    output.push(text),
  );
  input.end(expected);
  expect(await result).toBe(0);
  expect(captured).toEqual(expected);
  expect(output.map(JSON.parse)).toEqual([{}]);
  captured.fill(0);
  expected.fill(0);
});

it('returns output failure when the response cannot be written', async () => {
  const t = boundary();
  const result = hook.handleCodexPreToolHook(['--codex-pretool-hook', 'PRIVATE_POLICY'], () => {
    throw Error('PRIVATE');
  });
  t.input.end('{}');
  expect(await result).toBe(2);
});
