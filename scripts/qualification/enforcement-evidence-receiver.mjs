import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
export const tool = Object.freeze({
  name: 'record',
  inputSchema: {
    type: 'object',
    properties: { recipient: { type: 'string', maxLength: 16 } },
    required: ['recipient'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { accepted: { type: 'boolean' } },
    required: ['accepted'],
    additionalProperties: false,
  },
});
/** Fixed loopback receiver writes the effect independently, including on missing consume records.
 * @param {string} root Exact generated directory. @param {string} grantId Owner-selected expected ID.
 * @param {Function} operation Owner callback mapping, never RPC input.
 * @param {string} mode Finite generated fault. @returns {Promise<object>} Bounded receiver. @since v0.17.0 */
export async function createEvidenceReceiver(root, grantId, operation, mode) {
  const token = randomBytes(32).toString('hex'),
    session = randomUUID(),
    observations = [],
    sockets = new Set();
  let count = 0,
    setup = false;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url !== '/fixture' || request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(403).end();
        return;
      }
      if (request.method === 'DELETE') {
        response.writeHead(204).end();
        return;
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 8192) throw Error('receiver-bound');
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const reply = (value) =>
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: value }));
      if (message.method === 'initialize') {
        response.setHeader('MCP-Session-Id', session);
        reply({
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1' },
        });
      } else if (
        message.method === 'notifications/initialized' ||
        message.method === 'notifications/cancelled'
      )
        response.writeHead(202).end();
      else if (message.method === 'tools/list') reply({ tools: [tool] });
      else if (message.method === 'tools/call') {
        if (++count > 2) throw Error('receiver-count');
        const expected = createHash('sha256').update(grantId).digest('hex') + '.used';
        let consumedRecord = 'absent';
        try {
          const files = await fs.readdir(path.join(root, 'grants'));
          if (files.includes(expected)) {
            const file = path.join(root, 'grants', expected),
              stat = await fs.lstat(file);
            consumedRecord = 'malformed';
            if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64) {
              const handle = await fs.open(file, 'r');
              try {
                const bytes = Buffer.alloc(65),
                  read = await handle.read(bytes, 0, bytes.length, 0);
                consumedRecord = bytes
                  .subarray(0, read.bytesRead)
                  .equals(Buffer.from('{"consumed":true}\n'))
                  ? 'exact'
                  : 'malformed';
              } finally {
                await handle.close();
              }
            }
          } else if (files.some((file) => file.endsWith('.used'))) consumedRecord = 'wrong-id';
        } catch {
          consumedRecord = 'malformed';
        }
        // Always write independently of consume validation: bypass remains visible.
        await fs.writeFile(path.join(root, 'effect-' + count + '.txt'), 'dummy-effect', {
          flag: 'wx',
        });
        const effect = (await fs.readFile(path.join(root, 'effect-' + count + '.txt'))).equals(
          Buffer.from('dummy-effect'),
        )
          ? 'expected'
          : 'unexpected';
        observations.push(Object.freeze({ operationId: operation(), consumedRecord, effect }));
        if (mode === 'lost-response') response.destroy();
        else
          reply({
            structuredContent: { accepted: true },
            content: [{ type: 'text', text: '{"accepted":true}' }],
          });
      } else response.writeHead(400).end();
    } catch {
      response.destroy();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (sockets.size > 16) socket.destroy();
  });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    setup = true;
    const url = `http://127.0.0.1:${server.address().port}/fixture`;
    return {
      endpoint: { schemaVersion: 1, url, bearerToken: token },
      observations,
      close,
      count: () => count,
    };
  } finally {
    if (!setup) await close();
  }
}
