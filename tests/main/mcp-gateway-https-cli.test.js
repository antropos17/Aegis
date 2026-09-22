import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { httpFixture } from './fixtures/mcp-http-server';
const read = (name) =>
  fs.readFileSync(new URL('./fixtures/mcp-tls/' + name, import.meta.url), 'utf8');
const tool = {
  name: 'record',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: { accepted: { type: 'boolean' } },
    required: ['accepted'],
    additionalProperties: false,
  },
};
const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' },
  },
};
const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
let fixture, proxy, directory, endpointPath, manifestPath, child;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-https-cli-'));
  fixture = await httpFixture(tool, { cert: read('server.pem'), key: read('server.key') });
  endpointPath = path.join(directory, 'endpoint.json');
  manifestPath = path.join(directory, 'manifest.json');
  fs.writeFileSync(
    endpointPath,
    JSON.stringify({
      schemaVersion: 2,
      url: fixture.url,
      connectAddress: '127.0.0.1',
      bearerToken: fixture.state.token,
      caCertificate: read('ca.pem'),
      certificateSha256: createHash('sha256')
        .update(new X509Certificate(read('server.pem')).raw)
        .digest('hex'),
    }),
  );
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      tools: [tool],
      grants: [{ tool: 'record', arguments: {} }],
    }),
  );
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'close');
    child.kill('SIGKILL');
    await done;
  }
  child = undefined;
  await fixture.close();
  if (proxy) await proxy.close();
  proxy = undefined;
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true });
});
function start(flags = [], env = process.env) {
  child = spawn(
    process.execPath,
    [...flags, main, '--mcp-gateway-http', endpointPath, manifestPath],
    { windowsHide: true, stdio: 'pipe', env },
  );
  const done = once(child, 'close');
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (v) => {
    output.stdout += v;
  });
  child.stderr.on('data', (v) => {
    output.stderr += v;
  });
  child.stdin.on('error', () => {});
  child.stdin.write(JSON.stringify(init) + '\n');
  return { done, output };
}
it.each([
  'keylog-argv',
  'keylog-options',
  'keylog-obfuscated-options',
  'keylog-alias',
  'keylog-config',
  'trace-argv',
  'trace-options',
  'debug-tls',
  'debug-https',
])(
  'rejects native credential diagnostics %s before TLS',
  async (mode) => {
    const keylog = path.join(directory, 'owned-test-keylog.txt');
    const option = mode.startsWith('keylog') ? '--tls-keylog=' + keylog : '--trace-tls';
    const env = { ...process.env };
    let flags = [];
    if (mode === 'keylog-obfuscated-options')
      env.NODE_OPTIONS = '--tls-""keylog=' + JSON.stringify(keylog);
    else if (mode === 'keylog-alias') flags = ['--tls_keylog=' + keylog];
    else if (mode === 'keylog-config') {
      const config = path.join(directory, 'node-config.json');
      fs.writeFileSync(config, JSON.stringify({ nodeOptions: { 'tls-keylog': keylog } }));
      flags = ['--experimental-config-file=' + config];
    } else if (mode.startsWith('debug')) env.NODE_DEBUG = mode === 'debug-tls' ? 'tls' : 'https';
    else if (mode.endsWith('options')) env.NODE_OPTIONS = JSON.stringify(option);
    else flags = [option];
    const { done, output } = start(flags, env);
    expect((await done)[0]).toBe(2);
    expect(fixture.state.messages).toHaveLength(0);
    expect(fixture.state.connections).toBe(0);
    expect(output.stdout + output.stderr).not.toContain(fixture.state.token);
    expect(output.stdout + output.stderr).not.toContain('CLIENT_RANDOM');
    expect(!fs.existsSync(keylog) || fs.statSync(keylog).size === 0).toBe(true);
  },
  7000,
);
it('native HTTPS CLI avoids an active environment proxy and resolves no fixture DNS name', async () => {
  proxy = await httpFixture(tool);
  const address = new URL(proxy.url).origin;
  const env = {
    ...process.env,
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: address,
    HTTPS_PROXY: address,
    http_proxy: address,
    https_proxy: address,
    NO_PROXY: '',
    no_proxy: '',
  };
  // Positive control: the default HTTPS agent sends CONNECT to the selected proxy.
  const script =
    "const h=require('node:https');const r=h.request(process.argv[1],s=>{s.resume();s.on('end',()=>process.exit(0))});r.on('error',()=>process.exit(2));r.setTimeout(2000,()=>process.exit(2));r.end();";
  child = spawn(process.execPath, ['-e', script, fixture.url], {
    windowsHide: true,
    stdio: 'ignore',
    env,
  });
  expect((await once(child, 'close'))[0]).toBe(2);
  expect(proxy.state.connects).toEqual([new URL(fixture.url).host]);
  expect(fixture.state.messages).toHaveLength(0);
  proxy.state.connects.length = 0;
  const { done, output } = start([], env);
  await vi.waitFor(() => expect(output.stdout).toContain('aegis-gateway'), { timeout: 5000 });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'record', arguments: {} },
    }) + '\n',
  );
  await vi.waitFor(() => expect(output.stdout).toContain('structuredContent'), { timeout: 5000 });
  child.stdin.end();
  expect((await done)[0]).toBe(0);
  expect(fixture.state.calls).toHaveLength(1);
  expect(fixture.state.deletes).toBe(1);
  expect(proxy.state.messages).toHaveLength(0);
  expect(proxy.state.connects).toHaveLength(0);
  expect(output.stdout + output.stderr).not.toContain(fixture.state.token);
  expect(output.stderr).toBe('');
}, 12000);
