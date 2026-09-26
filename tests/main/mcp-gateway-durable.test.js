import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
    clientInfo: { name: 'test', version: '1' },
  });
const call = () => rpc(2, 'tools/call', { name: 'record', arguments: { recipient: 'chosen' } });
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
let root, endpointPath, manifestPath, grantStorePath, fixture, alternate, manifest;
let gateways = [],
  children = [];
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-durable-gateway-'));
  endpointPath = path.join(root, 'endpoint.json');
  manifestPath = path.join(root, 'manifest.json');
  grantStorePath = path.join(root, 'grants');
  fs.mkdirSync(grantStorePath);
  fixture = await httpFixture(tool);
  save(endpointPath, { schemaVersion: 1, url: fixture.url, bearerToken: fixture.state.token });
  manifest = {
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
  };
  save(manifestPath, manifest);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const g of gateways) {
    g.close();
    await g.finish();
  }
  gateways = [];
  for (const c of children)
    if (c.exitCode === null && c.signalCode === null) {
      const done = once(c, 'close');
      c.kill('SIGKILL');
      await done;
    }
  children = [];
  await fixture.close();
  if (alternate) await alternate.close();
  alternate = undefined;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
async function ready(extra = {}) {
  const g = createMcpGateway({
    endpointPath,
    manifestPath,
    grantStorePath,
    onFailure() {},
    ...extra,
  });
  gateways.push(g);
  expect((await g.receive(init())).result).toBeDefined();
  await g.receive(rpc(undefined, 'notifications/initialized'));
  return g;
}
async function credentialTag() {
  const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
  const child = spawn(
    process.execPath,
    [main, '--mcp-gateway-credential-tag', endpointPath, grantStorePath],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  const done = once(child, 'close');
  let output = '',
    errors = '';
  child.stdout.on('data', (value) => {
    output += value;
  });
  child.stderr.on('data', (value) => {
    errors += value;
  });
  expect((await done)[0]).toBe(0);
  expect(errors).toBe('');
  expect(output).not.toContain(fixture.state.token);
  const parsed = JSON.parse(output);
  expect(Object.keys(parsed)).toEqual(['credentialTag']);
  expect(parsed.credentialTag).toMatch(/^[a-f0-9]{64}$/);
  return parsed.credentialTag;
}
it('does not renew a consumed permission on a fresh HTTP gateway', async () => {
  const a = await ready();
  expect((await a.receive(call())).result).toBeDefined();
  a.close();
  await a.finish();
  const b = await ready();
  expect((await b.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(1);
});
it('binds a v3 HTTP grant to its selected URL without spending it on another route', async () => {
  alternate = await httpFixture(tool);
  manifest.schemaVersion = 3;
  manifest.route = { transport: 'http', url: fixture.url };
  save(manifestPath, manifest);
  save(endpointPath, {
    schemaVersion: 1,
    url: alternate.url,
    bearerToken: alternate.state.token,
  });
  const wrong = createMcpGateway({
    endpointPath,
    manifestPath,
    grantStorePath,
    onFailure() {},
  });
  gateways.push(wrong);
  expect((await wrong.receive(init())).error).toBeDefined();
  expect(alternate.state.calls).toHaveLength(0);
  expect(fixture.state.calls).toHaveLength(0);
  expect(fs.readdirSync(grantStorePath)).toEqual([]);

  save(endpointPath, { schemaVersion: 1, url: fixture.url, bearerToken: fixture.state.token });
  const selected = await ready();
  expect((await selected.receive(call())).result?.structuredContent).toEqual({ accepted: true });
  expect(fixture.state.calls).toHaveLength(1);
  selected.close();
  await selected.finish();
  const replay = await ready();
  expect((await replay.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(1);
});
it('binds a v4 HTTP grant to the selected bearer across gateway restarts', async () => {
  const tag = await credentialTag();
  expect(await credentialTag()).toBe(tag);
  expect(fixture.state.messages).toHaveLength(0);
  manifest.schemaVersion = 4;
  manifest.route = { transport: 'http', url: fixture.url };
  manifest.credentialTag = tag;
  save(manifestPath, manifest);

  const originalToken = fixture.state.token;
  const differentToken = originalToken[0] === 'A' ? 'B'.repeat(32) : 'A'.repeat(32);
  save(endpointPath, { schemaVersion: 1, url: fixture.url, bearerToken: differentToken });
  const wrong = createMcpGateway({
    endpointPath,
    manifestPath,
    grantStorePath,
    onFailure() {},
  });
  gateways.push(wrong);
  expect((await wrong.receive(init())).error).toBeDefined();
  expect(fixture.state.messages).toHaveLength(0);
  expect(fs.readdirSync(grantStorePath)).toEqual(['.credential-key']);

  save(endpointPath, { schemaVersion: 1, url: fixture.url, bearerToken: originalToken });
  const selected = await ready();
  expect((await selected.receive(call())).result?.structuredContent).toEqual({ accepted: true });
  selected.close();
  await selected.finish();
  const replay = await ready();
  expect((await replay.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(1);
});
it('refuses a v4 call when the private credential key changes after initialization', async () => {
  manifest.schemaVersion = 4;
  manifest.route = { transport: 'http', url: fixture.url };
  manifest.credentialTag = await credentialTag();
  save(manifestPath, manifest);
  const selected = await ready();
  fs.writeFileSync(path.join(grantStorePath, '.credential-key'), Buffer.alloc(32, 7));
  expect((await selected.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
  expect(fs.readdirSync(grantStorePath)).toEqual(['.credential-key']);
});
it('requires an explicit store for durable manifests and refuses a misleading store with v1', async () => {
  for (const version of [2, 3, 4, 1]) {
    if (version === 3) manifest.route = { transport: 'http', url: fixture.url };
    if (version === 4) manifest.credentialTag = 'a'.repeat(64);
    if (version === 1) {
      manifest.schemaVersion = 1;
      manifest.grants = [{ tool: 'record', arguments: { recipient: 'chosen' } }];
      delete manifest.route;
      delete manifest.credentialTag;
    }
    manifest.schemaVersion = version;
    save(manifestPath, manifest);
    const g = createMcpGateway({
      endpointPath,
      manifestPath,
      grantStorePath: version >= 2 ? undefined : grantStorePath,
      onFailure() {},
    });
    gateways.push(g);
    expect((await g.receive(init())).error).toBeDefined();
  }
  expect(fixture.state.messages).toHaveLength(0);
});
it.each(['expired', 'future', 'missing-store'])('denies %s without tool effects', async (mode) => {
  if (mode === 'expired') {
    manifest.grants[0].notBefore = Date.now() - 2000;
    manifest.grants[0].expiresAt = Date.now() - 1000;
  }
  if (mode === 'future') {
    manifest.grants[0].notBefore = Date.now() + 30000;
  }
  save(manifestPath, manifest);
  if (mode === 'missing-store') fs.rmdirSync(grantStorePath);
  const g = await ready();
  expect((await g.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
});
it('rechecks expiration after a fresh catalog before dispatch', async () => {
  const g = await ready();
  fixture.state.onList = (count) => {
    if (count === 2) vi.spyOn(Date, 'now').mockReturnValue(manifest.grants[0].expiresAt);
  };
  expect((await g.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
  vi.restoreAllMocks();
  const b = await ready();
  expect((await b.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
});
it.each(['bad-result', 'catalog-change', 'cancel'])('keeps consumption after %s', async (mode) => {
  fixture.state.mode = mode === 'cancel' ? 'hang-call' : mode;
  const g = await ready();
  const running = g.receive(call());
  if (mode === 'cancel') {
    await vi.waitFor(() => expect(fixture.state.calls).toHaveLength(1));
    await g.receive(rpc(undefined, 'notifications/cancelled', { requestId: 2 }));
  }
  expect((await running).error).toBeDefined();
  g.close();
  await g.finish();
  const before = fixture.state.calls.length;
  fixture.state.mode = 'json';
  const b = await ready();
  expect((await b.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(before);
});
async function cli() {
  const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
  const child = spawn(
    process.execPath,
    [main, '--mcp-gateway-http', endpointPath, manifestPath, grantStorePath],
    { windowsHide: true, stdio: 'pipe' },
  );
  children.push(child);
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
  return {
    child,
    done,
    call: () => child.stdin.write(JSON.stringify(call()) + '\n'),
    output: () => output,
    errors: () => errors,
  };
}
it('allows at most one upstream call from two concurrent native CLI processes', async () => {
  const pair = await Promise.all([cli(), cli()]);
  pair.forEach((c) => c.call());
  await vi.waitFor(
    () =>
      pair.forEach((c) =>
        expect(c.output().includes('structuredContent') || c.child.exitCode === 2).toBe(true),
      ),
    { timeout: 5000 },
  );
  expect(pair.filter((c) => c.output().includes('structuredContent'))).toHaveLength(1);
  for (const c of pair) {
    c.child.stdin.end();
    await c.done;
    expect(c.errors()).toBe('');
  }
  expect(fixture.state.calls).toHaveLength(1);
}, 12000);
it('does not replay after the native gateway dies with a running upstream call', async () => {
  fixture.state.mode = 'hang-call';
  const a = await cli();
  a.call();
  await vi.waitFor(() => expect(fixture.state.calls).toHaveLength(1));
  a.child.kill('SIGKILL');
  await a.done;
  fixture.state.mode = 'json';
  const b = await cli();
  b.call();
  expect((await b.done)[0]).toBe(2);
  expect(fixture.state.calls).toHaveLength(1);
  expect(b.output() + b.errors()).not.toContain('PRIVATE');
}, 12000);

it('cancellation during receipt sync never dispatches or refunds the grant', async () => {
  const promises = require('node:fs/promises');
  const open = promises.open.bind(promises);
  let release, reached;
  const syncing = new Promise((resolve) => {
    reached = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  vi.spyOn(promises, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith('.used')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        reached();
        await blocked;
        return sync();
      };
    }
    return handle;
  });
  const g = await ready();
  const running = g.receive(call());
  try {
    await syncing;
    await g.receive(rpc(undefined, 'notifications/cancelled', { requestId: 2 }));
    expect((await running).error).toBeDefined();
  } finally {
    release();
  }
  await vi.waitFor(() =>
    expect(fs.existsSync(path.join(grantStorePath, '.consume-lock'))).toBe(false),
  );
  vi.restoreAllMocks();
  expect(fixture.state.calls).toHaveLength(0);
  const b = await ready();
  expect((await b.receive(call())).error).toBeDefined();
  expect(fixture.state.calls).toHaveLength(0);
});
