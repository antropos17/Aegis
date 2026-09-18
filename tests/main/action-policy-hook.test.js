import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const hook = require('../../src/main/action-policy-hook');
const tempDirs = [];
const args = ['--action-policy-hook', 'PRIVATE_POLICY_PATH'];
const deny = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'AEGIS policy does not allow this tool request.',
  },
};
function setup(evaluate) {
  const input = new PassThrough();
  const output = [];
  hook._setDepsForTest({ input, evaluate });
  return {
    input,
    output,
    run: (argv = args) => hook.handleActionPolicyHook(argv, (s) => output.push(s)),
  };
}
function launch(argv, input, keepOpen = false) {
  const child = spawn(process.execPath, ['src/main/main.js', ...argv], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  if (keepOpen) child.stdin.write(input);
  else child.stdin.end(input);
  const timer = setTimeout(() => child.kill(), 6000);
  return once(child, 'close').then(([code]) => {
    clearTimeout(timer);
    return { code, stdout, stderr };
  });
}

afterEach(() => {
  hook._resetForTest();
  vi.useRealTimers();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('action policy command-hook boundary', () => {
  it.each(['allow', 'ask', 'deny'])(
    'emits only the official %s decision without evaluator detail',
    async (decision) => {
      const t = setup(async () => ({
        decision,
        reason: 'PRIVATE_REASON',
        payload: 'PRIVATE_SECRET',
      }));
      const done = t.run();
      t.input.end('PRIVATE_INPUT');
      expect(await done).toBe(0);
      expect(t.output).toHaveLength(1);
      expect(JSON.parse(t.output[0]).hookSpecificOutput).toMatchObject({
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
      });
      expect(t.output[0]).not.toContain('PRIVATE');
    },
  );

  it.each([null, {}, { decision: 'defer' }, { decision: 'constructor' }])(
    'rejects unsupported evaluator result %#',
    async (result) => {
      const t = setup(async () => result);
      const done = t.run();
      t.input.end('{}');
      expect(await done).toBe(2);
      expect(t.output.map(JSON.parse)).toEqual([deny]);
    },
  );

  it('denies evaluator exceptions without disclosing exception text', async () => {
    const t = setup(() => {
      throw new Error('PRIVATE_EXCEPTION');
    });
    const done = t.run();
    t.input.end('{}');
    expect(await done).toBe(2);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
  });

  it('rejects oversized input before evaluating it and releases stdin', async () => {
    const evaluate = vi.fn();
    const t = setup(evaluate);
    const done = t.run();
    t.input.write(Buffer.alloc(hook.LIMITS.inputBytes + 1, 65));
    expect(await done).toBe(2);
    expect(evaluate).not.toHaveBeenCalled();
    expect(t.input.destroyed).toBe(true);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
  });

  it('denies stream errors and closes without leaked listeners', async () => {
    const t = setup(vi.fn());
    const done = t.run();
    t.input.destroy(new Error('PRIVATE_STREAM_FAILURE'));
    expect(await done).toBe(2);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
    expect(t.input.listenerCount('data')).toBe(0);
    expect(t.input.listenerCount('end')).toBe(0);
  });

  it('denies a stream closed without EOF', async () => {
    const t = setup(vi.fn());
    const done = t.run();
    t.input.destroy();
    expect(await done).toBe(2);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
  });

  it('absorbs an already queued stream error when invalid arguments settle first', async () => {
    const t = setup(vi.fn());
    t.input.destroy(new Error('PRIVATE_QUEUED_ERROR'));
    expect(await t.run([])).toBe(2);
    await new Promise(setImmediate);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
    expect(t.input.listenerCount('error')).toBe(0);
    expect(t.input.listenerCount('close')).toBe(0);
  });

  it('absorbs a late error after the deadline until the stream closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const t = setup(vi.fn());
    const done = t.run();
    vi.advanceTimersByTime(hook.LIMITS.deadlineMs);
    expect(() => t.input.emit('error', new Error('PRIVATE_LATE_ERROR'))).not.toThrow();
    expect(await done).toBe(2);
    await new Promise(setImmediate);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
    expect(t.input.listenerCount('error')).toBe(0);
    expect(t.input.listenerCount('close')).toBe(0);
  });

  it('uses one deadline across stdin and evaluation and never emits a late allow', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let complete;
    const evaluate = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const t = setup(evaluate);
    const done = t.run();
    await vi.advanceTimersByTimeAsync(1000);
    t.input.end('{}');
    await new Promise(setImmediate);
    expect(evaluate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(2);
    complete({ decision: 'allow' });
    await new Promise(setImmediate);
    expect(t.output.map(JSON.parse)).toEqual([deny]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[], ['--action-policy-hook'], [...args, 'PRIVATE_EXTRA'], ['--wrong', 'PRIVATE']])(
    'denies malformed arguments %# without reading input',
    async (argv) => {
      const evaluate = vi.fn();
      const t = setup(evaluate);
      expect(await t.run(argv)).toBe(2);
      expect(t.input.destroyed).toBe(true);
      expect(evaluate).not.toHaveBeenCalled();
      expect(t.output.map(JSON.parse)).toEqual([deny]);
    },
  );
});

describe('action policy Node CLI', () => {
  it.each(['allow', 'ask', 'deny'])(
    'runs an exact %s rule through the production entry',
    async (decision) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'aegis-policy-hook-'));
      tempDirs.push(directory);
      const policyPath = path.join(directory, 'policy.json');
      const toolInput = { command: 'echo PRIVATE_COMMAND' };
      writeFileSync(
        policyPath,
        JSON.stringify({
          schemaVersion: 1,
          cwd: process.cwd(),
          defaultDecision: 'deny',
          rules: [{ tool: 'Bash', input: toolInput, decision }],
        }),
      );
      const result = await launch(
        ['--action-policy-hook', policyPath],
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          session_id: 'PRIVATE_SESSION',
          tool_use_id: 'PRIVATE_TOOL_ID',
          cwd: process.cwd(),
          tool_name: 'Bash',
          tool_input: toolInput,
        }),
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      const output = result.stdout.trim().split('\n').map(JSON.parse);
      expect(output).toHaveLength(1);
      expect(output[0].hookSpecificOutput.permissionDecision).toBe(decision);
      expect(result.stdout).not.toContain('PRIVATE');
    },
  );

  it('terminates hung stdin with an explicit blocking response', async () => {
    const result = await launch(args, '{"PRIVATE":"', true);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(deny);
  }, 8000);

  it('rejects invalid arguments with blocking output through the real entry', async () => {
    const result = await launch(['--action-policy-hook'], 'PRIVATE');
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(deny);
  });
});
