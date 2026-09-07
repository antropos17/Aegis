import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { watch } from '../../src/main/watch-worker-client.js';

class FakeWorker extends EventEmitter {
  static instances = [];
  constructor() {
    super();
    FakeWorker.instances.push(this);
    this.postMessage = vi.fn();
    this.terminate = vi.fn(() => Promise.resolve(0));
  }
}
function create() {
  const proxy = watch('/fixture', {}, { WorkerClass: FakeWorker });
  return { proxy, worker: FakeWorker.instances.at(-1) };
}
const batch = (seq, extra = {}) => ({
  seq,
  events: [],
  dropped: 0,
  ready: false,
  error: null,
  ...extra,
});

describe('worker watcher lifetime', () => {
  it('delivers ordered events, ready once and loss deltas before acknowledging', () => {
    const { proxy, worker } = create();
    const observed = [];
    proxy.on('ready', () => observed.push('ready'));
    proxy.on('loss', (n) => observed.push(`loss:${n}`));
    proxy.on('change', (p) => {
      expect(worker.postMessage).not.toHaveBeenCalled();
      observed.push(p);
    });
    worker.emit(
      'message',
      batch(1, { ready: true, dropped: 5, events: [{ type: 'change', path: 'one' }] }),
    );
    worker.emit('message', batch(2, { ready: true, dropped: 7 }));
    worker.emit('message', batch(2, { dropped: 7 }));
    expect(observed).toEqual(['loss:5', 'ready', 'one', 'loss:2']);
    expect(worker.postMessage.mock.calls).toEqual([
      [{ type: 'ack', seq: 1 }],
      [{ type: 'ack', seq: 2 }],
    ]);
  });

  it.each(['error', 'exit'])(
    'reports unexpected worker %s once and never forwards error contents',
    (event) => {
      const { proxy, worker } = create();
      const errors = [];
      proxy.on('error', (e) => errors.push(e.message));
      worker.emit(event, new Error('synthetic-private-path-or-content'));
      worker.emit('exit', 1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^watch-worker-(crashed|exited)$/);
    },
  );

  it('invalidates late messages and errors before termination, including close-before-ready', async () => {
    const { proxy, worker } = create();
    const seen = vi.fn();
    for (const event of ['ready', 'error', 'loss', 'add']) proxy.on(event, seen);
    await proxy.close();
    worker.emit(
      'message',
      batch(1, { ready: true, dropped: 2, events: [{ type: 'add', path: 'late' }] }),
    );
    worker.emit('error', new Error('late'));
    worker.emit('exit', 0);
    await proxy.close();
    expect(seen).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('stops a batch when a consumer closes its watcher', () => {
    const { proxy, worker } = create();
    const seen = [];
    proxy.on('add', (p) => {
      seen.push(p);
      proxy.close();
    });
    worker.emit(
      'message',
      batch(1, {
        events: [
          { type: 'add', path: 'one' },
          { type: 'add', path: 'two' },
        ],
      }),
    );
    expect(seen).toEqual(['one']);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('propagates synchronous construction failure to the root registrar', () => {
    expect(() =>
      watch(
        '/fixture',
        {},
        {
          WorkerClass: class {
            constructor() {
              throw new Error('no-worker');
            }
          },
        },
      ),
    ).toThrow('no-worker');
  });
});
