import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createCedarProcessClient } = require('../../src/main/policy-cedar-process');
const policy = () => ({
  schemaVersion: 4,
  cedarSchema: 'aegis-execution-v1',
  policies: { permit: 'permit(principal, action, resource);' },
});
const action = () => ({
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['PRIVATE_ARG'],
  env: { SECRET: 'PRIVATE_VALUE' },
});
const allow = { decision: 'allow', reason: 'policy-allow', policyIds: ['permit'] };
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });
const limits = {
  processMemoryBytes: 268435456,
  jobMemoryBytes: 268435456,
  activeProcesses: 1,
  processUserTicks: 20000000,
  jobUserTicks: 20000000,
  wallMs: 10000,
};
const native = (changes = {}) => ({
  schemaVersion: 1,
  op: 'result',
  closed: true,
  reason: 'ok',
  limits,
  result: allow,
  ...changes,
});
const frame = (value) => {
  const body = Buffer.from(JSON.stringify(value));
  const output = Buffer.alloc(body.length + 4);
  output.writeUInt32LE(body.length);
  body.copy(output, 4);
  return output;
};
const clients = [];
const children = [];
function owner() {
  const spawnProcess = vi.fn((file, args, options) => {
    const child = new EventEmitter();
    child.pid = 123;
    child.stdin = new EventEmitter();
    child.stdin.write = vi.fn();
    child.stdin.end = vi.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.launch = { file, args, options };
    children.push(child);
    return child;
  });
  const client = createCedarProcessClient({
    spawnProcess,
    platform: 'win32',
    admissionCheck: () => true,
  });
  clients.push(client);
  return { client, spawnProcess };
}
const last = () => children.at(-1);
function reply(child = last(), value = native(), code = 0) {
  child.stdout.emit('data', frame(value));
  child.emit('close', code);
}
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const child of children.splice(0)) child.emit('close', 1);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('dormant Cedar process ownership', () => {
  it('refuses non-Windows and closed admission before reading private values', async () => {
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw Error('PRIVATE');
        },
      },
    );
    const client = createCedarProcessClient({
      platform: 'linux',
      spawnProcess: () => {
        throw Error();
      },
    });
    expect(await client.evaluate(value, value)).toEqual(deny('cedar-unavailable'));
    client.close();
    expect(await client.evaluate(value, value)).toEqual(deny('cedar-process-closed'));
  });
  it('sends only one private frame, with no request bytes in executable, argv or environment', async () => {
    const { client, spawnProcess } = owner();
    const pending = client.evaluate(policy(), action());
    const child = last();
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(child.launch.args).toEqual([]);
    expect(child.launch.options).toMatchObject({ shell: false, windowsHide: true });
    expect(JSON.stringify(child.launch)).not.toContain('PRIVATE');
    expect(
      Object.keys(child.launch.options.env).every((key) =>
        ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].includes(key),
      ),
    ).toBe(true);
    const sent = child.stdin.write.mock.calls[0][0];
    expect(sent.readUInt32LE(0)).toBe(sent.length - 4);
    expect(JSON.parse(sent.subarray(4)).request.action.env.SECRET).toBe('PRIVATE_VALUE');
    expect(child.stdin.end).not.toHaveBeenCalled();
    reply();
    expect(await pending).toEqual(allow);
  });
  it('keeps allow provisional until clean helper closure and whole-Job confirmation', async () => {
    const { client } = owner();
    let settled = false;
    const pending = client.evaluate(policy(), action()).then((value) => {
      settled = true;
      return value;
    });
    last().stdout.emit('data', frame(native()));
    await Promise.resolve();
    expect(settled).toBe(false);
    const poison = new Proxy(
      {},
      {
        ownKeys() {
          throw Error();
        },
      },
    );
    expect(await client.evaluate(poison, poison)).toEqual(deny('cedar-process-busy'));
    last().emit('close', 0);
    expect(await pending).toEqual(allow);
  });
  it.each([
    { closed: false },
    { limits: { ...limits, jobMemoryBytes: 0 } },
    { result: { ...allow, policyIds: ['unknown'] } },
    { result: { ...allow, launch: { executable: 'PRIVATE' } } },
  ])('refuses unknown closure/caps/metadata and retains admission: %j', async (changes) => {
    const { client } = owner();
    const pending = client.evaluate(policy(), action());
    reply(last(), native(changes));
    expect(await pending).toEqual(deny('cedar-process-unconfirmed'));
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
  });
  it('refuses helper loss even after an allow candidate', async () => {
    const { client } = owner();
    const pending = client.evaluate(policy(), action());
    reply(last(), native(), 1);
    expect(await pending).toEqual(deny('cedar-process-unconfirmed'));
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
  });
  it('rejects duplicate and oversized replies without retaining unbounded data', async () => {
    const { client } = owner();
    const pending = client.evaluate(policy(), action());
    last().stdout.emit('data', Buffer.alloc(9000));
    expect(await pending).toEqual(deny('cedar-process-protocol'));
    expect(last().stdin.end).toHaveBeenCalledOnce();
    last().emit('close', 0);
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
    const second = owner();
    const pending2 = second.client.evaluate(policy(), action());
    last().stdout.emit('data', Buffer.concat([frame(native()), frame(native())]));
    last().emit('close', 0);
    expect(await pending2).toEqual(deny('cedar-process-unconfirmed'));
  });
  it('denies and drains child diagnostics without exposing them', async () => {
    const { client } = owner();
    const pending = client.evaluate(policy(), action());
    last().stderr.emit('data', Buffer.from('PRIVATE_RUNTIME_ERROR'));
    expect(await pending).toEqual(deny('cedar-process-failed'));
    reply();
  });
  it.each(['oversized-tail', 'stdout-read-error', 'stderr-read-error', 'stdin-write-error'])(
    'keeps admission occupied after a valid prefix and poisoned transcript: %s',
    async (fault) => {
      const { client, spawnProcess } = owner();
      const pending = client.evaluate(policy(), action());
      const child = last();
      child.stdout.emit('data', frame(native()));
      if (fault === 'oversized-tail') child.stdout.emit('data', Buffer.alloc(9000));
      else child[fault.split('-')[0]].emit('error', Error('PRIVATE_IO_ERROR'));
      const result = await pending;
      expect(result.decision).toBe('deny');
      child.emit('close', 0);
      const next = client.evaluate(policy(), action());
      expect(spawnProcess).toHaveBeenCalledOnce();
      expect(await next).toEqual(deny('cedar-process-busy'));
    },
  );
  it('releases cancellation admission on a genuinely valid later closure without changing the denial', async () => {
    const { client } = owner();
    const controller = new AbortController();
    const pending = client.evaluate(policy(), action(), { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual(deny('cedar-process-cancelled'));
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
    reply(last(), native({ reason: 'cedar-process-failed', result: null }));
    expect(await pending).toEqual(deny('cedar-process-cancelled'));
    const next = client.evaluate(policy(), action());
    reply();
    expect(await next).toEqual(allow);
  });
  it('revokes native control on timeout and keeps admission until a validated closure receipt', async () => {
    vi.useFakeTimers();
    const { client } = owner();
    const pending = client.evaluate(policy(), action(), { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toEqual(deny('cedar-process-timeout'));
    expect(last().stdin.end).toHaveBeenCalledOnce();
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
    reply(last(), native({ reason: 'cedar-process-failed', result: null }));
    const next = client.evaluate(policy(), action());
    reply();
    expect(await next).toEqual(allow);
  });
  it('cancels without adopting a lost native owner', async () => {
    const { client } = owner();
    const controller = new AbortController();
    const pending = client.evaluate(policy(), action(), { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual(deny('cedar-process-cancelled'));
    last().emit('close', 1);
    expect(await client.evaluate(policy(), action())).toEqual(deny('cedar-process-busy'));
  });
  it('releases admission only for confirmed failed evaluation cleanup', async () => {
    const { client } = owner();
    const pending = client.evaluate(policy(), action());
    reply(last(), native({ reason: 'cedar-process-failed', result: null }));
    expect(await pending).toEqual(deny('cedar-process-failed'));
    const next = client.evaluate(policy(), action());
    reply();
    expect(await next).toEqual(allow);
  });
  it.each(['stream', 'child_process', 'net', 'worker'])(
    'refuses cached %s diagnostics even after env deletion, before private inspection',
    async (category) => {
      const script = `const {createCedarProcessClient}=require(process.argv[1]); delete process.env.NODE_DEBUG; let read=0,spawned=0; const a={}; Object.defineProperty(a,'executable',{enumerable:true,get(){read++;throw Error()}}); createCedarProcessClient({platform:'win32',spawnProcess(){spawned++;throw Error()}}).evaluate({},a).then(result=>process.stdout.write(JSON.stringify({result,read,spawned})));`;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['-e', script, require.resolve('../../src/main/policy-cedar-process')],
        {
          timeout: 5000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          env: {
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            NODE_DEBUG: category,
          },
        },
      );
      expect(JSON.parse(stdout)).toEqual({
        result: deny('cedar-unavailable'),
        read: 0,
        spawned: 0,
      });
    },
  );
  it.each(['--inspect=0', '--import=data:text/javascript,'])(
    'refuses startup hook/inspection before private IO: %s',
    async (flag) => {
      const script = `const {createCedarProcessClient}=require(process.argv[1]); let spawned=0; createCedarProcessClient({platform:'win32',spawnProcess(){spawned++;throw Error()}}).evaluate({},{}).then(result=>process.stdout.write(JSON.stringify({result,spawned})));`;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [flag, '-e', script, require.resolve('../../src/main/policy-cedar-process')],
        {
          timeout: 5000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
        },
      );
      expect(JSON.parse(stdout)).toEqual({ result: deny('cedar-unavailable'), spawned: 0 });
    },
  );
});
