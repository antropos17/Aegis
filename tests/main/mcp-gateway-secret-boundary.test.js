import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { X509Certificate, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpFixture } from './fixtures/mcp-http-server';
const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const secret = 'Synthetic_Secret_42!';
const variants = [
  secret,
  Buffer.from(secret).toString('base64'),
  Buffer.from(secret).toString('base64url'),
  Buffer.from(secret).toString('hex'),
  [...Buffer.from(secret)].map((byte) => '%' + byte.toString(16)).join(''),
];
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const rpc = (id, method, params) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method,
  ...(params === undefined ? {} : { params }),
});
const init = () =>
  rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} });
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
let root, fixture, gateway, options, manifest, tool, failed;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-secret-'));
  tool = {
    name: 'record',
    inputSchema: schema({ recipient: { type: 'string', maxLength: 256 } }),
    outputSchema: schema({ accepted: { type: 'boolean' } }),
  };
  fixture = await httpFixture(tool);
  failed = vi.fn();
  options = {
    endpointPath: path.join(root, 'endpoint.json'),
    manifestPath: path.join(root, 'manifest.json'),
    secretPolicyPath: path.join(root, 'secrets.json'),
    onFailure: failed,
  };
  save(options.endpointPath, {
    schemaVersion: 1,
    url: fixture.url,
    bearerToken: fixture.state.token,
  });
  save(options.secretPolicyPath, { schemaVersion: 1, values: [secret] });
  manifest = {
    schemaVersion: 1,
    tools: [tool],
    grants: [{ tool: 'record', arguments: { recipient: 'chosen' } }],
  };
});
afterEach(async () => {
  gateway?.close();
  if (gateway) await gateway.finish();
  gateway = undefined;
  await fixture.close();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
async function ready() {
  save(options.manifestPath, manifest);
  gateway = createMcpGateway(options);
  expect((await gateway.receive(init())).result).toBeDefined();
  await gateway.receive(rpc(undefined, 'notifications/initialized'));
}
const call = () =>
  rpc(2, 'tools/call', { name: 'record', arguments: manifest.grants[0].arguments });
function expectPrivate(reply) {
  expect(reply?.result).toBeUndefined();
  for (const value of variants) expect(JSON.stringify(reply)).not.toContain(value);
  expect(failed).toHaveBeenCalled();
}
it('allows a clean exact grant with an explicit secret policy', async () => {
  await ready();
  expect((await gateway.receive(call())).result.structuredContent).toEqual({ accepted: true });
  expect(fixture.state.calls).toHaveLength(1);
  expect(failed).not.toHaveBeenCalled();
});
it.each(variants)(
  'blocks an approved argument containing %s before an upstream effect',
  async (value) => {
    manifest.grants[0].arguments.recipient = 'prefix-' + value + '-suffix';
    await ready();
    expectPrivate(await gateway.receive(call()));
    expect(fixture.state.calls).toHaveLength(0);
  },
);
it('rejects catalog descriptions before opening any upstream connection', async () => {
  tool.description = 'hint: ' + secret;
  save(options.manifestPath, manifest);
  gateway = createMcpGateway(options);
  expectPrivate(await gateway.receive(init()));
  expect(fixture.state.connections).toBe(0);
});
it('rejects a secret embedded in a decoded catalog property key before connecting', async () => {
  tool.inputSchema = schema({ [secret]: { type: 'string', maxLength: 32 } });
  manifest.grants[0].arguments = { [secret]: 'chosen' };
  save(options.manifestPath, manifest);
  gateway = createMcpGateway(options);
  expectPrivate(await gateway.receive(init()));
  expect(fixture.state.connections).toBe(0);
});
it('fails closed on a missing explicitly requested policy before connecting', async () => {
  fs.unlinkSync(options.secretPolicyPath);
  save(options.manifestPath, manifest);
  gateway = createMcpGateway(options);
  expectPrivate(await gateway.receive(init()));
  expect(fixture.state.connections).toBe(0);
});
it('suppresses schema-valid secret output even when the upstream effect already happened', async () => {
  tool.outputSchema = schema({ message: { type: 'string', maxLength: 128 } });
  fixture.state.structuredContent = { message: secret };
  await ready();
  expectPrivate(await gateway.receive(call()));
  expect(fixture.state.calls).toHaveLength(1);
});
it.each(['tools/call', 'tools/list'])('rechecks changed policy before %s', async (method) => {
  await ready();
  fs.appendFileSync(options.secretPolicyPath, ' ');
  expectPrivate(await gateway.receive(method === 'tools/call' ? call() : rpc(2, method)));
  expect(fixture.state.calls).toHaveLength(0);
  expect(fixture.state.lists).toBe(1);
});
it('rechecks policy after catalog refresh before dispatch', async () => {
  await ready();
  fixture.state.onList = (count) => {
    if (count === 2) fs.appendFileSync(options.secretPolicyPath, ' ');
  };
  expectPrivate(await gateway.receive(call()));
  expect(fixture.state.calls).toHaveLength(0);
});
it('suppresses a response when policy changes during the upstream call', async () => {
  await ready();
  fixture.state.onCall = () => fs.appendFileSync(options.secretPolicyPath, ' ');
  expectPrivate(await gateway.receive(call()));
  expect(fixture.state.calls).toHaveLength(1);
});
it('keeps a durable grant spent after a blocked attempt and a fresh gateway', async () => {
  manifest.schemaVersion = 2;
  manifest.grants[0].arguments.recipient = secret;
  Object.assign(manifest.grants[0], {
    id: 'g'.repeat(32),
    taskId: 't'.repeat(32),
    notBefore: Date.now() - 1000,
    expiresAt: Date.now() + 60000,
  });
  options.grantStorePath = path.join(root, 'grants');
  fs.mkdirSync(options.grantStorePath);
  await ready();
  expectPrivate(await gateway.receive(call()));
  await gateway.finish();
  expect(fs.readdirSync(options.grantStorePath)).toHaveLength(1);
  // A deliberately changed policy in a fresh session cannot restore the consumed grant.
  save(options.secretPolicyPath, { schemaVersion: 1, values: ['DifferentSyntheticValue'] });
  await ready();
  expect((await gateway.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
});
it.each([false, true])(
  'enforces the response boundary through pinned TLS (secret: %s)',
  async (blocked) => {
    await fixture.close();
    const read = (name) =>
      fs.readFileSync(new URL('./fixtures/mcp-tls/' + name, import.meta.url), 'utf8');
    const cert = read('server.pem');
    fixture = await httpFixture(tool, { cert, key: read('server.key') });
    save(options.endpointPath, {
      schemaVersion: 2,
      url: fixture.url,
      connectAddress: '127.0.0.1',
      bearerToken: fixture.state.token,
      caCertificate: read('ca.pem'),
      certificateSha256: createHash('sha256').update(new X509Certificate(cert).raw).digest('hex'),
    });
    tool.outputSchema = schema({ message: { type: 'string', maxLength: 128 } });
    fixture.state.structuredContent = { message: blocked ? secret : 'clean' };
    await ready();
    const reply = await gateway.receive(call());
    if (blocked) expectPrivate(reply);
    else expect(reply.result.structuredContent).toEqual({ message: 'clean' });
    expect(fixture.state.calls).toHaveLength(1);
  },
);
