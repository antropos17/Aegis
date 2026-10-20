import { afterEach, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const originalLoad = Module._load;
const threadPath = require_.resolve('../../src/main/watch-worker-thread.js');

function start({ enabled = true, throws = false } = {}) {
  const provider = new EventEmitter();
  const port = new EventEmitter();
  const sent = [];
  port.postMessage = (batch) => sent.push(batch);
  let options;
  Module._load = function (request) {
    if (request === 'node:worker_threads') {
      return {
        parentPort: port,
        workerData: {
          paths: path.resolve('fixture'),
          options: { ignoredDirectories: ['node_modules'], startupProgress: enabled },
        },
      };
    }
    if (request === 'chokidar') {
      return {
        watch: vi.fn((_, opts) => {
          options = opts;
          if (throws) throw new Error('private-provider-details');
          return provider;
        }),
      };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require_.cache[threadPath];
  require_(threadPath);
  return { provider, port, sent, options };
}

afterEach(() => {
  Module._load = originalLoad;
  delete require_.cache[threadPath];
  vi.useRealTimers();
});

describe('native worker initial scan progress', () => {
  it('reports changed scan counts once per second, without paths or premature readiness', async () => {
    vi.useFakeTimers();
    const { provider, port, sent, options } = start();
    expect(options).not.toHaveProperty('startupProgress');
    options.ignored(path.resolve('fixture', 'visible.txt'));
    options.ignored(path.resolve('fixture', 'node_modules'));
    await vi.advanceTimersByTimeAsync(1001);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ progress: 2, ready: false, events: [], dropped: 0 });
    expect(JSON.stringify(sent)).not.toContain('fixture');
    port.emit('message', { type: 'ack', seq: sent[0].seq });
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1); // An idle timer is not evidence of scan progress.
    options.ignored(path.resolve('fixture', 'another.txt'));
    await vi.advanceTimersByTimeAsync(1001);
    expect(sent[1]).toMatchObject({ progress: 3, ready: false });
    provider.emit('ready');
    port.emit('message', { type: 'ack', seq: sent[1].seq });
    await vi.advanceTimersByTimeAsync(1);
    expect(sent[2].ready).toBe(true);
    port.emit('message', { type: 'ack', seq: sent[2].seq });
    options.ignored(path.resolve('fixture', 'after-ready.txt'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'throw', 'disabled'])('leaves no progress interval after %s', async (mode) => {
    vi.useFakeTimers();
    const { provider, sent, options } = start({
      enabled: mode !== 'disabled',
      throws: mode === 'throw',
    });
    options.ignored(path.resolve('fixture', 'visible.txt'));
    if (mode === 'error') provider.emit('error', new Error('private-provider-details'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.every((batch) => !batch.progress)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('private-provider-details');
    expect(vi.getTimerCount()).toBe(0);
  });
});
