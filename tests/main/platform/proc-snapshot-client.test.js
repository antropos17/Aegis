import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import client from '../../../src/main/platform/proc-snapshot-client.js';
import protocol from '../../../src/main/platform/proc-snapshot-protocol.js';

const { encodeFrame, PROTOCOL_VERSION } = protocol;

/**
 * A stand-in for the sidecar process. The Windows binary is never executed by CI —
 * all five required contexts run on Linux — so the supervision logic is proven
 * against this fake or it is not proven at all.
 * @returns {Object}
 */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.stdinEnded = false;
  child.killed = false;
  child.stdin = {
    write: (buf) => {
      child.written.push(buf);
      return true;
    },
    end: () => {
      child.stdinEnded = true;
    },
  };
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

/** Let queued microtasks and immediates run. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const HELLO = {
  t: 'hello',
  proto: PROTOCOL_VERSION,
  caps: { class: 'class5', sequence: false, topology: true },
  pid: 4242,
};

describe('platform/proc-snapshot-client', () => {
  let children;
  let spawnCalls;
  let clock;

  /**
   * Drive one full request: send it, hand over the hello, let the request frame be
   * written, then let the caller answer.
   * @param {Object} [opts]
   * @returns {Promise<{promise: Promise<any>, child: Object}>}
   */
  async function startRequest(opts = {}) {
    const promise = client.requestSnapshot({ timeoutMs: 60, ...opts });
    const child = children[children.length - 1];
    child.stdout.emit('data', encodeFrame(HELLO));
    await flush();
    return { promise, child };
  }

  beforeEach(() => {
    children = [];
    spawnCalls = [];
    clock = 1000;
    client._resetForTest();
    client._setInternalsForTest({
      spawn: (exePath, args, opts) => {
        spawnCalls.push({ exePath, args, opts });
        const child = makeFakeChild();
        children.push(child);
        return child;
      },
      resolveExePath: () => 'C:\\fake\\aegis-procsnap.exe',
      now: () => clock,
    });
  });

  afterEach(() => {
    client._resetForTest();
  });

  it('spawns the resolved binary with piped stdio and no shell', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit(
      'data',
      encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [{ pid: 7 }] }),
    );
    await expect(promise).resolves.toEqual({ source: 'class5', procs: [{ pid: 7 }] });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].exePath).toBe('C:\\fake\\aegis-procsnap.exe');
    expect(spawnCalls[0].args).toEqual([]);
    expect(spawnCalls[0].opts).toEqual({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    expect(spawnCalls[0].opts.shell).toBeUndefined();
  });

  it('sends exactly one snap frame per request and reuses the same child', async () => {
    const first = await startRequest();
    first.child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'basic', procs: [] }));
    await first.promise;

    const second = client.requestSnapshot({ timeoutMs: 60 });
    await flush();
    first.child.stdout.emit('data', encodeFrame({ t: 'snap', id: 2, source: 'basic', procs: [] }));
    await second;

    expect(spawnCalls).toHaveLength(1);
    expect(first.child.written).toHaveLength(2);
    expect(client.getState().connected).toBe(true);
  });

  it('reports the capability block the hello announced', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [] }));
    await promise;
    expect(client.getState().caps).toEqual({ class: 'class5', sequence: false, topology: true });
  });

  it('ignores a response whose id matches no request, then answers the real one', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit(
      'data',
      encodeFrame({ t: 'snap', id: 99, source: 'class5', procs: [{ pid: 1 }] }),
    );
    child.stdout.emit(
      'data',
      encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [{ pid: 2 }] }),
    );
    await expect(promise).resolves.toEqual({ source: 'class5', procs: [{ pid: 2 }] });
  });

  it('rejects a malformed snapshot response', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: 'nope' }));
    await expect(promise).rejects.toThrow(/malformed snapshot response/);
  });

  it('rejects a second request while one is in flight', async () => {
    const { promise, child } = await startRequest();
    await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/already in flight/);
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [] }));
    await promise;
  });

  describe('fail-honest supervision', () => {
    it('disables itself for the session when no binary exists — and never spawns', async () => {
      client._setInternalsForTest({ resolveExePath: () => null });
      await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/binary not found/);
      await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/unavailable/);
      expect(spawnCalls).toHaveLength(0);
      expect(client.getState().available).toBe(false);
      expect(client.getState().sticky).toMatch(/binary not found/);
    });

    it('disables itself on a protocol version it does not know', async () => {
      const promise = client.requestSnapshot({ timeoutMs: 60 });
      children[0].stdout.emit('data', encodeFrame({ ...HELLO, proto: PROTOCOL_VERSION + 1 }));
      await expect(promise).rejects.toThrow(/protocol version mismatch/);
      expect(client.getState().sticky).toMatch(/protocol version mismatch/);
      await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/unavailable/);
      expect(spawnCalls).toHaveLength(1);
    });

    it('disables itself on a hello with no usable capability block', async () => {
      const promise = client.requestSnapshot({ timeoutMs: 60 });
      children[0].stdout.emit('data', encodeFrame({ t: 'hello', proto: PROTOCOL_VERSION }));
      await expect(promise).rejects.toThrow(/capability block/);
      expect(client.getState().available).toBe(false);
    });

    it('kills the child and backs off when a snapshot times out', async () => {
      const { promise, child } = await startRequest({ timeoutMs: 20 });
      await expect(promise).rejects.toThrow(/timed out/);
      expect(child.killed).toBe(true);
      expect(client.getState().failures).toBe(1);
      await expect(client.requestSnapshot({ timeoutMs: 20 })).rejects.toThrow(/backing off/);
      expect(spawnCalls).toHaveLength(1);
    });

    it('respawns once the backoff has elapsed', async () => {
      const { promise, child } = await startRequest();
      child.emit('exit', 1, null);
      await expect(promise).rejects.toThrow(/child exited/);

      clock += 1001;
      const retry = await startRequest();
      retry.child.stdout.emit(
        'data',
        encodeFrame({ t: 'snap', id: 2, source: 'basic', procs: [] }),
      );
      await expect(retry.promise).resolves.toEqual({ source: 'basic', procs: [] });
      expect(spawnCalls).toHaveLength(2);
    });

    it('gives up for the session once the restart budget is exhausted', async () => {
      const backoffs = [0, 1001, 5001];
      for (const step of backoffs) {
        clock += step;
        const promise = client.requestSnapshot({ timeoutMs: 60 });
        children[children.length - 1].emit('exit', 1, null);
        await expect(promise).rejects.toThrow(/child exited/);
      }
      expect(spawnCalls).toHaveLength(3);
      expect(client.getState().available).toBe(false);
      expect(client.getState().sticky).toMatch(/restart budget exhausted/);
      await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/unavailable/);
      expect(spawnCalls).toHaveLength(3);
    });

    it('treats a desynchronised stream as a failure and tears the child down', async () => {
      const { promise, child } = await startRequest();
      const bogus = Buffer.alloc(8);
      bogus.writeUInt32LE(0, 0);
      child.stdout.emit('data', bogus);
      await expect(promise).rejects.toThrow(/desynchronised/);
      expect(child.killed).toBe(true);
      expect(client.getState().failures).toBe(1);
    });

    it('rejects the pass on an err frame WITHOUT spending a restart', async () => {
      const { promise, child } = await startRequest();
      child.stdout.emit(
        'data',
        encodeFrame({ t: 'err', id: 1, code: 'nt-status', ntstatus: '0xC0000004' }),
      );
      await expect(promise).rejects.toThrow(/sidecar error nt-status/);
      // The child answered, so it is healthy: no kill, no failure counted, and the
      // next pass reuses it rather than paying a respawn.
      expect(child.killed).toBe(false);
      expect(client.getState().failures).toBe(0);
      expect(client.getState().connected).toBe(true);
    });
  });

  it('closes stdin and kills the child on shutdown', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [] }));
    await promise;

    client.shutdown();
    expect(child.stdinEnded).toBe(true);
    expect(child.killed).toBe(true);
    expect(client.getState().connected).toBe(false);
  });

  it('forwards sidecar stderr to the debug log without failing the pass', async () => {
    const { promise, child } = await startRequest();
    expect(() => child.stderr.emit('data', Buffer.from('probe: class5\n'))).not.toThrow();
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [] }));
    await expect(promise).resolves.toBeTruthy();
  });

  it('rejects a caller that arrives DURING the handshake, before any request slot exists', async () => {
    // The busy guard has to cover the spawn window too. Two callers attaching to one
    // handshake would both write a request, the second would take over the response
    // slot, and the first would hang until its own timeout.
    const first = client.requestSnapshot({ timeoutMs: 60 });
    await expect(client.requestSnapshot({ timeoutMs: 60 })).rejects.toThrow(/already in flight/);
    expect(spawnCalls).toHaveLength(1);

    children[0].stdout.emit('data', encodeFrame(HELLO));
    await flush();
    expect(children[0].written).toHaveLength(1);
    children[0].stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'basic', procs: [] }));
    await expect(first).resolves.toEqual({ source: 'basic', procs: [] });
    expect(spawnCalls).toHaveLength(1);
  });

  it('is silent about a stale child that exits after teardown', async () => {
    const { promise, child } = await startRequest();
    child.stdout.emit('data', encodeFrame({ t: 'snap', id: 1, source: 'class5', procs: [] }));
    await promise;
    client.shutdown();
    child.emit('exit', 0, null);
    expect(client.getState().failures).toBe(0);
    expect(client.getState().available).toBe(true);
  });
});
