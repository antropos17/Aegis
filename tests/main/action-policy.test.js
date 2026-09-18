import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { evaluateActionPolicy, LIMITS } = require('../../src/main/action-policy');
let root;
let file;
const action = { command: 'echo PRIVATE' };
const json = (v) => Buffer.from(JSON.stringify(v));
const policy = (extra = {}) => ({
  schemaVersion: 1,
  cwd: root,
  defaultDecision: 'deny',
  rules: [{ tool: 'Bash', input: action, decision: 'allow' }],
  ...extra,
});
const input = (extra = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'PRIVATE_SESSION',
  tool_use_id: 'PRIVATE_TOOL',
  tool_name: 'Bash',
  cwd: root,
  tool_input: action,
  ...extra,
});
async function run(p = policy(), i = input()) {
  fs.writeFileSync(file, Buffer.isBuffer(p) ? p : json(p));
  return evaluateActionPolicy(file, Buffer.isBuffer(i) ? i : json(i));
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-action-policy-'));
  file = path.join(root, 'policy.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('exact Bash policy decisions', () => {
  it.each(['allow', 'ask', 'deny'])('returns only fixed %s metadata', async (decision) => {
    const result = await run(policy({ rules: [{ tool: 'Bash', input: action, decision }] }));
    expect(result).toEqual({ decision, reason: `policy-${decision}` });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('compares all arguments and exact cwd without command/path normalization', async () => {
    for (const tool_input of [
      { command: 'echo PRIVATE ' },
      { command: 'echo PRIVATE', timeout: 10 },
      { command: 'echo PRIVATE', description: 'PRIVATE' },
      { command: ['echo PRIVATE'] },
    ]) {
      expect((await run(policy(), input({ tool_input }))).decision).toBe('deny');
    }
    expect(await run(policy(), input({ cwd: root + path.sep }))).toEqual({
      decision: 'deny',
      reason: 'scope-mismatch',
    });
  });

  it('delegates unmatched supported input to ask only when explicitly configured', async () => {
    expect(
      await run(policy({ defaultDecision: 'ask' }), input({ tool_input: { command: 'other' } })),
    ).toEqual({ decision: 'ask', reason: 'policy-ask' });
    for (const extra of [
      { tool_name: 'Write' },
      { hook_event_name: 'PostToolUse' },
      { cwd: path.dirname(root) },
    ])
      expect((await run(policy({ defaultDecision: 'ask' }), input(extra))).decision).toBe('deny');
  });

  it('handles key order, arrays, null, finite numbers, and prototype-looking own keys precisely', async () => {
    const full = JSON.parse(
      '{"command":"echo PRIVATE","__proto__":{"a":1},"constructor":null,"values":[1,"2",null]}',
    );
    const p = policy({ rules: [{ tool: 'Bash', input: full, decision: 'allow' }] });
    const reordered = JSON.parse(
      '{"values":[1,"2",null],"constructor":null,"__proto__":{"a":1},"command":"echo PRIVATE"}',
    );
    expect((await run(p, input({ tool_input: reordered }))).decision).toBe('allow');
    delete reordered.__proto__;
    expect((await run(p, input({ tool_input: reordered }))).decision).toBe('deny');
    Object.defineProperty(reordered, '__proto__', { value: { a: 1 }, enumerable: true });
    expect((await run(p, input({ tool_input: reordered }))).decision).toBe('allow');
    reordered.values = { 0: 1, 1: '2', 2: null };
    expect((await run(p, input({ tool_input: reordered }))).decision).toBe('deny');
    reordered.values = ['2', 1, null];
    expect((await run(p, input({ tool_input: reordered }))).decision).toBe('deny');
  });

  it('rejects conflicting or repeated rules even when property order differs', async () => {
    const rules = [
      { tool: 'Bash', input: { command: 'x', timeout: 1 }, decision: 'allow' },
      { tool: 'Bash', input: { timeout: 1, command: 'x' }, decision: 'deny' },
    ];
    expect(await run(policy({ rules }))).toEqual({ decision: 'deny', reason: 'policy-invalid' });
  });

  it.each([
    { schemaVersion: 2 },
    { defaultDecision: 'allow' },
    { extra: true },
    { rules: null },
    { rules: [{ tool: 'Write', input: action, decision: 'allow' }] },
    { rules: [{ tool: 'Bash', input: action, decision: 'permit' }] },
    { rules: [{ tool: 'Bash', input: action, decision: 'allow', comment: 'PRIVATE' }] },
    { cwd: 'relative' },
  ])('rejects unsupported policy schema %#', async (extra) => {
    expect(await run(policy(extra))).toEqual({ decision: 'deny', reason: 'policy-invalid' });
  });

  it.each([
    { session_id: '' },
    { tool_use_id: 'x'.repeat(257) },
    { session_id: 'x\n' },
    { tool_input: null },
    { cwd: 'relative' },
  ])('rejects incomplete input %#', async (extra) => {
    expect((await run(policy(), input(extra))).decision).toBe('deny');
  });

  it('ignores forged decisions/ownership and follows no referenced files', async () => {
    const open = vi.spyOn(fs.promises, 'open');
    expect(
      await run(
        policy(),
        input({
          decision: 'deny',
          verified: true,
          policy: 'PRIVATE',
          transcript_path: 'PRIVATE_FILE',
          pid: 123,
          sourceId: 'PRIVATE',
        }),
      ),
    ).toEqual({ decision: 'allow', reason: 'policy-allow' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(fs.realpathSync(file));
  });

  it('rereads policy for each invocation and never caches a previous permission', async () => {
    expect((await run()).decision).toBe('allow');
    expect((await run(policy({ rules: [] }))).decision).toBe('deny');
    fs.unlinkSync(file);
    expect(await evaluateActionPolicy(file, json(input()))).toEqual({
      decision: 'deny',
      reason: 'policy-unavailable',
    });
  });
});

describe('bounded parsing and policy reads', () => {
  it('rejects malformed UTF-8, JSON, nonfinite numbers and lone surrogates without echo', async () => {
    for (const bad of [
      Buffer.from([0xff]),
      Buffer.from('{PRIVATE'),
      Buffer.from('null'),
      Buffer.from(
        JSON.stringify(input()).replace('"tool_input":', '"overflow":1e400,"tool_input":'),
      ),
      json(input({ extra: '\ud800' })),
    ]) {
      const result = await run(policy(), bad);
      expect(result.decision).toBe('deny');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    expect((await run(Buffer.from('{PRIVATE'))).reason).toBe('policy-invalid');
  });

  it('enforces byte, depth, node and rule limits before comparing values', async () => {
    expect((await run(policy(), Buffer.alloc(LIMITS.bytes + 1))).reason).toBe('input-invalid');
    let nested = null;
    for (let i = 0; i < 10; i++) nested = { nested };
    expect((await run(policy(), input({ nested }))).reason).toBe('input-invalid');
    expect((await run(policy(), input({ list: Array(2050).fill(0) }))).reason).toBe(
      'input-invalid',
    );
    const rules = Array.from({ length: 33 }, (_, i) => ({
      tool: 'Bash',
      input: { command: String(i) },
      decision: 'deny',
    }));
    expect((await run(policy({ rules }))).reason).toBe('policy-invalid');
    fs.writeFileSync(file, Buffer.alloc(LIMITS.bytes + 1));
    const open = vi.spyOn(fs.promises, 'open');
    expect((await evaluateActionPolicy(file, json(input()))).reason).toBe('policy-unavailable');
    expect(open).not.toHaveBeenCalled();
  });

  it('accepts the declared byte and rule ceilings without allowing a wider input', async () => {
    const rules = Array.from({ length: 32 }, (_, i) => ({
      tool: 'Bash',
      input: { command: String(i) },
      decision: 'allow',
    }));
    const p = json(policy({ rules }));
    const i = json(input({ tool_input: { command: '31' } }));
    expect(
      (
        await run(
          Buffer.concat([p, Buffer.alloc(LIMITS.bytes - p.length, 32)]),
          Buffer.concat([i, Buffer.alloc(LIMITS.bytes - i.length, 32)]),
        )
      ).decision,
    ).toBe('allow');
  });

  it('rejects directory/junction or symlink policies and alternate streams', async () => {
    fs.writeFileSync(file, json(policy()));
    const link = path.join(root, 'link');
    if (process.platform === 'win32') fs.symlinkSync(root, link, 'junction');
    else fs.symlinkSync(file, link);
    try {
      for (const selected of [root, link, file + ':PRIVATE'])
        expect((await evaluateActionPolicy(selected, json(input()))).reason).toBe(
          'policy-unavailable',
        );
    } finally {
      fs.unlinkSync(link);
    }
  });

  it('denies a detected file change and a close failure', async () => {
    fs.writeFileSync(file, json(policy()));
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const read = handle.read.bind(handle);
      handle.read = async (...values) => {
        const result = await read(...values);
        fs.appendFileSync(file, ' ');
        return result;
      };
      return handle;
    });
    expect((await evaluateActionPolicy(file, json(input()))).reason).toBe('policy-unavailable');
    vi.restoreAllMocks();
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        throw new Error('PRIVATE_CLOSE');
      };
      return handle;
    });
    expect(await evaluateActionPolicy(file, json(input()))).toEqual({
      decision: 'deny',
      reason: 'policy-unavailable',
    });
  });
});
