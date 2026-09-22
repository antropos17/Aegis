import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHttpEndpoint } = require('../../src/main/mcp-gateway-route');
const { parseHttpReply } = require('../../src/main/mcp-gateway-http-wire');
const descriptor = {
  schemaVersion: 1,
  url: 'http://127.0.0.1:12345/mcp',
  bearerToken: 'x'.repeat(32),
};
describe('HTTP gateway boundary parsers', () => {
  it.each([
    'http://127.0.0.1:12345/mcp\n',
    'http://localhost:12345/mcp',
    'http://127.1:12345/mcp',
    'http://2130706433:12345/mcp',
    'http://[::1]:12345/mcp',
    'http://0.0.0.0:12345/mcp',
    'http://10.0.0.1:12345/mcp',
    'https://127.0.0.1:12345/mcp',
    'http://user:pass@127.0.0.1:12345/mcp',
    'http://127.0.0.1:12345/mcp?secret=1',
    'http://127.0.0.1:12345/mcp#fragment',
    'http://127.0.0.1:12345/../mcp',
    'http://127.0.0.1:12345/%6dcp',
    'http://127.0.0.1:12345/mcp/',
    'http://127.0.0.1:80/mcp',
    'http://127.0.0.1:65536/mcp',
    'http://127.0.0.1:01234/mcp',
  ])('rejects unsupported target before any networking: %s', (url) => {
    expect(() => parseHttpEndpoint({ ...descriptor, url })).toThrow();
  });
  it('accepts only an exact descriptor with a bounded private bearer', () => {
    expect(parseHttpEndpoint(descriptor)).toEqual({
      port: 12345,
      path: '/mcp',
      origin: 'http://127.0.0.1:12345',
      token: 'x'.repeat(32),
    });
    for (const change of [
      { bearerToken: '' },
      { bearerToken: 'x'.repeat(32) + '\n' },
      { bearerToken: 'x'.repeat(257) },
      { bearerToken: 'x'.repeat(32) + '\r\nHeader: value' },
      { extra: true },
      { schemaVersion: 2 },
    ])
      expect(() => parseHttpEndpoint({ ...descriptor, ...change })).toThrow();
  });
  const reply = (text, contentType = 'text/event-stream') =>
    parseHttpReply(
      {
        status: 200,
        headers: { 'content-type': contentType },
        rawHeaders: ['Content-Type', contentType],
        body: Buffer.from(text),
      },
      4,
    );
  const data = '{"jsonrpc":"2.0","id":4,"result":{"ok":true}}';
  it('parses CRLF, comments, primers and a multiline finite SSE result', () => {
    expect(
      reply(
        ': comment\r\nid: primer\r\ndata: \r\n\r\nevent: message\r\nretry: 1000\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":4,"result":{"ok":true}}\r\n\r\n',
      ),
    ).toEqual({ ok: true });
    expect(reply(data, 'application/json')).toEqual({ ok: true });
  });
  it.each([
    `data: ${data}`,
    `data: ${data}\n`,
    `data: ${data}\n\ndata: ${data}\n\n`,
    `event: other\ndata: ${data}\n\n`,
    `unknown: x\ndata: ${data}\n\n`,
    'data: {"jsonrpc":"2.0","id":4,"method":"sampling/createMessage"}\n\n',
    'data: {"jsonrpc":"2.0","id":"4","result":{}}\n\n',
    'data: {"jsonrpc":"2.0","id":4,"error":{"message":"PRIVATE"}}\n\n',
    ': comment\n'.repeat(129) + `data: ${data}\n\n`,
  ])('rejects incomplete, duplicate, unsolicited or uncorrelated SSE', (text) =>
    expect(() => reply(text)).toThrow(),
  );
});
