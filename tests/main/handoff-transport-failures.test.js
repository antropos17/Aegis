import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { Readable, PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { startHandoffCollector } = require('../../src/main/handoff-live');
const { sendHandoffEvent } = require('../../src/main/handoff-send');
const token = 'c'.repeat(64);
const event = JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a' });

describe('transport failure containment', () => {
  it.each([
    'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n',
    'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: PRIVATE\r\nContent-Length: 5\r\n\r\n',
    `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nPrivate: ${'x'.repeat(5000)}\r\n\r\n`,
    'INVALID PRIVATE\r\n\r\n',
  ])('rejects parser/upgrade/expectation input %# with visible loss', async (raw) => {
    const collector = await startHandoffCollector({ port: 0, token, durationMs: 10000 });
    try {
      await new Promise((resolve) => {
        const socket = net.connect(collector.port, '127.0.0.1', () => socket.write(raw));
        socket.on('data', () => {});
        socket.on('error', () => {});
        socket.on('close', resolve);
      });
      const report = await collector.close();
      expect(report.receiver.lossDetected).toBe(true);
      expect(report.events).toEqual([]);
      expect(JSON.stringify(report)).not.toContain('PRIVATE');
    } finally {
      await collector.close();
    }
  });

  it.each([200, 302, 401, 500])(
    'does not interpret response text or redirects (%s)',
    async (status) => {
      let requests = 0;
      const server = http.createServer((_req, res) => {
        requests++;
        res.writeHead(status, { Location: 'http://example.invalid/PRIVATE' });
        res.end('{"decision":"block","reason":"PRIVATE"}');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        expect(
          await sendHandoffEvent(Readable.from([event]), { port: server.address().port, token }),
        ).toBe(1);
        expect(requests).toBe(1);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );

  it('times out stalled stdin without opening a connection', async () => {
    const collector = await startHandoffCollector({ port: 0, token, durationMs: 10000 });
    try {
      expect(await sendHandoffEvent(new PassThrough(), { port: collector.port, token })).toBe(1);
      expect((await collector.close()).usage.requests).toBe(0);
    } finally {
      await collector.close();
    }
  });

  it('times out a stalled HTTP peer and closes the connection', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      expect(
        await sendHandoffEvent(Readable.from([event]), { port: server.address().port, token }),
      ).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
