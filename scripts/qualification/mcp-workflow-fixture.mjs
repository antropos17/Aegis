import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

export const SCOPE = Object.freeze({
  account: 'dummy-account',
  repository: 'dummy-repository',
  recipient: 'dummy-recipient',
  operation: 'dummy-operation',
  payload: 'dummy-byte-effect',
});
export const SECRET = 'DUMMY_KNOWN_SECRET_CANARY_20260930';
const shape = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const TOOLS = ['dummy_filesystem_write', 'dummy_api_delivery'].map((name) => ({
  name,
  inputSchema: shape(
    Object.fromEntries(Object.keys(SCOPE).map((key) => [key, { type: 'string', maxLength: 128 }])),
  ),
  outputSchema: shape({ accepted: { type: 'boolean' }, note: { type: 'string', maxLength: 128 } }),
}));

/** Start a fixed disposable loopback receiver, never an operator-selected server.
 * Every tool delivery is counted before interpretation, including forbidden scope.
 * @param {string} directory Generated private fixture directory.
 * @returns {Promise<object>} Receiver controls and independent disk observations. @since v0.17.0 */
export async function createWorkflowFixture(directory) {
  const token = randomBytes(32).toString('hex'),
    replacementToken = randomBytes(32).toString('hex');
  const accounts = new Map([
    [token, SCOPE.account],
    [replacementToken, 'other-account'],
  ]);
  const control = { mode: 'normal', redirect: '', onList: null, onEffect: null };
  const counts = {
    requests: 0,
    deliveries: 0,
    forbidden: 0,
    effects: 0,
    lists: 0,
    sessions: 0,
    errors: 0,
  };
  const sockets = new Set();
  const approved = path.join(directory, 'approved.bin'),
    forbidden = path.join(directory, 'forbidden.bin');
  const handler = async (request, response) => {
    response.on('error', () => {});
    try {
      if (counts.requests >= 96) {
        void close();
        throw Error('fixture-limit');
      }
      counts.requests++;
      if (request.url !== '/mcp') throw Error('fixture-limit');
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        if ((bytes += chunk.length) > 8192) throw Error('fixture-limit');
        chunks.push(chunk);
      }
      const message = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      if (message?.method === 'tools/call') counts.deliveries++;
      const account = accounts.get(request.headers.authorization?.slice(7));
      if (!account || !request.headers.authorization.startsWith('Bearer ')) {
        if (message?.method === 'tools/call') counts.forbidden++;
        response.writeHead(401).end();
        return;
      }
      if (request.method === 'DELETE') {
        response.writeHead(204).end();
        return;
      }
      if (message?.method?.startsWith('notifications/')) {
        response.writeHead(202).end();
        return;
      }
      const reply = (result) =>
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      if (message?.method === 'initialize') {
        response.setHeader('MCP-Session-Id', `DUMMY_SESSION_${++counts.sessions}`);
        reply({
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'dummy', version: '1' },
        });
      } else if (message?.method === 'tools/list') {
        counts.lists++;
        await control.onList?.(counts.lists);
        if (control.mode === 'redirect') {
          response.writeHead(307, { location: control.redirect }).end();
          return;
        }
        reply({
          tools:
            control.mode === 'catalog-change'
              ? [{ ...TOOLS[0], description: 'changed' }, TOOLS[1]]
              : TOOLS,
        });
      } else if (message?.method === 'tools/call') {
        const args = message.params?.arguments;
        const valid =
          account === SCOPE.account &&
          Object.entries(SCOPE).every(([key, value]) => args?.[key] === value) &&
          Object.keys(args).length === Object.keys(SCOPE).length &&
          TOOLS.some((tool) => tool.name === message.params.name);
        if (!valid) counts.forbidden++;
        // The byte effect remains observable even if a broken gateway forwards forbidden scope.
        const effect =
          message.params?.name === TOOLS[0].name
            ? Buffer.from(args?.payload || '')
            : Buffer.from([0x45]);
        if (effect.length > 128) throw Error('fixture-limit');
        await fs.writeFile(valid ? approved : forbidden, effect, { flag: 'wx', mode: 0o600 });
        counts.effects++;
        control.onEffect?.();
        if (control.mode === 'lost-response') {
          response.destroy();
          return;
        }
        if (control.mode === 'hang-call') return;
        const structuredContent = {
          accepted: true,
          note: control.mode === 'secret-response' ? SECRET : 'dummy-ack',
        };
        reply({
          structuredContent,
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredContent),
            },
          ],
        });
      } else response.writeHead(400).end();
    } catch {
      counts.errors++;
      response.writeHead(500).end();
    }
  };
  const server = http.createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 },
    handler,
  );
  server.on('connection', (socket) => {
    if (sockets.size >= 16) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });
  let closing;
  function close() {
    closing ||= new Promise((resolve) => server.close(() => resolve()));
    for (const socket of sockets) socket.destroy();
    return closing;
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const read = async (file) => {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128)
        throw Error('fixture-observation-invalid');
      return await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  return {
    token,
    replacementToken,
    control,
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    observe: async () => ({
      ...counts,
      approved: await read(approved),
      forbiddenBytes: await read(forbidden),
    }),
    close,
  };
}
