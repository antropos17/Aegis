import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const claude = require('../../src/main/action-policy-hook');
const gemini = require('../../src/main/gemini-beforetool-hook');
const providers = [
  {
    name: 'Claude',
    hook: claude,
    flag: '--action-policy-hook',
    handle: claude.handleActionPolicyHook,
    accepted: { decision: 'allow' },
    response: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'AEGIS policy allows this tool request.',
      },
    },
    refusal: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'AEGIS policy does not allow this tool request.',
      },
    },
    refusalCode: 2,
  },
  {
    name: 'Gemini',
    hook: gemini,
    flag: '--gemini-beforetool-hook',
    handle: gemini.handleGeminiBeforeToolHook,
    accepted: false,
    response: {},
    refusal: { decision: 'deny', reason: 'AEGIS policy does not allow this tool request.' },
    refusalCode: 0,
  },
];

function setup(provider, evaluate, write) {
  const input = new PassThrough();
  const output = [];
  provider.hook._setDepsForTest({ input, evaluate });
  return {
    input,
    output,
    run: () =>
      provider.handle(
        [provider.flag, 'PRIVATE_POLICY_PATH'],
        write || ((text) => output.push(text)),
      ),
  };
}

afterEach(() => {
  claude._resetForTest();
  gemini._resetForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(providers)('$name command-hook input lifecycle', (provider) => {
  it('clears the owned raw input after evaluation completes', async () => {
    const source = Buffer.from('PRIVATE_COMMAND');
    let evaluated;
    const t = setup(provider, (_policyPath, raw) => {
      evaluated = raw;
      expect(raw.equals(source)).toBe(true);
      return provider.accepted;
    });
    const done = t.run();
    t.input.end(source);
    expect(await done).toBe(0);
    await new Promise(setImmediate);
    expect(evaluated).toEqual(Buffer.alloc(source.length));
    expect(source.toString()).toBe('PRIVATE_COMMAND');
    expect(t.output.map(JSON.parse)).toEqual([provider.response]);
  });

  it.each(['throw', 'reject', 'invalid result'])(
    'clears owned input when the evaluator returns %s and emits one fixed refusal',
    async (failure) => {
      let evaluated;
      const t = setup(provider, (_policyPath, raw) => {
        evaluated = raw;
        if (failure === 'throw') throw new Error('PRIVATE_EVALUATOR_FAILURE');
        if (failure === 'reject') return Promise.reject(new Error('PRIVATE_EVALUATOR_FAILURE'));
        return null;
      });
      const done = t.run();
      t.input.end('PRIVATE_COMMAND');
      expect(await done).toBe(provider.refusalCode);
      await new Promise(setImmediate);
      expect(evaluated).toEqual(Buffer.alloc(15));
      expect(t.output.map(JSON.parse)).toEqual([provider.refusal]);
    },
  );

  it('clears owned input when output fails without retrying the decision', async () => {
    let evaluated;
    const write = vi.fn(() => {
      throw new Error('PRIVATE_OUTPUT_FAILURE');
    });
    const t = setup(
      provider,
      (_policyPath, raw) => {
        evaluated = raw;
        return provider.accepted;
      },
      write,
    );
    const done = t.run();
    t.input.end('PRIVATE_COMMAND');
    expect(await done).toBe(2);
    await new Promise(setImmediate);
    expect(evaluated).toEqual(Buffer.alloc(15));
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(JSON.stringify(provider.response));
  });

  it('denies a concatenation failure with one response and releases input listeners', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const evaluate = vi.fn();
    const t = setup(provider, evaluate);
    const done = t.run();
    vi.spyOn(Buffer, 'concat').mockImplementationOnce(() => {
      throw new Error('PRIVATE_CONCAT_FAILURE');
    });
    t.input.write('PRIVATE_COMMAND');
    let endError;
    try {
      t.input.emit('end');
    } catch (error) {
      endError = error;
    }
    await vi.advanceTimersByTimeAsync(provider.hook.LIMITS.deadlineMs);
    t.input.destroy();
    await new Promise(setImmediate);
    expect(endError).toBeUndefined();
    expect(await done).toBe(provider.refusalCode);
    expect(evaluate).not.toHaveBeenCalled();
    expect(t.output.map(JSON.parse)).toEqual([provider.refusal]);
    for (const event of ['data', 'end', 'error', 'close'])
      expect(t.input.listenerCount(event)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['oversize', 'stream error', 'deadline'])(
    'disposes accumulated %s input before evaluation while preserving producer buffers',
    async (failure) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const source = Buffer.from('PRIVATE_COMMAND');
      const evaluate = vi.fn();
      const t = setup(provider, evaluate);
      const done = t.run();
      t.input.write(source);
      if (failure === 'oversize') t.input.write(Buffer.alloc(provider.hook.LIMITS.inputBytes));
      if (failure === 'stream error') t.input.destroy(new Error('PRIVATE_STREAM_FAILURE'));
      if (failure === 'deadline')
        await vi.advanceTimersByTimeAsync(provider.hook.LIMITS.deadlineMs);
      expect(await done).toBe(provider.refusalCode);
      await new Promise(setImmediate);
      expect(evaluate).not.toHaveBeenCalled();
      expect(t.input.destroyed).toBe(true);
      expect(t.output.map(JSON.parse)).toEqual([provider.refusal]);
      expect(source.toString()).toBe('PRIVATE_COMMAND');
      for (const event of ['data', 'end', 'error', 'close'])
        expect(t.input.listenerCount(event)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('defers cleanup of an active evaluator until it settles after the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let evaluated;
    let complete;
    const t = setup(provider, (_policyPath, raw) => {
      evaluated = raw;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const done = t.run();
    t.input.end('PRIVATE_COMMAND');
    await new Promise(setImmediate);
    expect(evaluated.toString()).toBe('PRIVATE_COMMAND');
    await vi.advanceTimersByTimeAsync(provider.hook.LIMITS.deadlineMs);
    expect(await done).toBe(provider.refusalCode);
    expect(evaluated.toString()).toBe('PRIVATE_COMMAND');
    complete(provider.accepted);
    await new Promise(setImmediate);
    expect(evaluated).toEqual(Buffer.alloc(15));
    expect(t.output.map(JSON.parse)).toEqual([provider.refusal]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
