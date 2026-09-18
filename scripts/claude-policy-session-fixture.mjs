/** TEST ONLY: bounded provider-hook relay; never imported by production application code. */
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { quote } from './claude-hook-fixture.mjs';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(import.meta.url);
const MAX_BYTES = 65536;
const PORT = 'AEGIS_TEST_POLICY_PORT';
const TOKEN = 'AEGIS_TEST_POLICY_TOKEN';
const decisionOutput = (decision) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
    permissionDecisionReason: 'AEGIS test fixture policy decision.',
  },
});

/** Start only with disposable fixture policy and isolated child environment.
 * @param {{policyPath:string, env:object}} options Test context.
 * @returns {Promise<object>} Hook command and redacted close receipt. @since v0.15.1 */
export async function startPolicySessionFixture({ policyPath, env }) {
  const { createActionPolicySession } = require('../src/main/action-policy-session.js');
  const session = createActionPolicySession({ policyPath });
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const sockets = new Set();
  const observed = { before: [], after: [] };
  const counts = { requests: 0, connections: 0, rejected: 0, bytes: 0 };
  let closed = false;
  let deadline;
  let closePromise;
  let port;
  const server = http.createServer({ maxHeaderSize: 4096 }, (req, res) => {
    const auth = Buffer.from(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
    );
    if (
      closed ||
      ++counts.requests > 16 ||
      req.method !== 'POST' ||
      !['/before', '/after'].includes(req.url) ||
      req.headers.host !== `127.0.0.1:${port}` ||
      req.headers.origin ||
      req.headers['content-type'] !== 'application/json' ||
      req.headers['content-encoding'] ||
      auth.length !== expected.length ||
      !timingSafeEqual(auth, expected)
    ) {
      counts.rejected++;
      res.writeHead(403, { Connection: 'close' });
      res.end();
      return;
    }
    const chunks = [];
    let bytes = 0;
    req.on('error', () => {
      counts.rejected++;
    });
    req.on('data', (chunk) => {
      bytes += chunk.length;
      counts.bytes += chunk.length;
      if (bytes > MAX_BYTES || counts.bytes > 4 * MAX_BYTES) {
        counts.rejected++;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (closed || req.destroyed) return;
      const raw = Buffer.concat(chunks);
      chunks.length = 0;
      try {
        const before = req.url === '/before';
        const result = before ? await session.before(raw) : session.after(raw);
        observed[before ? 'before' : 'after'].push(result);
        if (closed || res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify(before ? { decision: result.decision } : { status: result.status }));
      } catch {
        counts.rejected++;
        res.writeHead(500, { Connection: 'close' });
        res.end();
      } finally {
        raw.fill(0);
      }
    });
  });
  server.maxHeadersCount = 12;
  server.maxConnections = 2;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 2000;
  server.on('connection', (socket) => {
    if (++counts.connections > 16 || closed) {
      counts.rejected++;
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const timeout = setTimeout(() => {
      counts.rejected++;
      socket.destroy();
    }, 2000);
    socket.on('close', () => {
      clearTimeout(timeout);
      sockets.delete(socket);
    });
  });
  server.on('clientError', (_error, socket) => {
    counts.rejected++;
    socket.destroy();
  });
  server.on('upgrade', (_req, socket) => {
    counts.rejected++;
    socket.destroy();
  });
  server.on('checkContinue', (_req, res) => {
    counts.rejected++;
    res.writeHead(417);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  env[TOKEN] = token;
  env[PORT] = String(port);
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(deadline);
    delete env[TOKEN];
    delete env[PORT];
    expected.fill(0);
    for (const socket of sockets) socket.destroy();
    const report = session.close();
    closePromise = new Promise((resolve) =>
      server.close(() =>
        resolve({
          testOnly: true,
          before: observed.before.map((item) => ({
            decision: item.decision,
            hasActionRef: typeof item.actionRef === 'string',
          })),
          after: observed.after.map((item) => ({
            status: item.status,
            outcome: item.outcome,
            sameActionRef: observed.before.some(
              (prior) => prior.actionRef && prior.actionRef === item.actionRef,
            ),
          })),
          closed: report.closed,
          lossDetected: report.lossDetected,
          actions: report.actions.map((item) => ({
            decision: item.decision,
            state: item.state,
            outcome: item.outcome,
          })),
          transport: { ...counts },
        }),
      ),
    );
    return closePromise;
  };
  deadline = setTimeout(close, 25000);
  return { command: `${quote(process.execPath)} ${quote(filename)} --send`, close };
}

async function send() {
  const token = process.env[TOKEN];
  const port = Number(process.env[PORT]);
  if (!/^[a-f0-9]{64}$/.test(token || '') || !Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('config');
  let timeout;
  let request;
  let activeResponse;
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, output = null) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      if (error) {
        request?.destroy();
        activeResponse?.destroy();
        process.stdin.destroy();
        reject(error);
      } else resolve(output);
    };
    timeout = setTimeout(() => {
      finish(Error('timeout'));
    }, 2000);
    process.stdin.on('error', () => finish(Error('stdin')));
    process.stdin.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        finish(Error('size'));
      } else chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks);
      chunks.length = 0;
      let input;
      try {
        input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('shape');
      } catch {
        finish(Error('json'));
        return;
      } finally {
        raw.fill(0);
      }
      const before = input.hook_event_name === 'PreToolUse';
      if (!before && !['PostToolUse', 'PostToolUseFailure'].includes(input.hook_event_name)) {
        finish(Error('event'));
        return;
      }
      const projected = Buffer.from(
        JSON.stringify(
          Object.fromEntries(
            ['hook_event_name', 'session_id', 'tool_use_id', 'cwd', 'tool_name', 'tool_input'].map(
              (key) => [key, input[key]],
            ),
          ),
        ),
      );
      request = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: before ? '/before' : '/after',
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': projected.length,
          },
        },
        (response) => {
          activeResponse = response;
          if (settled) {
            response.destroy();
            return;
          }
          let body = '';
          response.on('data', (chunk) => {
            if (settled) return;
            body += chunk;
            if (Buffer.byteLength(body) > 4096) {
              finish(Error('response'));
            }
          });
          response.on('error', () => finish(Error('response')));
          response.on('end', () => {
            if (settled) return;
            try {
              if (response.statusCode !== 200) throw Error('status');
              const result = JSON.parse(body);
              if (before) {
                if (!['allow', 'deny', 'ask'].includes(result.decision)) throw Error('decision');
              } else if (result.status !== 'linked') throw Error('link');
              finish(null, before ? decisionOutput(result.decision) : null);
            } catch {
              finish(Error('response'));
            }
          });
        },
      );
      request.on('error', () => finish(Error('request')));
      request.end(projected, () => projected.fill(0));
    });
  }).finally(() => clearTimeout(timeout));
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  if (process.argv.length !== 3 || process.argv[2] !== '--send') process.exitCode = 1;
  else
    send()
      .then((output) => {
        if (output) console.log(JSON.stringify(output));
      })
      .catch(() => {
        console.log(JSON.stringify(decisionOutput('deny')));
        process.exitCode = 2;
      });
}
