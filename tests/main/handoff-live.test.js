import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
const require = createRequire(import.meta.url);
const { startHandoffCollector, LIMITS } = require('../../src/main/handoff-live');
const { sendHandoffEvent } = require('../../src/main/handoff-send');
const token = 'a'.repeat(64);
const input = (extra = {}) =>
  JSON.stringify({
    hook_event_name: 'SubagentStart',
    session_id: 'PRIVATE_SESSION',
    agent_id: 'PRIVATE_AGENT',
    ...extra,
  });
const collectors = [];
async function start(options = {}) {
  const collector = await startHandoffCollector({ port: 0, token, durationMs: 20000, ...options });
  collectors.push(collector);
  return collector;
}
function post(port, body = input(), headers = {}, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/lifecycle',
        method: 'POST',
        agent: false,
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Aegis-Version': '1',
          'X-Aegis-Delivery': randomUUID(),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.end(body);
  });
}
afterEach(async () => {
  for (const collector of collectors.splice(0)) await collector.close();
  vi.restoreAllMocks();
});

describe('finite loopback lifecycle intake', () => {
  it('authenticates only bearer possession and retains unbound metadata without a policy decision', async () => {
    const c = await start();
    expect(
      await post(
        c.port,
        input({
          pid: 123,
          decision: 'allow',
          verified: true,
          last_assistant_message: 'PRIVATE_SECRET',
          transcript_path: 'PRIVATE_PATH',
        }),
      ),
    ).toEqual({ status: 204, text: '' });
    const report = await c.close();
    expect(report.events).toHaveLength(1);
    expect(report.events[0]).toMatchObject({
      provenance: 'source-reported',
      sourceAuthentication: 'bearer-possession',
      processBinding: 'unbound',
      decision: 'not-applicable',
    });
    expect(report.receiver).toMatchObject({
      state: 'closed',
      sequenceScope: 'receiver-arrival',
      transport: 'loopback-http',
      activityCoverage: 'unknown',
    });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|123|aaaaaa/);
  });

  it('rejects duplicate delivery IDs but preserves repeated lifecycle events with new IDs', async () => {
    const c = await start();
    const headers = { 'X-Aegis-Delivery': randomUUID() };
    expect((await post(c.port, input(), headers)).status).toBe(204);
    expect((await post(c.port, input(), headers)).status).toBe(409);
    expect((await post(c.port)).status).toBe(204);
    const report = await c.close();
    expect(report.events).toHaveLength(2);
    expect(report.events[0].agentRef).toBe(report.events[1].agentRef);
    expect(report.usage.duplicates).toBe(1);
    expect(report.receiver.lossDetected).toBe(true);
  });

  it('reserves delivery IDs on malformed payloads and reports rejected input', async () => {
    const c = await start();
    const headers = { 'X-Aegis-Delivery': randomUUID() };
    expect((await post(c.port, '{PRIVATE', headers)).status).toBe(422);
    expect((await post(c.port, input(), headers)).status).toBe(409);
    expect((await post(c.port, input({ hook_event_name: 'PreToolUse' }))).status).toBe(422);
    expect((await c.close()).events).toEqual([]);
  });

  it.each([
    [{ Authorization: 'Bearer PRIVATE' }, {}, 401],
    [{ 'X-Aegis-Version': '2' }, {}, 400],
    [{ 'X-Aegis-Delivery': 'PRIVATE' }, {}, 400],
    [{ Origin: 'https://example.invalid' }, {}, 400],
    [{ Host: 'example.invalid' }, {}, 400],
    [{ 'Content-Encoding': 'gzip' }, {}, 400],
    [{ 'Content-Type': 'text/plain' }, {}, 400],
    [{}, { path: '/PRIVATE' }, 400],
    [{}, { method: 'PUT' }, 400],
  ])('rejects unauthorized or incompatible transport %#', async (headers, options, status) => {
    const c = await start();
    expect((await post(c.port, input(), headers, options)).status).toBe(status);
    const report = await c.close();
    expect(report.events).toEqual([]);
    expect(report.receiver.lossDetected).toBe(true);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it('closes oversized requests, refuses slow connections and remains bounded', async () => {
    const c = await start();
    expect((await post(c.port, 'x'.repeat(65537))).status).toBe(0);
    const sockets = Array.from({ length: LIMITS.concurrent + 1 }, () =>
      net.connect(c.port, '127.0.0.1'),
    );
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise((resolve) => {
            socket.on('error', () => {});
            socket.on('close', resolve);
          }),
      ),
    );
    const report = await c.close();
    expect(report.receiver.lossDetected).toBe(true);
    expect(report.events).toHaveLength(0);
  }, 7000);

  it('rate limits intake without returning provider-visible decisions', async () => {
    const c = await start();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    for (let i = 0; i < LIMITS.perSecond; i++) expect((await post(c.port)).status).toBe(204);
    expect(await post(c.port)).toEqual({ status: 429, text: '' });
    expect((await c.close()).events).toHaveLength(LIMITS.perSecond);
  });

  it('stops at the aggregate byte budget and revokes the listener', async () => {
    const c = await start();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 1000));
    const body = input({ ignored: 'x'.repeat(64000) });
    for (let i = 0; i < 140; i++) {
      if ((await post(c.port, body)).status === 0) break;
    }
    const report = await c.done;
    expect(report.reason).toBe('byte-limit');
    expect(report.usage.bytes).toBeGreaterThan(LIMITS.bytes);
    expect(report.usage.bytes).toBeLessThanOrEqual(LIMITS.bytes + 65536);
    expect(report.receiver.lossDetected).toBe(true);
    expect((await post(c.port)).status).toBe(0);
  });

  it('stops at the accepted event budget even for valid authenticated input', async () => {
    const c = await start();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 1000));
    for (let i = 0; i < 2001; i++) await post(c.port);
    const report = await c.done;
    expect(report.reason).toBe('receiver-limit');
    expect(report.events).toHaveLength(2000);
    expect(report.receiver.lossDetected).toBe(true);
  }, 15000);

  it('expires, frees its port, and isolates a restarted source epoch', async () => {
    const c = await start({ durationMs: 100 });
    await post(c.port);
    const report = await c.done;
    expect(report.reason).toBe('deadline');
    const next = await start({ port: c.port });
    await post(next.port);
    const second = await next.close();
    expect(second.events[0].agentRef).not.toBe(report.events[0].agentRef);
  });

  it('reports fixed startup errors and never changes an existing listener', async () => {
    const c = await start();
    await expect(start({ port: c.port })).rejects.toThrow('live-listen-unavailable');
    await expect(start({ token: 'PRIVATE' })).rejects.toThrow('live-configuration-invalid');
    expect((await post(c.port)).status).toBe(204);
  });

  it('counts an interrupted authenticated body as lost without retaining it', async () => {
    const c = await start();
    const socket = net.connect(c.port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(
      `POST /v1/lifecycle HTTP/1.1\r\nHost: 127.0.0.1:${c.port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nX-Aegis-Version: 1\r\nX-Aegis-Delivery: ${randomUUID()}\r\nContent-Length: 900\r\n\r\nPRIVATE`,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    socket.destroy();
    const report = await c.close();
    expect(report.receiver.lossDetected).toBe(true);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });
});

describe('hook sender projection', () => {
  it('sends real HTTP and discards non-allowlisted fields before the socket', async () => {
    let received;
    const server = http.createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => {
        text += chunk;
      });
      req.on('end', () => {
        received = text;
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      expect(
        await sendHandoffEvent(
          Readable.from([input({ prompt: 'CANARY', last_assistant_message: 'CANARY' })]),
          { port: server.address().port, token },
        ),
      ).toBe(0);
      expect(JSON.parse(received)).toEqual(JSON.parse(input()));
      expect(received).not.toContain('CANARY');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('delivers start and stop through the collector and fails without an available source', async () => {
    const c = await start();
    for (const hook_event_name of ['SubagentStart', 'SubagentStop'])
      expect(
        await sendHandoffEvent(Readable.from([input({ hook_event_name })]), {
          port: c.port,
          token,
        }),
      ).toBe(0);
    expect((await c.close()).events.map((e) => e.kind)).toEqual([
      'subagent-start',
      'subagent-stop',
    ]);
    expect(await sendHandoffEvent(Readable.from([input()]), { port: c.port, token })).toBe(1);
  });

  it.each(['{PRIVATE', 'x'.repeat(65537), input({ hook_event_name: 'PreToolUse' })])(
    'rejects invalid stdin %#',
    async (body) => {
      const c = await start();
      expect(await sendHandoffEvent(Readable.from([body]), { port: c.port, token })).toBe(1);
      expect((await c.close()).usage.requests).toBe(0);
    },
  );
});
