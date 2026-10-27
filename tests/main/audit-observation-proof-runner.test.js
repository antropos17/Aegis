import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter, once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createProofRunner } = require('../../src/main/audit-observation-proof-runner');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

it('keeps a timed-out worker locked until actual exit and rejects unbounded replies', async () => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    terminate() { return Promise.resolve(); }
    unref() {}
  }
  const runner = createProofRunner({ deadlineMs: 30, workerFactory: () => {
    const worker = new FakeWorker(); workers.push(worker); return worker;
  } });
  expect(await runner.capture({ targets: [] })).toBeNull();
  expect(await runner.capture({ targets: [] })).toBeNull();
  expect(workers).toHaveLength(1);
  workers[0].emit('exit', 0);
  const next = runner.capture({ targets: [] });
  workers[1].emit('message', 640 * 1024 + 1);
  workers[1].emit('exit', 0);
  expect(await next).toBeNull();
  expect(workers).toHaveLength(2);
});

it.skipIf(process.platform !== 'win32')('returns on deadline while a real worker blocks in pipe I/O and never accumulates workers', async () => {
  const pipe = `\\\\.\\pipe\\aegis-proof-${randomUUID()}`;
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  let socket, worker, created = 0;
  const connected = new Promise((resolve) => server.once('connection', (s) => { socket = s; resolve(); }));
  const runner = createProofRunner({ deadlineMs: 700, workerFactory: () => {
    created++;
    worker = new Worker(path.resolve('tests/main/fixtures/audit-proof-blocked-worker.cjs'), { workerData: { pipe } });
    return worker;
  } });
  try {
    const pending = runner.capture({ targets: [] });
    await connected;
    await once(worker, 'message');
    let responsive = false;
    setTimeout(() => { responsive = true; }, 20);
    expect(await pending).toBeNull();
    expect(responsive).toBe(true);
    expect(created).toBe(1);
    const exited = worker.threadId === -1;
    if (!exited) {
      expect(await runner.capture({ targets: [] })).toBeNull();
      expect(created).toBe(1);
      const exit = once(worker, 'exit');
      socket.end('x');
      await Promise.race([exit, delay(3000).then(() => { throw Error('worker did not exit'); })]);
    }
  } finally {
    socket?.destroy();
    await worker?.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}, 8000);
