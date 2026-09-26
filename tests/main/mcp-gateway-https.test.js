import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { X509Certificate, createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { httpFixture } from './fixtures/mcp-http-server';
const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const read = (name) =>
  fs.readFileSync(new URL('./fixtures/mcp-tls/' + name, import.meta.url), 'utf8');
const cert = read('server.pem');
const key = read('server.key');
const hash = (pem) => createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const tool = {
  name: 'record',
  inputSchema: schema({ recipient: { type: 'string', maxLength: 32 } }),
  outputSchema: schema({ accepted: { type: 'boolean' } }),
};
const rpc = (id, method, params) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method,
  ...(params === undefined ? {} : { params }),
});
const init = () =>
  rpc(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' },
  });
const call = (id = 2) =>
  rpc(id, 'tools/call', { name: 'record', arguments: { recipient: 'chosen' } });
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
let fixture,
  extra,
  directory,
  endpointPath,
  manifestPath,
  descriptor,
  gateway,
  failed,
  child,
  stall,
  sockets;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-https-'));
  endpointPath = path.join(directory, 'endpoint.json');
  manifestPath = path.join(directory, 'manifest.json');
  fixture = await httpFixture(tool, { cert, key });
  descriptor = {
    schemaVersion: 2,
    url: fixture.url,
    connectAddress: '127.0.0.1',
    bearerToken: fixture.state.token,
    caCertificate: read('ca.pem'),
    certificateSha256: hash(cert),
  };
  save(endpointPath, descriptor);
  save(manifestPath, {
    schemaVersion: 1,
    tools: [tool],
    grants: [{ tool: 'record', arguments: { recipient: 'chosen' } }],
  });
  failed = vi.fn();
  sockets = new Set();
});
afterEach(async () => {
  gateway?.close();
  if (gateway) await gateway.finish();
  gateway = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'close');
    child.kill('SIGKILL');
    await done;
  }
  child = undefined;
  for (const socket of sockets) socket.destroy();
  if (stall) {
    const done = once(stall, 'close');
    stall.close();
    await done;
  }
  stall = undefined;
  await fixture.close();
  if (extra) await extra.close();
  extra = undefined;
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true });
});
function create(options = {}) {
  gateway = createMcpGateway({ endpointPath, manifestPath, onFailure: failed, ...options });
}
async function ready(options) {
  create(options);
  expect((await gateway.receive(init())).result?.capabilities.tools).toEqual({
    listChanged: false,
  });
  await gateway.receive(rpc(undefined, 'notifications/initialized'));
}
function replaceCertificate(name, keyName = 'server.key') {
  fixture.server.setSecureContext({ cert: read(name), key: read(keyName) });
}
describe('explicit pinned HTTPS gateway', () => {
  it.each(['json', 'sse'])(
    'authenticates the selected literal socket and named server for %s',
    async (mode) => {
      fixture.state.mode = mode;
      await ready();
      expect((await gateway.receive(call())).result.structuredContent).toEqual({ accepted: true });
      expect((await gateway.receive(call(3))).error).toBeDefined();
      gateway.close();
      expect(await gateway.finish()).toBe(true);
      expect(fixture.state.calls).toHaveLength(1);
      expect(fixture.state.deletes).toBe(1);
      for (const request of fixture.state.messages) {
        expect(request.headers.authorization).toBe('Bearer ' + fixture.state.token);
        expect(request.headers.host).toBe(new URL(fixture.url).host);
        expect(request.headers.origin).toBe(new URL(fixture.url).origin);
      }
      expect(failed).not.toHaveBeenCalled();
    },
  );
  it.each(['wrong-name.pem', 'expired.pem', 'untrusted.pem', 'pin'])(
    'withholds credentials before HTTP for %s',
    async (name) => {
      if (name === 'pin') descriptor.certificateSha256 = '0'.repeat(64);
      else {
        replaceCertificate(name, name === 'untrusted.pem' ? 'untrusted.key' : 'server.key');
        descriptor.certificateSha256 = hash(read(name));
      }
      save(endpointPath, descriptor);
      create();
      expect((await gateway.receive(init())).error).toBeDefined();
      expect(fixture.state.messages).toHaveLength(0);
      expect(failed).toHaveBeenCalledOnce();
    },
  );
  it('revalidates the leaf on each exchange after a fresh catalog', async () => {
    await ready();
    fixture.state.onList = (count) => {
      if (count === 2) replaceCertificate('rotated.pem');
    };
    expect((await gateway.receive(call())).error).toBeDefined();
    expect(fixture.state.lists).toBe(2);
    expect(fixture.state.calls).toHaveLength(0);
    expect(await gateway.finish()).toBe(false);
  });
  it.each(['connectAddress', 'caCertificate', 'certificateSha256'])(
    'revokes observed descriptor edits to %s',
    async (field) => {
      await ready();
      descriptor[field] =
        field === 'connectAddress'
          ? '127.0.0.2'
          : field === 'caCertificate'
            ? read('untrusted.pem')
            : '0'.repeat(64);
      save(endpointPath, descriptor);
      expect((await gateway.receive(call())).error).toBeDefined();
      expect(fixture.state.calls).toHaveLength(0);
      expect(await gateway.finish()).toBe(true);
      expect(fixture.state.deletes).toBe(1);
    },
  );
  it('does not follow a redirect to another fixture or forward its bearer', async () => {
    extra = await httpFixture(tool);
    fixture.state.mode = 'redirect';
    fixture.state.redirect = extra.url;
    create();
    expect((await gateway.receive(init())).error).toBeDefined();
    expect(extra.state.messages).toHaveLength(0);
  });
  it('bounds a TCP peer that never completes the TLS handshake', async () => {
    stall = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    stall.listen(0, '127.0.0.1');
    await once(stall, 'listening');
    descriptor.url = 'https://mcp.fixture.test:' + stall.address().port + '/mcp';
    save(endpointPath, descriptor);
    create();
    expect((await gateway.receive(init())).error).toBeDefined();
    expect(failed).toHaveBeenCalledOnce();
    expect(fixture.state.messages).toHaveLength(0);
  }, 7000);
  it('keeps a cancelled TLS attempt spent after a new gateway starts', async () => {
    const grantStorePath = path.join(directory, 'grants');
    fs.mkdirSync(grantStorePath);
    save(manifestPath, {
      schemaVersion: 2,
      tools: [tool],
      grants: [
        {
          id: 'g'.repeat(32),
          taskId: 't'.repeat(32),
          notBefore: Date.now() - 1000,
          expiresAt: Date.now() + 60000,
          tool: 'record',
          arguments: { recipient: 'chosen' },
        },
      ],
    });
    fixture.state.mode = 'hang-call';
    await ready({ grantStorePath });
    const running = gateway.receive(call(22));
    await vi.waitFor(() => expect(fixture.state.calls).toHaveLength(1));
    await gateway.receive(rpc(undefined, 'notifications/cancelled', { requestId: 22 }));
    expect((await running).error).toBeDefined();
    expect(await gateway.finish()).toBe(true);
    const cancellation = fixture.state.messages.find(
      (r) => r.message?.method === 'notifications/cancelled',
    );
    expect(cancellation.message.params.requestId).toBe(fixture.state.calls[0].id);
    expect(fixture.state.deletes).toBe(1);
    fixture.state.mode = 'json';
    await ready({ grantStorePath });
    expect((await gateway.receive(call())).error).toBeDefined();
    expect(fixture.state.calls).toHaveLength(1);
  });
  it.each(['url', 'connectAddress', 'certificateSha256'])(
    'binds a v3 HTTPS grant to its selected %s without spending it on a different route',
    async (field) => {
      const grantStorePath = path.join(directory, 'grants');
      fs.mkdirSync(grantStorePath);
      const route = {
        transport: 'https',
        url: descriptor.url,
        connectAddress: descriptor.connectAddress,
        certificateSha256: descriptor.certificateSha256,
      };
      if (field === 'url') extra = await httpFixture(tool, { cert, key });
      const other =
        field === 'url' ? extra.url : field === 'connectAddress' ? '127.0.0.2' : '0'.repeat(64);
      const manifest = {
        schemaVersion: 3,
        route: { ...route, [field]: other },
        tools: [tool],
        grants: [
          {
            id: 'g'.repeat(32),
            taskId: 't'.repeat(32),
            notBefore: Date.now() - 1000,
            expiresAt: Date.now() + 60000,
            tool: 'record',
            arguments: { recipient: 'chosen' },
          },
        ],
      };
      save(manifestPath, manifest);
      create({ grantStorePath });
      expect((await gateway.receive(init())).error).toBeDefined();
      expect(fixture.state.calls).toHaveLength(0);
      expect(extra?.state.calls ?? []).toHaveLength(0);
      expect(fs.readdirSync(grantStorePath)).toEqual([]);
      gateway.close();
      await gateway.finish();

      manifest.route = route;
      save(manifestPath, manifest);
      await ready({ grantStorePath });
      expect((await gateway.receive(call())).result?.structuredContent).toEqual({ accepted: true });
      expect(fixture.state.calls).toHaveLength(1);
      gateway.close();
      await gateway.finish();
      await ready({ grantStorePath });
      expect((await gateway.receive(call())).error).toBeDefined();
      expect(fixture.state.calls).toHaveLength(1);
    },
  );
  it.each(['untrusted.pem', 'wrong-name.pem', 'pin'])(
    'native CLI ignores insecure TLS environment for %s without credential disclosure',
    async (name) => {
      if (name === 'pin') descriptor.certificateSha256 = '0'.repeat(64);
      else {
        replaceCertificate(name, name === 'untrusted.pem' ? 'untrusted.key' : 'server.key');
        descriptor.certificateSha256 = hash(read(name));
      }
      save(endpointPath, descriptor);
      const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
      child = spawn(process.execPath, [main, '--mcp-gateway-http', endpointPath, manifestPath], {
        windowsHide: true,
        stdio: 'pipe',
        env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      });
      const done = once(child, 'close');
      let output = '';
      child.stdout.on('data', (v) => {
        output += v;
      });
      child.stderr.on('data', (v) => {
        output += v;
      });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(init()) + '\n');
      expect((await done)[0]).toBe(2);
      expect(fixture.state.messages).toHaveLength(0);
      expect(output).not.toContain(fixture.state.token);
      expect(output).not.toContain('BEGIN CERTIFICATE');
      expect(output).not.toContain('mcp.fixture.test');
    },
    7000,
  );
});
