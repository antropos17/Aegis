import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';

/** Start one test-owned loopback server; every effect stays in its in-memory state.
 * @param {object} tool Synthetic accepted definition.
 * @param {object|undefined} tlsOptions Explicit disposable TLS key/cert options.
 * @returns {Promise<object>} Server address, bounded-test state and explicit socket cleanup.
 * @since v0.15.1 */
export async function httpFixture(tool, tlsOptions) {
  const state = {
    mode: 'json',
    token: 'PRIVATE_FIXTURE_TOKEN_'.repeat(3),
    session: 'PRIVATE_SESSION',
    messages: [],
    connections: 0,
    connects: [],
    calls: [],
    deletes: 0,
    lists: 0,
  };
  const handler = async (request, response) => {
    response.on('error', () => {});
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    state.messages.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      message,
    });
    if (request.headers.authorization !== `Bearer ${state.token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === 'DELETE') {
      state.deletes++;
      if (state.mode === 'cleanup-hang') return;
      response.writeHead(state.mode === 'cleanup-refuse' ? 405 : 204).end();
      return;
    }
    if (
      message.method === 'notifications/cancelled' ||
      message.method === 'notifications/initialized'
    ) {
      response.writeHead(202).end(state.mode === 'bad-notification' ? 'PRIVATE_UNEXPECTED' : '');
      return;
    }
    const reply = (result) => {
      if (state.mode === 'informational') for (let i = 0; i < 5; i++) response.writeContinue();
      if (state.mode === 'upgrade') {
        response.writeHead(101, { Connection: 'Upgrade', Upgrade: 'PRIVATE' }).end();
        return;
      }
      const data = JSON.stringify({
        jsonrpc: '2.0',
        id: state.mode === 'wrong-id' ? 'wrong' : message.id,
        result,
      });
      if (state.mode === 'redirect') {
        response.writeHead(307, { location: state.redirect }).end();
        return;
      }
      if (state.mode === 'oversize') {
        response.writeHead(200, { 'content-type': 'application/json' }).end('x'.repeat(16385));
        return;
      }
      if (state.mode === 'bad-utf8') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(Buffer.from([255]));
        return;
      }
      if (state.mode === 'compressed') {
        response
          .writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
          .end(data);
        return;
      }
      const event = 'id: event1\ndata: \n\nevent: message\ndata: ' + data + '\n\n';
      if (state.mode.startsWith('sse')) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        if (state.mode === 'sse-open') {
          response.write(event);
          return;
        }
        const bad = 'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n';
        response.end(state.mode === 'sse-extra' ? event + bad : event);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(data);
    };
    if (message.method === 'initialize') {
      if (state.mode !== 'no-session') response.setHeader('MCP-Session-Id', state.session);
      if (state.mode === 'duplicate-session')
        response.setHeader('MCP-Session-Id', [state.session, 'OTHER']);
      if (state.mode === 'hang-init') return;
      reply({
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      });
    } else if (message.method === 'tools/list') {
      state.lists++;
      state.onList?.(state.lists);
      if (state.lists > 1 && state.mode === 'expired') {
        response.writeHead(404).end();
        return;
      }
      if (state.lists > 1 && state.mode === 'reset') {
        response.destroy();
        return;
      }
      if (state.lists > 1 && state.mode === 'rotate-session')
        response.setHeader('MCP-Session-Id', 'OTHER');
      reply({
        tools: [
          {
            ...tool,
            ...(state.lists > 1 && state.mode === 'catalog-change'
              ? { description: 'changed' }
              : {}),
          },
        ],
      });
    } else if (message.method === 'tools/call') {
      state.calls.push(message);
      if (state.mode === 'hang-call') return;
      state.onCall?.();
      const structuredContent = state.structuredContent ?? { accepted: true };
      reply({
        structuredContent,
        content: [
          {
            type: 'text',
            text:
              state.mode === 'bad-result' ? 'PRIVATE_UNCHECKED' : JSON.stringify(structuredContent),
          },
        ],
      });
    } else response.writeHead(400).end();
  };
  const server = tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler);
  server.on('tlsClientError', () => {});
  server.on('connect', (request, socket) => {
    state.connects.push(request.url);
    socket.on('error', () => {});
    socket.end('HTTP/1.1 502 Fixture Proxy Rejected\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('connection', () => {
    state.connections++;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    state,
    server,
    url: `${tlsOptions ? 'https://mcp.fixture.test' : 'http://127.0.0.1'}:${server.address().port}/mcp`,
    close: async () => {
      const done = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await done;
    },
  };
}
