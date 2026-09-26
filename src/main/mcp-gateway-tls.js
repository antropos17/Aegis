'use strict';
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const { createHash, X509Certificate } = require('node:crypto');

/** Validate an explicitly selected, certificate-pinned HTTPS route without DNS discovery.
 * @param {object} value Operator-owned descriptor. @returns {object} Private connection parameters.
 * @since v0.15.1 */
function parseHttpsEndpoint(value) {
  const keys = [
    'schemaVersion',
    'url',
    'bearerToken',
    'connectAddress',
    'caCertificate',
    'certificateSha256',
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schemaVersion !== 2 ||
    typeof value.url !== 'string' ||
    value.url.length > 512 ||
    typeof value.bearerToken !== 'string' ||
    value.bearerToken.length < 32 ||
    value.bearerToken.length > 256 ||
    /[^A-Za-z0-9_-]/.test(value.bearerToken) ||
    typeof value.connectAddress !== 'string' ||
    !net.isIPv4(value.connectAddress) ||
    typeof value.certificateSha256 !== 'string' ||
    value.certificateSha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value.certificateSha256) ||
    typeof value.caCertificate !== 'string' ||
    Buffer.byteLength(value.caCertificate) > 8192 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----(?:\r?\n)?$/.test(
      value.caCertificate,
    )
  )
    throw Error('https-endpoint-invalid');
  const match =
    /^https:\/\/([a-z0-9.-]+)(?::([1-9]\d{0,4}))?(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/.exec(
      value.url,
    );
  if (
    !match ||
    match[0] !== value.url ||
    match[1].length > 253 ||
    match[3].length > 256 ||
    Number(match[2] || 443) > 65535
  )
    throw Error('https-endpoint-invalid');
  const hostname = match[1];
  const labels = hostname.split('.');
  if (
    labels.length < 2 ||
    net.isIP(hostname) ||
    labels.some(
      (label) => label.startsWith('xn--') || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw Error('https-endpoint-invalid');
  try {
    // URL rejects aliases such as 127.1 which otherwise resemble legal DNS labels.
    if (new URL(value.url).hostname !== hostname) throw Error();
    new X509Certificate(value.caCertificate);
  } catch {
    throw Error('https-endpoint-invalid');
  }
  const hostHeader = hostname + (match[2] ? ':' + match[2] : '');
  return {
    protocol: 'https:',
    hostname,
    hostHeader,
    port: Number(match[2] || 443),
    path: match[3],
    origin: 'https://' + hostHeader,
    token: value.bearerToken,
    address: value.connectAddress,
    caCertificate: value.caCertificate,
    certificateSha256: value.certificateSha256,
  };
}

/** Create an isolated agent whose TLS peer must satisfy CA, DNS-name and exact leaf checks.
 * @param {object} endpoint Validated private route parameters.
 * @returns {import('node:https').Agent} Dedicated agent; the caller destroys it after the exchange.
 * @since v0.15.1 */
function createTlsAgent(endpoint) {
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0, proxyEnv: {} });
  // Ignore request-derived connection options, global agents, DNS and ambient trust overrides.
  agent.createConnection = () =>
    tls.connect({
      host: endpoint.address,
      port: endpoint.port,
      servername: endpoint.hostname,
      ca: endpoint.caCertificate,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ALPNProtocols: ['http/1.1'],
      enableTrace: false,
      checkServerIdentity: (_hostname, certificate) => {
        const nameError = tls.checkServerIdentity(endpoint.hostname, certificate);
        if (nameError) return Error('https-peer-invalid');
        if (
          !Buffer.isBuffer(certificate.raw) ||
          createHash('sha256').update(certificate.raw).digest('hex') !== endpoint.certificateSha256
        )
          return Error('https-peer-invalid');
        return undefined;
      },
    });
  return agent;
}
module.exports = { parseHttpsEndpoint, createTlsAgent };
