import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const fixture = fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url));
const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
let root, config, manifest, policy, paths, session, failed, child;
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value));
const rpc = (id, method, params) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const init = () =>
  rpc(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
const call = (id = 2, args = { recipient: 'chosen' }) =>
  rpc(id, 'tools/call', { name: 'record', arguments: args });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-gateway-'));
  paths = Object.fromEntries(
    ['policy', 'request', 'manifest', 'config', 'effects', 'started', 'listed'].map((key) => [
      key,
      path.join(root, key + '.json'),
    ]),
  );
  const tool = {
    name: 'record',
    description: 'Record approved operation',
    inputSchema: schema({ recipient: { type: 'string', maxLength: 32 } }),
    outputSchema: schema({ accepted: { type: 'boolean' } }),
  };
  manifest = {
    schemaVersion: 1,
    tools: [tool],
    grants: [{ tool: 'record', arguments: { recipient: 'chosen' } }],
  };
  config = { ...paths, tool, mode: 'normal' };
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [fixture, paths.config],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot }
        : {},
  };
  policy = { schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision: 'allow' }] };
  save(paths.policy, policy);
  save(paths.request, { schemaVersion: 1, action });
  save(paths.manifest, manifest);
  save(paths.config, config);
  failed = vi.fn();
});
afterEach(async () => {
  session?.close();
  if (session) expect(await session.finish()).toBe(true);
  session = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'close');
    child.kill('SIGKILL');
    await done;
  }
  child = undefined;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
function create(mode = 'normal') {
  config.mode = mode;
  save(paths.config, config);
  session = createMcpGateway({
    policyPath: paths.policy,
    requestPath: paths.request,
    manifestPath: paths.manifest,
    onFailure: failed,
  });
  return session;
}
async function ready(mode) {
  create(mode);
  expect((await session.receive(init())).result?.capabilities.tools).toEqual({
    listChanged: false,
  });
  await session.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const effects = () =>
  fs.existsSync(paths.effects)
    ? fs.readFileSync(paths.effects, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
describe('explicit stdio gateway with real owned upstream', () => {
  it('forwards one exact grant, validates result and rejects replay', async () => {
    await ready();
    expect((await session.receive(call())).result.structuredContent).toEqual({ accepted: true });
    expect((await session.receive(call(3))).error.message).toBe('gateway-grant-unavailable');
    expect(effects()).toEqual([{ name: 'record', arguments: { recipient: 'chosen' } }]);
    expect(fs.readFileSync(paths.listed, 'utf8')).toBe('2');
    expect(failed).not.toHaveBeenCalled();
  });
  it.each([{ recipient: 'other' }, { recipient: 5 }, { recipient: 'chosen', extra: true }, {}])(
    'never forwards nonauthorized arguments %j',
    async (args) => {
      await ready();
      expect((await session.receive(call(2, args))).error).toBeDefined();
      expect(effects()).toEqual([]);
      expect((await session.receive(call(3))).result).toBeDefined();
    },
  );
  it.each(['ask', 'deny'])('does not start a server for %s launch policy', async (decision) => {
    policy.rules[0].decision = decision;
    save(paths.policy, policy);
    create();
    expect((await session.receive(init())).error).toBeDefined();
    expect(fs.existsSync(paths.started)).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
  });
  it('rejects unsupported accepted schema before starting a server', async () => {
    manifest.tools[0].inputSchema.$ref = 'https://invalid.invalid/schema';
    save(paths.manifest, manifest);
    create();
    expect((await session.receive(init())).error).toBeDefined();
    expect(fs.existsSync(paths.started)).toBe(false);
  });
  it.each(['policy', 'request', 'manifest'])(
    'revokes after selected %s bytes change',
    async (file) => {
      await ready();
      fs.appendFileSync(paths[file], ' ');
      expect((await session.receive(call())).error).toBeDefined();
      expect(effects()).toEqual([]);
      expect(await session.receive(call(3))).toBeNull();
      expect(failed).toHaveBeenCalledOnce();
    },
  );
  it.each(['catalog-change', 'mutate-policy', 'notification', 'death'])(
    'closes before effects on %s during fresh catalog check',
    async (mode) => {
      await ready(mode);
      expect((await session.receive(call())).error).toBeDefined();
      expect(effects()).toEqual([]);
      expect(failed).toHaveBeenCalledOnce();
      expect(await session.receive(call(3))).toBeNull();
    },
  );
  it.each(['extra-content', 'invalid-result'])(
    'withholds %s after upstream effect; does not claim rollback',
    async (mode) => {
      await ready(mode);
      const response = await session.receive(call());
      expect(response.error.message).toBe('gateway-call-failed');
      expect(JSON.stringify(response)).not.toContain('PRIVATE');
      expect(effects()).toHaveLength(1);
      expect(failed).toHaveBeenCalledOnce();
    },
  );
  it.each(['bad-utf8', 'stderr-flood', 'wrong-id', 'oversize', 'reverse-request'])(
    'closes malformed upstream %s without forwarding diagnostics',
    async (mode) => {
      create(mode);
      const response = await session.receive(init());
      expect(response.error).toBeDefined();
      expect(JSON.stringify(response)).not.toContain('PRIVATE');
      expect(failed).toHaveBeenCalledOnce();
    },
  );
  it('ignores wrong cancellation ID but closes exact running request and holds child cleanup', async () => {
    await ready('hang');
    const running = session.receive(call());
    await vi.waitFor(() => expect(effects()).toHaveLength(1));
    await session.receive({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: '2' },
    });
    expect(failed).not.toHaveBeenCalled();
    expect((await session.receive(call(3))).error.message).toBe('gateway-busy');
    await session.receive({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2 },
    });
    expect((await running).error).toBeDefined();
    expect(await session.finish()).toBe(true);
    expect(await session.receive(call(4))).toBeNull();
  });
  it('cancels initialization and never admits a later call', async () => {
    create('hang-init');
    const initializing = session.receive(init());
    await vi.waitFor(() => expect(fs.existsSync(paths.started)).toBe(true));
    await session.receive({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    });
    expect((await initializing).error).toBeDefined();
    expect(await session.finish()).toBe(true);
    expect(await session.receive(call())).toBeNull();
    expect(effects()).toEqual([]);
  });
  it('closes immediately during configuration capture without a late upstream launch', async () => {
    create();
    const initializing = session.receive(init());
    session.close();
    expect((await initializing).error).toBeDefined();
    // Let the bounded file-read completion run; it must never launch a peer.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(paths.started)).toBe(false);
  });
  it('times out a stalled upstream call and closes admission', async () => {
    await ready('hang');
    expect((await session.receive(call())).error).toBeDefined();
    expect(failed).toHaveBeenCalledOnce();
    expect(await session.finish()).toBe(true);
  }, 7000);
  it('rejects unsupported methods and duplicate IDs without using the grant', async () => {
    await ready();
    expect((await session.receive(rpc(2, 'resources/read', {}))).error.code).toBe(-32601);
    expect((await session.receive(call(2))).error.code).toBe(-32600);
    expect((await session.receive(call(3))).result).toBeDefined();
  });
  it('runs through real Node CLI, keeps stdout protocol-only and cleans up on EOF', async () => {
    child = spawn(
      process.execPath,
      [main, '--mcp-gateway-stdio', paths.policy, paths.request, paths.manifest],
      { stdio: 'pipe', windowsHide: true },
    );
    const done = once(child, 'close');
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (v) => {
      stdout += v;
    });
    child.stderr.on('data', (v) => {
      stderr += v;
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(init()) + '\n');
    await vi.waitFor(() => expect(stdout).toContain('aegis-gateway'), { timeout: 5000 });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    child.stdin.write(JSON.stringify(call()) + '\n');
    await vi.waitFor(() => expect(stdout).toContain('structuredContent'), { timeout: 5000 });
    child.stdin.end();
    expect((await done)[0]).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).not.toContain('PRIVATE');
    expect(stdout.trim().split('\n').map(JSON.parse)).toHaveLength(2);
    expect(effects()).toHaveLength(1);
  }, 12000);
});
