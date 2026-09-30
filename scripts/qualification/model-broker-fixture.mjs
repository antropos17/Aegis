import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { createModelFixtureLifecycle } from './model-fixture-lifecycle.mjs';

export const MODEL = 'dummy-text-model';
export const INPUT = Object.freeze({
  messages: [{ role: 'user', content: 'dummy-input-canary' }],
  maxOutputTokens: 32,
});
export const OUTPUT = 'dummy-model-output';
const certificates = new URL('../../tests/main/fixtures/mcp-tls/', import.meta.url);
const readCertificate = (name) => fs.readFile(new URL(name, certificates), 'utf8');
const hashCertificate = (pem) =>
  createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const encodings = {
  'secret-raw': (token) => token,
  'secret-base64': (token) => Buffer.from(token).toString('base64'),
  'secret-base64url': (token) => Buffer.from(token).toString('base64url'),
  'secret-hex': (token) => Buffer.from(token).toString('hex'),
  'secret-percent': (token) =>
    [...Buffer.from(token)].map((byte) => '%' + byte.toString(16)).join(''),
};

/** Start only a fixed generated dummy model receiver and disposable store.
 * @param {{secure?: boolean, mode?: string}} options Trusted fixed test mode.
 * @returns {Promise<object>} Private fixture route, bounded counters and cleanup. @since v0.17.0 */
export async function createModelFixture({ secure = false, mode = 'json' } = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-model-fixture-'));
  const lifecycle = createModelFixtureLifecycle(root, parent);
  try {
    const ledgerPath = path.join(root, 'ledger'),
      endpointPath = path.join(root, 'endpoint.json');
    await fs.mkdir(ledgerPath);
    const token = randomBytes(32).toString('hex');
    const state = {
      mode,
      connections: 0,
      deliveries: 0,
      authorized: 0,
      requestMatches: true,
      spentBeforeDelivery: true,
      onDelivery: null,
      redirect: '',
    };
    const sockets = lifecycle.sockets;
    const expected = JSON.stringify({
      model: MODEL,
      messages: INPUT.messages,
      max_output_tokens: INPUT.maxOutputTokens,
    });
    const handler = async (request, response) => {
      response.on('error', () => {});
      if (++state.deliveries > 32) {
        void close();
        return;
      }
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          if ((size += chunk.length) > 16384) throw Error('fixture-limit');
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        state.authorized += Number(request.headers.authorization === `Bearer ${token}`);
        state.requestMatches &&=
          body.toString('utf8') === expected &&
          request.method === 'POST' &&
          request.url === '/model';
        body.fill(0);
        state.spentBeforeDelivery &&= (await fs.readdir(ledgerPath)).some((name) =>
          name.endsWith('.spent'),
        );
        state.onDelivery?.();
        if (state.mode === 'hang') return;
        if (state.mode === 'lost-response') {
          response.destroy();
          return;
        }
        if (state.mode === 'redirect') {
          response.writeHead(307, { location: state.redirect }).end();
          return;
        }
        if (state.mode === 'oversized-headers') {
          response.writeHead(200, { 'x-dummy': 'x'.repeat(8193) }).end('{}');
          return;
        }
        if (state.mode === 'duplicate-header') {
          response
            .writeHead(200, [
              ['Content-Type', 'application/json'],
              ['Content-Type', 'application/json'],
            ])
            .end('{}');
          return;
        }
        if (state.mode === 'oversized') {
          response.writeHead(200, { 'content-type': 'application/json' }).end('x'.repeat(16385));
          return;
        }
        if (state.mode === 'bad-utf8') {
          response.writeHead(200, { 'content-type': 'application/json' }).end(Buffer.from([255]));
          return;
        }
        const output = encodings[state.mode]
          ? encodings[state.mode](token)
          : state.mode === 'secret-json-escaped'
            ? token
            : OUTPUT;
        if (state.mode.startsWith('sse')) {
          const selected =
            state.mode === 'sse-secret-chunks'
              ? token
              : state.mode === 'sse-secret-base64'
                ? Buffer.from(token).toString('base64')
                : OUTPUT;
          let data =
            frame('start', { model: MODEL }) +
            frame('delta', { text: selected.slice(0, 4) }) +
            frame('delta', { text: selected.slice(4) });
          if (state.mode !== 'sse-truncated') data += frame('complete', { finishReason: 'stop' });
          if (state.mode === 'sse-reordered')
            data =
              frame('delta', { text: OUTPUT }) +
              frame('start', { model: MODEL }) +
              frame('complete', { finishReason: 'stop' });
          if (state.mode === 'sse-after-complete') data += frame('delta', { text: 'trailing' });
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          for (let i = 0; i < data.length; i += 7) {
            response.write(data.slice(i, i + 7));
            await new Promise((done) => setImmediate(done));
          }
          response.end();
          return;
        }
        let data = JSON.stringify({
          model: state.mode === 'wrong-model' ? 'other-model' : MODEL,
          output,
          finishReason: state.mode === 'incomplete' ? 'length' : 'stop',
        });
        if (state.mode === 'secret-json-escaped')
          data = data.replace(
            token,
            [...token]
              .map((letter) => '\\u' + letter.charCodeAt(0).toString(16).padStart(4, '0'))
              .join(''),
          );
        response
          .writeHead(200, {
            'content-type': 'application/json',
            ...(state.mode === 'compressed' ? { 'content-encoding': 'gzip' } : {}),
          })
          .end(data);
      } catch {
        response.destroy();
      }
    };
    const cert = secure ? await readCertificate('server.pem') : null;
    const key = secure ? await readCertificate('server.key') : null;
    const server = secure ? https.createServer({ cert, key }, handler) : http.createServer(handler);
    lifecycle.attach(server);
    server.on('tlsClientError', () => {});
    server.on('connection', (socket) => {
      state.connections++;
      if (sockets.size >= 8) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.setTimeout(5000, () => socket.destroy());
      socket.on('close', () => sockets.delete(socket));
    });
    const close = lifecycle.stop;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const descriptor = secure
      ? {
          schemaVersion: 2,
          url: `https://mcp.fixture.test:${server.address().port}/model`,
          connectAddress: '127.0.0.1',
          bearerToken: token,
          caCertificate: await readCertificate('ca.pem'),
          certificateSha256: hashCertificate(cert),
        }
      : {
          schemaVersion: 1,
          url: `http://127.0.0.1:${server.address().port}/model`,
          bearerToken: token,
        };
    await fs.writeFile(endpointPath, JSON.stringify(descriptor), { flag: 'wx', mode: 0o600 });
    return {
      root,
      parent,
      endpointPath,
      ledgerPath,
      descriptor,
      token,
      state,
      server,
      replaceCertificate: async (name) => {
        if (!['wrong-name', 'expired', 'untrusted', 'rotated'].includes(name) || !secure)
          throw Error('fixture-certificate-invalid');
        server.setSecureContext({
          cert: await readCertificate(`${name}.pem`),
          key: await readCertificate(name === 'untrusted' ? 'untrusted.key' : 'server.key'),
        });
      },
      close: lifecycle.cleanup,
    };
  } catch (original) {
    let cleanupFailure;
    try {
      await lifecycle.cleanup();
    } catch (cleanup) {
      cleanupFailure = cleanup;
    }
    if (cleanupFailure)
      throw new AggregateError([original, cleanupFailure], 'fixture-setup-cleanup-failed', {
        cause: original,
      });
    throw original;
  }
}
