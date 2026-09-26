import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { httpFixture } from './fixtures/mcp-http-server';
const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
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
const call = (id = 2, recipient = 'chosen') =>
  rpc(id, 'tools/call', { name: 'record', arguments: { recipient } });
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value));
let fixture, root, endpointPath, manifestPath, descriptor, gateway, failed, child, extraFixture;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-http-'));
  endpointPath = path.join(root, 'endpoint.json');
  manifestPath = path.join(root, 'manifest.json');
  fixture = await httpFixture(tool);
  descriptor = { schemaVersion: 1, url: fixture.url, bearerToken: fixture.state.token };
  save(endpointPath, descriptor);
  save(manifestPath, {
    schemaVersion: 1,
    tools: [tool],
    grants: [{ tool: 'record', arguments: { recipient: 'chosen' } }],
  });
  failed = vi.fn();
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
  await fixture.close();
  if (extraFixture) await extraFixture.close();
  extraFixture = undefined;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
function create(mode = 'json') {
  fixture.state.mode = mode;
  gateway = createMcpGateway({ endpointPath, manifestPath, onFailure: failed });
}
async function ready(mode) {
  create(mode);
  expect((await gateway.receive(init())).result?.capabilities.tools).toEqual({
    listChanged: false,
  });
  await gateway.receive(rpc(undefined, 'notifications/initialized'));
}
describe('explicit loopback HTTP upstream', () => {
  it.each(['json', 'sse'])(
    'forwards one exact grant through %s with pinned headers and session',
    async (mode) => {
      await ready(mode);
      expect((await gateway.receive(call(2, 'other'))).error).toBeDefined();
      expect(fixture.state.calls).toHaveLength(0);
      expect((await gateway.receive(call(3))).result.structuredContent).toEqual({ accepted: true });
      expect((await gateway.receive(call(4))).error.message).toBe('gateway-grant-unavailable');
      expect(fixture.state.calls).toHaveLength(1);
      gateway.close();
      expect(await gateway.finish()).toBe(true);
      expect(fixture.state.deletes).toBe(1);
      for (const received of fixture.state.messages) {
        expect(received.url).toBe('/mcp');
        expect(received.headers.authorization).toBe(`Bearer ${fixture.state.token}`);
        expect(received.headers.origin).toBe(new URL(fixture.url).origin);
        if (received.message?.method !== 'initialize') {
          expect(received.headers['mcp-session-id']).toBe(fixture.state.session);
          expect(received.headers['mcp-protocol-version']).toBe('2025-11-25');
        }
      }
      expect(failed).not.toHaveBeenCalled();
    },
  );
  it('does not follow redirects or disclose the bearer to another selected local fixture', async () => {
    extraFixture = await httpFixture(tool);
    fixture.state.redirect = extraFixture.url;
    create('redirect');
    expect((await gateway.receive(init())).error).toBeDefined();
    expect(extraFixture.state.messages).toHaveLength(0);
    expect(fixture.state.calls).toHaveLength(0);
  });
  it.each([
    'no-session',
    'duplicate-session',
    'wrong-id',
    'bad-notification',
    'sse-extra',
    'oversize',
    'bad-utf8',
    'compressed',
    'informational',
    'upgrade',
  ])('closes on unsupported upstream %s', async (mode) => {
    create(mode);
    const response = await gateway.receive(init());
    expect(response.error).toBeDefined();
    expect(JSON.stringify(response)).not.toContain('PRIVATE');
    expect(fixture.state.calls).toHaveLength(0);
    expect(failed).toHaveBeenCalledOnce();
  });
  it.each(['catalog-change', 'rotate-session', 'expired', 'reset'])(
    'never forwards after %s and never reinitializes',
    async (mode) => {
      await ready(mode);
      expect((await gateway.receive(call())).error).toBeDefined();
      expect(await gateway.receive(call(3))).toBeNull();
      expect(fixture.state.calls).toHaveLength(0);
      expect(fixture.state.messages.filter((r) => r.message?.method === 'initialize')).toHaveLength(
        1,
      );
    },
  );
  it.each(['endpoint', 'manifest'])('revokes on pinned %s byte changes', async (kind) => {
    await ready();
    fs.appendFileSync(kind === 'endpoint' ? endpointPath : manifestPath, ' ');
    expect((await gateway.receive(call())).error).toBeDefined();
    expect(fixture.state.calls).toHaveLength(0);
    expect(await gateway.receive(call(3))).toBeNull();
  });
  it('never follows an edited descriptor and cleans up only at the original endpoint', async () => {
    await ready();
    extraFixture = await httpFixture(tool);
    save(endpointPath, { ...descriptor, url: extraFixture.url, bearerToken: 'changed'.repeat(8) });
    expect((await gateway.receive(call())).error).toBeDefined();
    expect(await gateway.finish()).toBe(true);
    expect(fixture.state.calls).toHaveLength(0);
    expect(fixture.state.deletes).toBe(1);
    expect(extraFixture.state.messages).toHaveLength(0);
  });
  it('rechecks the endpoint after receiving a fresh catalog', async () => {
    await ready();
    fixture.state.onList = (count) => {
      if (count === 2) fs.appendFileSync(endpointPath, ' ');
    };
    expect((await gateway.receive(call())).error).toBeDefined();
    expect(fixture.state.calls).toHaveLength(0);
  });
  it('withholds unvalidated response text without claiming rollback', async () => {
    await ready('bad-result');
    const response = await gateway.receive(call());
    expect(response.error).toBeDefined();
    expect(JSON.stringify(response)).not.toContain('PRIVATE');
    expect(fixture.state.calls).toHaveLength(1);
  });
  it('uses the upstream ID for cancellation, closes the session and never retries the operation', async () => {
    await ready('hang-call');
    const running = gateway.receive(call(22));
    await vi.waitFor(() => expect(fixture.state.calls).toHaveLength(1));
    await gateway.receive(rpc(undefined, 'notifications/cancelled', { requestId: '22' }));
    expect(failed).not.toHaveBeenCalled();
    await gateway.receive(rpc(undefined, 'notifications/cancelled', { requestId: 22 }));
    expect((await running).error).toBeDefined();
    expect(await gateway.finish()).toBe(true);
    const cancellation = fixture.state.messages.find(
      (r) => r.message?.method === 'notifications/cancelled',
    );
    expect(cancellation.message.params.requestId).toBe(fixture.state.calls[0].id);
    expect(fixture.state.deletes).toBe(1);
    expect(await gateway.receive(call(23))).toBeNull();
    expect(fixture.state.calls).toHaveLength(1);
  });
  it.each(['cleanup-refuse', 'cleanup-hang'])(
    'does not claim successful session cleanup for %s',
    async (mode) => {
      await ready(mode);
      gateway.close();
      expect(await gateway.finish()).toBe(false);
    },
  );
  it.each(['hang-init', 'sse-open'])(
    'bounds %s without attempting a second session',
    async (mode) => {
      create(mode);
      expect((await gateway.receive(init())).error).toBeDefined();
      expect(failed).toHaveBeenCalledOnce();
      expect(fixture.state.messages.filter((r) => r.message?.method === 'initialize')).toHaveLength(
        1,
      );
    },
    7000,
  );
  it('rejects a hostname alias before sending any HTTP request', async () => {
    descriptor.url = fixture.url.replace('127.0.0.1', 'localhost');
    save(endpointPath, descriptor);
    create();
    expect((await gateway.receive(init())).error).toBeDefined();
    expect(fixture.state.messages).toHaveLength(0);
  });
  it.each(['json', 'cleanup-refuse'])(
    'serves the real Node CLI with %s cleanup status and no private diagnostics',
    async (mode) => {
      fixture.state.mode = mode;
      extraFixture = await httpFixture(tool);
      const proxy = new URL(extraFixture.url).origin;
      const env = {
        ...process.env,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        NO_PROXY: '',
        no_proxy: '',
      };
      // Positive control: the runtime really uses this proxy with its default agent.
      const control = `const http = require('node:http'); const body = process.argv[3];
        const r = http.request(process.argv[1], { method: 'POST', headers: {
          Authorization: 'Bearer ' + process.argv[2], 'Content-Length': Buffer.byteLength(body)
        } }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
        r.on('error', () => process.exit(2)); r.setTimeout(2000, () => process.exit(2)); r.end(body);`;
      child = spawn(
        process.execPath,
        ['-e', control, fixture.url, fixture.state.token, JSON.stringify(init())],
        { windowsHide: true, stdio: 'ignore', env },
      );
      expect((await once(child, 'close'))[0]).toBe(0);
      expect(extraFixture.state.messages).toHaveLength(1);
      expect(fixture.state.messages).toHaveLength(0);
      extraFixture.state.messages.length = 0;
      const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
      child = spawn(process.execPath, [main, '--mcp-gateway-http', endpointPath, manifestPath], {
        windowsHide: true,
        stdio: 'pipe',
        env,
      });
      const done = once(child, 'close');
      let output = '',
        errors = '';
      child.stdout.on('data', (v) => {
        output += v;
      });
      child.stderr.on('data', (v) => {
        errors += v;
      });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(init()) + '\n');
      await vi.waitFor(() => expect(output).toContain('aegis-gateway'), { timeout: 5000 });
      child.stdin.write(JSON.stringify(rpc(undefined, 'notifications/initialized')) + '\n');
      child.stdin.write(JSON.stringify(call()) + '\n');
      await vi.waitFor(() => expect(output).toContain('structuredContent'), { timeout: 5000 });
      child.stdin.end();
      expect((await done)[0]).toBe(mode === 'json' ? 0 : 2);
      expect(output + errors).not.toContain('PRIVATE');
      expect(errors).toBe('');
      expect(fixture.state.deletes).toBe(1);
      expect(fixture.state.calls).toHaveLength(1);
      expect(extraFixture.state.messages).toHaveLength(0);
    },
    12000,
  );
});
