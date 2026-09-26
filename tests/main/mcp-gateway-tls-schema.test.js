import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { rootCertificates } from 'node:tls';
const require = createRequire(import.meta.url);
const { parseHttpsEndpoint } = require('../../src/main/mcp-gateway-tls');
const descriptor = {
  schemaVersion: 2,
  url: 'https://tools.example/mcp',
  bearerToken: 'x'.repeat(32),
  connectAddress: '127.0.0.1',
  caCertificate: rootCertificates[0],
  certificateSha256: 'a'.repeat(64),
};
describe('pinned HTTPS descriptor boundary', () => {
  it('separates selected literal network address from authenticated DNS authority', () => {
    expect(parseHttpsEndpoint(descriptor)).toEqual({
      protocol: 'https:',
      hostname: 'tools.example',
      hostHeader: 'tools.example',
      port: 443,
      path: '/mcp',
      origin: 'https://tools.example',
      token: descriptor.bearerToken,
      address: '127.0.0.1',
      caCertificate: descriptor.caCertificate,
      certificateSha256: descriptor.certificateSha256,
    });
    expect(
      parseHttpsEndpoint({ ...descriptor, url: 'https://tools.example:8443/api/mcp' }),
    ).toMatchObject({
      hostHeader: 'tools.example:8443',
      port: 8443,
      path: '/api/mcp',
      origin: 'https://tools.example:8443',
    });
    expect(parseHttpsEndpoint({ ...descriptor, connectAddress: '192.168.1.2' }).address).toBe(
      '192.168.1.2',
    );
  });
  it.each([
    'http://tools.example/mcp',
    'https://localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://127.1/mcp',
    'https://tools.EXAMPLE/mcp',
    'https://tools.example./mcp',
    'https://xn--bcher-kva.example/mcp',
    'https://bücher.example/mcp',
    'https://-tools.example/mcp',
    'https://tools_.example/mcp',
    'https://user:pass@tools.example/mcp',
    'https://tools.example/mcp?token=x',
    'https://tools.example/mcp#x',
    'https://tools.example/../mcp',
    'https://tools.example/%6dcp',
    'https://tools.example/mcp/',
    'https://tools.example:0/mcp',
    'https://tools.example:65536/mcp',
    'https://tools.example:0443/mcp',
    'https://tools.example/mcp\n',
    'https://' + 'a'.repeat(64) + '.example/mcp',
    'https://tools.example/' + 'a'.repeat(256),
  ])('rejects URL aliases and unaccepted authorities: %s', (url) => {
    expect(() => parseHttpsEndpoint({ ...descriptor, url })).toThrow('https-endpoint-invalid');
  });
  it.each(['localhost', '127.1', '127.000.0.1', '2130706433', '::1', '127.0.0.1\n'])(
    'rejects noncanonical literal address %s',
    (connectAddress) => {
      expect(() => parseHttpsEndpoint({ ...descriptor, connectAddress })).toThrow(
        'https-endpoint-invalid',
      );
    },
  );
  it('rejects malformed trust, private keys, extra credentials and header injection', () => {
    for (const change of [
      { schemaVersion: 1 },
      { extra: true },
      { bearerToken: 'x'.repeat(32) + '\n' },
      { bearerToken: 'x'.repeat(32) + '\r' },
      { bearerToken: 'x'.repeat(32) + '\u2028' },
      { bearerToken: 'x'.repeat(32) + '\u2029' },
      { bearerToken: 'x'.repeat(257) },
      { bearerToken: 'x'.repeat(32) + '\r\nHeader: leak' },
      { certificateSha256: 'A'.repeat(64) },
      { certificateSha256: 'a'.repeat(64) + '\n' },
      { caCertificate: descriptor.caCertificate + descriptor.caCertificate },
      { caCertificate: '-----BEGIN PRIVATE KEY-----\nYQ==\n-----END PRIVATE KEY-----' },
      { caCertificate: '-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----' },
      { caCertificate: 'x'.repeat(8193) },
    ])
      expect(() => parseHttpsEndpoint({ ...descriptor, ...change })).toThrow(
        'https-endpoint-invalid',
      );
    const { connectAddress, ...missing } = descriptor;
    expect(() => parseHttpsEndpoint(missing)).toThrow('https-endpoint-invalid');
  });
});
