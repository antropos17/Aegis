import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const { validManifest } = require('../../src/main/mcp-gateway-schema');
const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
const server = fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url));
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
  rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} });
const call = () => rpc(2, 'tools/call', { name: 'record', arguments: { recipient: 'chosen' } });
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value));

let root, paths, action, manifest;
let gateways = [];
const children = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-v5-'));
  paths = Object.fromEntries(
    ['policy', 'request', 'manifest', 'config', 'started', 'effects', 'listed'].map((name) => [
      name,
      path.join(root, name + '.json'),
    ]),
  );
  paths.store = path.join(root, 'grants');
  fs.mkdirSync(paths.store);
  action = {
    executable: process.execPath,
    cwd: root,
    args: [server, paths.config],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot }
        : {},
  };
  save(paths.config, { ...paths, tool, mode: 'normal' });
  save(paths.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(paths.request, { schemaVersion: 1, action });
  manifest = {
    schemaVersion: 5,
    stdioRouteTag: 'a'.repeat(64),
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
  save(paths.manifest, manifest);
});

afterEach(async () => {
  for (const gateway of gateways) {
    gateway.close();
    expect(await gateway.finish()).toBe(true);
  }
  gateways = [];
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'close');
      child.kill('SIGKILL');
      await done;
    }
  children.length = 0;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

async function runTag() {
  const child = spawn(
    process.execPath,
    [main, '--mcp-gateway-stdio-route-tag', paths.policy, paths.request, paths.store],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  const done = once(child, 'close');
  let output = '',
    errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const [code] = await done;
  return { code, output, errors };
}

async function prepareTag() {
  const result = await runTag();
  expect(result.code).toBe(0);
  expect(result.errors).toBe('');
  const parsed = JSON.parse(result.output);
  expect(Object.keys(parsed)).toEqual(['stdioRouteTag']);
  expect(parsed.stdioRouteTag).toMatch(/^[a-f0-9]{64}$/);
  expect(result.output).not.toContain(process.execPath);
  expect(fs.existsSync(paths.started)).toBe(false);
  manifest.stdioRouteTag = parsed.stdioRouteTag;
  save(paths.manifest, manifest);
  return parsed.stdioRouteTag;
}

function create() {
  const failed = vi.fn();
  const gateway = createMcpGateway({
    policyPath: paths.policy,
    requestPath: paths.request,
    manifestPath: paths.manifest,
    grantStorePath: paths.store,
    onFailure: failed,
  });
  gateways.push(gateway);
  return { gateway, failed };
}

async function ready() {
  const { gateway } = create();
  expect((await gateway.receive(init())).result).toBeDefined();
  await gateway.receive(rpc(undefined, 'notifications/initialized'));
  return gateway;
}

function selectAction(next) {
  action = next;
  save(paths.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(paths.request, { schemaVersion: 1, action });
}

describe('opt-in v5 stdio route binding', () => {
  it('requires only the closed v5 shape and a lowercase opaque tag', () => {
    expect(validManifest(manifest)).toBe(true);
    expect(validManifest({ ...manifest, stdioRouteTag: 'A'.repeat(64) })).toBe(false);
    expect(validManifest({ ...manifest, stdioRouteTag: 'a'.repeat(63) })).toBe(false);
    expect(validManifest({ ...manifest, stdioRouteTag: undefined })).toBe(false);
    expect(validManifest({ ...manifest, route: { transport: 'stdio' } })).toBe(false);
    expect(validManifest({ ...manifest, executable: process.execPath })).toBe(false);
  });

  it('prepares the same tag on restart without running upstream', async () => {
    const first = await prepareTag();
    const second = await runTag();
    expect(second.code).toBe(0);
    expect(JSON.parse(second.output).stdioRouteTag).toBe(first);
    expect(fs.readdirSync(paths.store)).toEqual(['.credential-key']);
    expect(fs.existsSync(paths.started)).toBe(false);
  });

  it('does not create a store key when the selected launch is denied', async () => {
    save(paths.policy, {
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'deny' }],
    });
    const result = await runTag();
    expect(result).toEqual({ code: 2, output: '', errors: '' });
    expect(fs.readdirSync(paths.store)).toEqual([]);
    expect(fs.existsSync(paths.started)).toBe(false);
  });

  it('canonicalizes environment entry order across restarts', async () => {
    selectAction({ ...action, env: { ...action.env, AEGIS_ALPHA: 'one', AEGIS_BETA: 'two' } });
    await prepareTag();
    selectAction({ ...action, env: { AEGIS_BETA: 'two', AEGIS_ALPHA: 'one', ...action.env } });
    const gateway = await ready();
    expect((await gateway.receive(call())).result?.structuredContent).toEqual({ accepted: true });
  });

  it.each(['executable', 'cwd', 'args', 'env'])(
    'rejects a changed effective %s across gateway restarts before upstream launch',
    async (field) => {
      await prepareTag();
      const next = structuredClone(action);
      if (field === 'executable') {
        if (process.platform === 'win32') next.executable = process.execPath.toUpperCase();
        else {
          next.executable = path.join(root, 'node-link');
          fs.symlinkSync(process.execPath, next.executable);
        }
      } else if (field === 'cwd') {
        next.cwd = path.join(root, 'different-cwd');
        fs.mkdirSync(next.cwd);
      } else if (field === 'args') next.args.push('--different-route');
      else next.env.AEGIS_ROUTE_TEST = 'different-value';
      selectAction(next);
      const { gateway, failed } = create();
      const response = await gateway.receive(init());
      expect(response.error?.message).toBe('gateway-unavailable');
      expect(failed).toHaveBeenCalledOnce();
      expect(fs.existsSync(paths.started)).toBe(false);
      expect(fs.readdirSync(paths.store)).toEqual(['.credential-key']);
    },
  );

  it.each(['missing', 'damaged', 'replaced-key', 'missing-tag', 'different-tag'])(
    'rejects %s key or tag before upstream launch',
    async (mode) => {
      await prepareTag();
      if (mode === 'missing') fs.unlinkSync(path.join(paths.store, '.credential-key'));
      if (mode === 'damaged') fs.writeFileSync(path.join(paths.store, '.credential-key'), 'bad');
      if (mode === 'replaced-key')
        fs.writeFileSync(path.join(paths.store, '.credential-key'), randomBytes(32));
      if (mode === 'missing-tag') {
        delete manifest.stdioRouteTag;
        save(paths.manifest, manifest);
      }
      if (mode === 'different-tag') {
        manifest.stdioRouteTag = '0'.repeat(64);
        save(paths.manifest, manifest);
      }
      const { gateway } = create();
      expect((await gateway.receive(init())).error?.message).toBe('gateway-unavailable');
      expect(fs.existsSync(paths.started)).toBe(false);
      expect(fs.existsSync(paths.effects)).toBe(false);
    },
  );

  it('checks the key again before consumption and never forwards a call after replacement', async () => {
    await prepareTag();
    const gateway = await ready();
    fs.writeFileSync(path.join(paths.store, '.credential-key'), randomBytes(32));
    expect((await gateway.receive(call())).error?.message).toBe('gateway-call-failed');
    expect(fs.existsSync(paths.effects)).toBe(false);
    expect(fs.readdirSync(paths.store)).toEqual(['.credential-key']);
  });

  it.each(['policy', 'request'])(
    'rejects selected %s mutation before consuming or forwarding',
    async (source) => {
      await prepareTag();
      const gateway = await ready();
      fs.appendFileSync(paths[source], ' ');
      expect((await gateway.receive(call())).error?.message).toBe('gateway-call-failed');
      expect(fs.existsSync(paths.effects)).toBe(false);
      expect(fs.readdirSync(paths.store)).toEqual(['.credential-key']);
    },
  );

  it('rejects v5 on the HTTP gateway without opening its endpoint', async () => {
    await prepareTag();
    const endpoint = path.join(root, 'endpoint.json');
    save(endpoint, {
      schemaVersion: 1,
      url: 'http://127.0.0.1:4567/mcp',
      bearerToken: 'b'.repeat(32),
    });
    const gateway = createMcpGateway({
      endpointPath: endpoint,
      manifestPath: paths.manifest,
      grantStorePath: paths.store,
      onFailure() {},
    });
    gateways.push(gateway);
    expect((await gateway.receive(init())).error?.message).toBe('gateway-unavailable');
    expect(fs.readdirSync(paths.store)).toEqual(['.credential-key']);
  });

  it('persists one attempt and rejects replay after restart', async () => {
    await prepareTag();
    const first = await ready();
    expect((await first.receive(call())).result?.structuredContent).toEqual({ accepted: true });
    first.close();
    expect(await first.finish()).toBe(true);
    const second = await ready();
    expect((await second.receive(call())).error?.message).toBe('gateway-call-failed');
    expect(fs.readFileSync(paths.effects, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readdirSync(paths.store)).toHaveLength(2);
  });

  it('does not renew a spent grant ID when a second stdio route gets its own tag', async () => {
    await prepareTag();
    const first = await ready();
    expect((await first.receive(call())).result).toBeDefined();
    first.close();
    expect(await first.finish()).toBe(true);
    fs.unlinkSync(paths.started);
    selectAction({ ...action, args: [...action.args, '--second-route'] });
    await prepareTag();
    const second = await ready();
    expect((await second.receive(call())).error?.message).toBe('gateway-call-failed');
    expect(fs.readFileSync(paths.effects, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readdirSync(paths.store)).toHaveLength(2);
  });
});
