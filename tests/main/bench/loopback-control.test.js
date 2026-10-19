import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runLoopbackControl } = require('../../../bench/lib/loopback-control.js');
const { openLoopbackReceiver } = require('../../../bench/lib/loopback-receiver.js');
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns');
const { createHash } = require('node:crypto');
const input = { runId: 'control-1', nonce: 'nonce-1', durationMs: 1000 };
const payload = (runId = input.runId, nonce = input.nonce) =>
  Buffer.from(`AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${runId}\n${nonce}\n`, 'ascii');
const receiverServers = new WeakMap();

async function receiverCase(check, extra = {}) {
  const original = http.createServer;
  let server;
  const create = vi.spyOn(http, 'createServer').mockImplementation((...args) => {
    server = Reflect.apply(original, http, args);
    return server;
  });
  let receiver;
  try {
    receiver = await openLoopbackReceiver({ ...input, ...extra });
  } finally {
    create.mockRestore();
  }
  receiverServers.set(receiver, server);
  try {
    return await check(receiver);
  } finally {
    await receiver.finish();
  }
}
async function send(port, body, method = 'POST', path = '/') {
  return new Promise((resolve) => {
    let complete = false;
    const finish = (status) => {
      if (!complete) {
        complete = true;
        clearTimeout(timer);
        request.destroy();
        resolve(status);
      }
    };
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        agent: false,
        headers: { 'Content-Length': body.length, Connection: 'close' },
      },
      (response) => {
        response.resume();
        response.once('end', () => finish(response.statusCode));
        response.on('error', () => finish(null));
      },
    );
    const timer = setTimeout(() => finish(null), 500);
    request.on('error', () => finish(null));
    request.once('finish', () => request.socket?.end());
    request.end(body);
  });
}

async function partial(port) {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      agent: false,
      headers: { Expect: '100-continue', 'Content-Length': 100 },
    });
    request.on('error', () => {});
    request.once('continue', () => resolve(request));
    request.flushHeaders();
  });
}

async function rawInput(receiver, wire) {
  const received = new Promise((resolve) => {
    receiverServers.get(receiver).once('connection', (socket) => socket.once('data', resolve));
  });
  const socket = net.connect({ host: '127.0.0.1', port: receiver.port });
  socket.on('error', () => {});
  socket.resume();
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.once('connect', () => socket.write(wire));
  await received;
  return { socket, closed };
}

describe('owned inert loopback outcome control', () => {
  it('separates sender completion from an independently checked receiver count and hash', async () => {
    const r = await runLoopbackControl({ runId: 'control-1', nonce: 'nonce-1', durationMs: 1000 });
    expect(r.sender).toMatchObject({
      attempted: true,
      writeFinished: true,
      responseCompleted: true,
      statusCode: 204,
      reason: null,
    });
    expect(r.receiver).toMatchObject({
      matchingPayloads: 1,
      duplicates: 0,
      wrong: 0,
      verifiedCount: 1,
      exact: true,
      reason: null,
    });
    expect(r.receiver.observedHashes).toEqual([r.receiver.expectedSha256]);
    expect(r.confirmed).toBe(true);
    expect(r.receiver.cleanup).toEqual({
      listenerClosed: true,
      socketsClosed: true,
      confirmed: true,
    });
    expect(r.sender.socketClosed).toBe(true);
  });
  it('retains an unfinished body as unconfirmed rather than a verified zero', async () => {
    const receiver = await openLoopbackReceiver({ runId: 'partial-1', nonce: 'nonce-1' });
    const request = await partial(receiver.port);
    const receipt = await receiver.finish();
    request.destroy();
    expect(receipt.incomplete).toBe(1);
    expect(receipt.verifiedCount).toBeNull();
    expect(receipt.exact).toBeNull();
    expect(receipt.reason).toBe('receipt-unconfirmed');
  });
  it.each([false, true])(
    'refuses incomplete initial headers after an existing canary: %s',
    async (positive) => {
      await receiverCase(async (receiver) => {
        if (positive) expect(await send(receiver.port, payload())).toBe(204);
        const { socket } = await rawInput(
          receiver,
          'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Len',
        );
        try {
          const r = await receiver.finish();
          expect(r.matchingPayloads).toBe(positive ? 1 : 0);
          expect(r.incomplete).toBeGreaterThan(0);
          expect(r.verifiedCount).toBeNull();
          expect(r.exact).toBeNull();
          expect(r.reason).toBe('receipt-unconfirmed');
          expect(r.cleanup.confirmed).toBe(true);
        } finally {
          socket.destroy();
        }
      });
    },
  );
  it.each([false, true])(
    'refuses partial pipelined next headers with peer EOF: %s',
    async (endPeer) => {
      await receiverCase(async (receiver) => {
        const wire = Buffer.concat([
          Buffer.from(
            `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${payload().length}\r\nConnection: keep-alive\r\n\r\n`,
          ),
          payload(),
          Buffer.from('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Len'),
        ]);
        const { socket, closed } = await rawInput(receiver, wire);
        try {
          if (endPeer) socket.end();
          // A zero-length final response used to close/free Node's parser here.
          await closed;
          const r = await receiver.finish();
          expect(r.matchingPayloads).toBe(1);
          expect(r.incomplete + r.protocolErrors).toBeGreaterThan(0);
          expect(r.verifiedCount).toBeNull();
          expect(r.exact).toBeNull();
          expect(r.cleanup.confirmed).toBe(true);
        } finally {
          socket.destroy();
        }
      });
    },
  );
  it.each(['unsupported', '100-continue', 'mixed'])(
    'bounds all Expect request admissions: %s',
    async (kind) => {
      await receiverCase(async (receiver) => {
        const wire = Array.from({ length: 5 }, (_, index) => {
          const expect =
            kind === '100-continue' || (kind === 'mixed' && index % 2)
              ? '100-continue'
              : 'unsupported';
          return `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: ${expect}\r\nContent-Length: 0\r\n\r\n`;
        }).join('');
        const { socket } = await rawInput(receiver, wire);
        try {
          const r = await receiver.done;
          expect(r.reason).toBe('request-limit');
          expect(r.requests).toBe(5);
          expect(r.connections).toBe(1);
          expect(r.verifiedCount).toBeNull();
          expect(r.observedHashes.length).toBeLessThanOrEqual(4);
          expect(r.cleanup.confirmed).toBe(true);
        } finally {
          socket.destroy();
        }
      });
    },
  );
  it('counts four unsupported expectations as wrong admissions without a successful body hash', async () => {
    await receiverCase(async (receiver) => {
      const wire =
        'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: unsupported\r\nContent-Length: 0\r\n\r\n'.repeat(
          4,
        );
      const { socket, closed } = await rawInput(receiver, wire);
      try {
        socket.end();
        await closed;
        const r = await receiver.finish();
        expect(r).toMatchObject({
          requests: 4,
          wrong: 4,
          verifiedCount: 0,
          exact: false,
          reason: 'wrong-receipt',
        });
        expect(r.observedHashes).toEqual([]);
      } finally {
        socket.destroy();
      }
    });
  });
  it.each(['unsupported', '100-continue'])(
    'keeps the body cap on the %s admission path',
    async (expectation) => {
      await receiverCase(async (receiver) => {
        const wire = Buffer.concat([
          Buffer.from(
            `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: ${expectation}\r\nContent-Length: 513\r\n\r\n`,
          ),
          Buffer.alloc(513, 65),
        ]);
        const { socket, closed } = await rawInput(receiver, wire);
        try {
          await closed;
          const r = await receiver.finish();
          expect(r).toMatchObject({ requests: 1, oversize: 1, verifiedCount: null, exact: null });
          expect(r.wrong).toBe(expectation === 'unsupported' ? 1 : 0);
          expect(r.observedHashes).toEqual([]);
          expect(r.cleanup.confirmed).toBe(true);
        } finally {
          socket.destroy();
        }
      });
    },
  );
  it.each(['malformed', 'header-overflow'])(
    'charges a terminal parser fault to the same request budget: %s',
    async (kind) => {
      await receiverCase(async (receiver) => {
        for (let index = 0; index < 3; index++)
          expect(await send(receiver.port, payload())).toBe(index ? 409 : 204);
        const first = 'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n';
        const fault =
          kind === 'malformed'
            ? 'INVALID / HTTP/1.1\r\n\r\n'
            : `POST / HTTP/1.1\r\nX-Overflow: ${'a'.repeat(2049)}\r\n\r\n`;
        const { socket } = await rawInput(receiver, first + fault);
        try {
          const r = await receiver.done;
          expect(r).toMatchObject({
            requests: 5,
            connections: 4,
            protocolErrors: 1,
            reason: 'request-limit',
            verifiedCount: null,
            exact: null,
          });
          expect(r.observedHashes.length).toBeLessThanOrEqual(4);
          expect(r.cleanup.confirmed).toBe(true);
        } finally {
          socket.destroy();
        }
      });
    },
  );
  it('prevents missing-Host automatic responses from bypassing request admission', async () => {
    await receiverCase(async (receiver) => {
      const { socket } = await rawInput(
        receiver,
        'POST / HTTP/1.1\r\nContent-Length: 0\r\n\r\n'.repeat(5),
      );
      try {
        const r = await receiver.finish();
        expect(r).toMatchObject({
          requests: 5,
          wrong: 4,
          reason: 'request-limit',
          verifiedCount: null,
          exact: null,
        });
        expect(r.observedHashes).toEqual([]);
      } finally {
        socket.destroy();
      }
    });
  });
  it.each(['upgrade', 'connect'])('charges %s to the same request budget', async (kind) => {
    await receiverCase(async (receiver) => {
      const first = 'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n'.repeat(4);
      const last =
        kind === 'upgrade'
          ? 'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: inert\r\n\r\n'
          : 'CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n';
      const { socket } = await rawInput(receiver, first + last);
      try {
        const r = await receiver.done;
        expect(r).toMatchObject({
          requests: 5,
          connections: 1,
          reason: 'request-limit',
          verifiedCount: null,
          exact: null,
        });
        expect(r.cleanup.confirmed).toBe(true);
      } finally {
        socket.destroy();
      }
    });
  });
  it('requires peer EOF even after a complete same-run body', async () => {
    await receiverCase(async (receiver) => {
      const wire = Buffer.concat([
        Buffer.from(
          `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${payload().length}\r\n\r\n`,
        ),
        payload(),
      ]);
      const { socket } = await rawInput(receiver, wire);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const r = await receiver.finish();
        expect(r).toMatchObject({
          matchingPayloads: 1,
          incomplete: 1,
          verifiedCount: null,
          exact: null,
          reason: 'receipt-unconfirmed',
        });
      } finally {
        socket.destroy();
      }
    });
  });
  it('keeps address selection at the numeric loopback literal and exposes no request data', async () => {
    const original = dns.lookup;
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation((...args) => {
      expect(args[0]).toBe('127.0.0.1');
      return Reflect.apply(original, dns, args);
    });
    try {
      const r = await runLoopbackControl(input);
      expect(lookup.mock.calls.every((call) => call[0] === '127.0.0.1')).toBe(true);
      expect(r.confirmed).toBe(true);
      const text = JSON.stringify(r);
      for (const word of [
        'AEGIS_PUBLIC_INERT_LOOPBACK_V1',
        '127.0.0.1',
        'Content-Length',
        'headers',
        'http://',
      ])
        expect(text).not.toContain(word);
      expect(r).not.toHaveProperty('pid');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
    } finally {
      lookup.mockRestore();
    }
  });
  it('independently hashes actual same-run bytes and closes its listener', async () => {
    await receiverCase(async (receiver) => {
      expect(receiver.port).toBeGreaterThan(0);
      expect(await send(receiver.port, payload())).toBe(204);
      const r = await receiver.finish();
      const hash = createHash('sha256').update(payload()).digest('hex');
      expect(r.expectedSha256).toBe(hash);
      expect(r.observedHashes).toEqual([hash]);
      expect(r).toMatchObject({
        connections: 1,
        requests: 1,
        completedBodies: 1,
        matchingPayloads: 1,
        verifiedCount: 1,
        exact: true,
      });
      expect(r.cleanup.confirmed).toBe(true);
      const closed = await new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port: receiver.port });
        socket.on('error', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('connect', () => {
          socket.destroy();
          resolve(false);
        });
      });
      expect(closed).toBe(true);
      expect(await receiver.finish()).toEqual(r);
    });
  });
  it.each([
    ['wrong nonce', 'control-1', 'nonce-2'],
    ['wrong run', 'control-2', 'nonce-1'],
  ])('rejects a complete %s receipt by actual hash', async (_label, runId, nonce) => {
    await receiverCase(async (receiver) => {
      expect(await send(receiver.port, payload(runId, nonce))).toBe(422);
      const r = await receiver.finish();
      expect(r).toMatchObject({
        wrong: 1,
        matchingPayloads: 0,
        verifiedCount: 0,
        exact: false,
        reason: 'wrong-receipt',
      });
      expect(r.observedHashes).toEqual([
        createHash('sha256').update(payload(runId, nonce)).digest('hex'),
      ]);
      expect(r.observedHashes[0]).not.toBe(r.expectedSha256);
    });
  });
  it('retains duplicate same-run payloads and rejects an exact-count claim', async () => {
    await receiverCase(async (receiver) => {
      expect(await send(receiver.port, payload())).toBe(204);
      expect(await send(receiver.port, payload())).toBe(409);
      const r = await receiver.finish();
      expect(r).toMatchObject({
        matchingPayloads: 2,
        duplicates: 1,
        verifiedCount: 2,
        expectedCount: 1,
        exact: false,
        reason: 'duplicate-receipt',
      });
      expect(r.observedHashes).toEqual([r.expectedSha256, r.expectedSha256]);
    });
  });
  it('refuses an oversize body without retaining it or substituting a hash', async () => {
    await receiverCase(async (receiver) => {
      expect(await send(receiver.port, Buffer.alloc(513, 65))).toBeNull();
      const r = await receiver.finish();
      expect(r).toMatchObject({
        requests: 1,
        oversize: 1,
        matchingPayloads: 0,
        verifiedCount: null,
        exact: null,
        reason: 'receipt-unconfirmed',
      });
      expect(r.observedHashes).toEqual([]);
      expect(r.cleanup.confirmed).toBe(true);
    });
  });
  it.each([
    ['GET', '/'],
    ['POST', '/elsewhere'],
  ])('rejects method/path %s %s', async (method, path) => {
    await receiverCase(async (receiver) => {
      expect(await send(receiver.port, payload(), method, path)).toBeNull();
      const r = await receiver.finish();
      expect(r).toMatchObject({ wrong: 1, verifiedCount: null, exact: null });
      expect(r.observedHashes).toEqual([]);
    });
  });
  it('retains an unobserved timeout as unavailable outcome evidence', async () => {
    await receiverCase(
      async (receiver) => {
        const r = await receiver.done;
        expect(r).toMatchObject({
          reason: 'timeout',
          requests: 0,
          matchingPayloads: 0,
          verifiedCount: null,
          exact: null,
        });
        expect(r.cleanup.confirmed).toBe(true);
      },
      { durationMs: 50 },
    );
  });
  it('cancels an unfinished owned request and confirms only its own socket cleanup', async () => {
    const controller = new AbortController();
    await receiverCase(
      async (receiver) => {
        const request = await partial(receiver.port);
        controller.abort();
        const r = await receiver.done;
        request.destroy();
        expect(r).toMatchObject({
          reason: 'cancelled',
          incomplete: 1,
          verifiedCount: null,
          exact: null,
        });
        expect(r.cleanup).toEqual({ listenerClosed: true, socketsClosed: true, confirmed: true });
      },
      { signal: controller.signal },
    );
  });
  it('does not bind or send when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await runLoopbackControl({ ...input, signal: controller.signal });
    expect(r.sender).toMatchObject({
      attempted: false,
      sentBytes: null,
      writeFinished: null,
      responseCompleted: null,
      reason: 'not-attempted',
    });
    expect(r.receiver).toMatchObject({
      connections: 0,
      requests: 0,
      verifiedCount: null,
      exact: null,
      reason: 'cancelled',
    });
    expect(r.confirmed).toBe(false);
  });
  it('closes all owned sockets after the fifth connection exceeds the finite cap', async () => {
    await receiverCase(async (receiver) => {
      const sockets = Array.from({ length: 5 }, () => {
        const socket = net.connect({ host: '127.0.0.1', port: receiver.port });
        socket.on('error', () => {});
        return socket;
      });
      try {
        const r = await receiver.done;
        expect(r).toMatchObject({
          reason: 'connection-limit',
          connections: 5,
          verifiedCount: null,
          exact: null,
        });
        expect(r.cleanup.confirmed).toBe(true);
      } finally {
        for (const socket of sockets) socket.destroy();
      }
    });
  });
  it('bounds pipelined requests independently from connection count', async () => {
    await receiverCase(async (receiver) => {
      const socket = net.connect({ host: '127.0.0.1', port: receiver.port });
      socket.on('error', () => {});
      socket.resume();
      socket.once('connect', () =>
        socket.write(`POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n`.repeat(5)),
      );
      try {
        const r = await receiver.done;
        expect(r).toMatchObject({
          reason: 'request-limit',
          requests: 5,
          connections: 1,
          verifiedCount: null,
          exact: null,
        });
        expect(r.observedHashes.length).toBeLessThanOrEqual(4);
        expect(r.cleanup.confirmed).toBe(true);
      } finally {
        socket.destroy();
      }
    });
  });
  it('does not promote a cleanup API failure even when fallback socket closure is observed', async () => {
    const close = vi.spyOn(http.Server.prototype, 'closeAllConnections').mockImplementation(() => {
      throw Error('private-cleanup');
    });
    try {
      const r = await runLoopbackControl(input);
      expect(r.receiver.reason).toBe('cleanup-api-failed');
      expect(r.receiver.verifiedCount).toBeNull();
      expect(r.confirmed).toBe(false);
      expect(JSON.stringify(r)).not.toContain('private-cleanup');
    } finally {
      close.mockRestore();
    }
  });
  it('retains sender failure separately from healthy receiver observations without leaking errors', async () => {
    const request = vi.spyOn(http, 'request').mockImplementation(() => {
      throw Error('private-request');
    });
    try {
      const r = await runLoopbackControl(input);
      expect(r.sender).toMatchObject({
        attempted: true,
        sentBytes: null,
        responseCompleted: null,
        reason: 'request-unavailable',
      });
      expect(r.receiver).toMatchObject({
        requests: 0,
        matchingPayloads: 0,
        verifiedCount: 0,
        exact: false,
        reason: 'receipt-count-mismatch',
      });
      expect(r.confirmed).toBe(false);
      expect(JSON.stringify(r)).not.toContain('private-request');
    } finally {
      request.mockRestore();
    }
  });
  it('keeps maximum length safe IDs inside the fixed public canary and output bounds', async () => {
    const r = await runLoopbackControl({
      runId: 'r'.repeat(64),
      nonce: 'n'.repeat(64),
      durationMs: 1000,
    });
    expect(r.confirmed).toBe(true);
    expect(r.sender.sentBytes).toBe(r.receiver.expectedBytes);
    expect(r.receiver.expectedBytes).toBeLessThan(512);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(8192);
  });
  it('does not queue canary bytes when the deadline passes while creating the sender request', async () => {
    const originalRequest = http.request;
    const originalClock = process.hrtime.bigint;
    let offset = 0n;
    const clock = vi
      .spyOn(process.hrtime, 'bigint')
      .mockImplementation(() => originalClock() + offset);
    const request = vi.spyOn(http, 'request').mockImplementation((...args) => {
      offset = 2_000_000_000n;
      return Reflect.apply(originalRequest, http, args);
    });
    try {
      const r = await runLoopbackControl(input);
      expect(r.sender.sentBytes).toBeNull();
      expect(r.sender.writeFinished).toBeNull();
      expect(r.sender.reason).toBe('timeout');
      expect(r.receiver.verifiedCount).toBeNull();
      expect(r.confirmed).toBe(false);
    } finally {
      request.mockRestore();
      clock.mockRestore();
    }
  });
  it.each([
    { runId: '../private' },
    { runId: '' },
    { nonce: 'private value' },
    { nonce: 'x'.repeat(65) },
    { durationMs: 49 },
    { durationMs: 3001 },
    { durationMs: Infinity },
    { durationMs: null },
    { durationMs: 1.5 },
    { host: '127.0.0.2' },
    { port: 80 },
    { endpoint: 'http://private' },
    { path: '/private' },
    { payload: 'private' },
    { file: 'private' },
    { signal: {} },
  ])('rejects open input, unsafe IDs and unbounded parameters %s', async (extra) => {
    await expect(runLoopbackControl({ ...input, ...extra })).rejects.toThrow(
      'loopback-input-invalid',
    );
  });
  it('rejects input accessors without executing them', async () => {
    let reads = 0;
    const value = { ...input };
    Object.defineProperty(value, 'nonce', {
      get() {
        reads++;
        return 'private';
      },
    });
    await expect(runLoopbackControl(value)).rejects.toThrow('loopback-input-invalid');
    expect(reads).toBe(0);
  });
});
