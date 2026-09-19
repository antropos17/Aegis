import { beforeEach, afterEach, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-config-cli-'));
});
afterEach(() => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true });
});
function generate(args, preload) {
  const child = spawnSync(
    process.execPath,
    [
      ...(preload ? ['--require', preload] : []),
      'src/main/main.js',
      '--action-mcp-config-json',
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 32768,
      windowsHide: true,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe('');
  expect(child.stdout.trim().split('\n')).toHaveLength(1);
  return { code: child.status, value: JSON.parse(child.stdout), text: child.stdout };
}
async function statusFrom(config) {
  const server = config.mcpServers.aegis;
  const child = spawn(server.command, server.args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffer = '';
  const lines = [];
  const readers = [];
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
  });
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const line = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (readers.length) readers.shift()(line);
      else lines.push(line);
    }
  });
  const next = () =>
    lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve) => readers.push(resolve));
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  const closed = new Promise((resolve) => child.once('close', resolve));
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error('fixture-timeout'));
    }, 5000);
  });
  try {
    const result = await Promise.race([
      (async () => {
        send({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
          },
        });
        expect((await next()).result.serverInfo.name).toBe('aegis-selected-action');
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'aegis_route_status', arguments: {} },
        });
        return (await next()).result.structuredContent;
      })(),
      timeout,
    ]);
    child.stdin.end();
    expect(await Promise.race([closed, timeout])).toBe(0);
    expect(stderr).toBe('');
    return result;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    await closed;
  }
}
function selectedFiles() {
  const policy = path.join(directory, 'политика policy.json');
  const request = path.join(directory, 'запрос request.json');
  const marker = path.join(directory, 'must-not-launch');
  const action = {
    executable: process.execPath,
    cwd: directory,
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'SECRET_ACTION')`],
    env: { SECRET_ENV: 'SECRET_ENV_VALUE' },
  };
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'allow' }],
    }),
  );
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  return { policy, request, marker };
}

it.each(['selected', 'catalog'])(
  'generated %s server accepts handshake and status without executing action',
  async (mode) => {
    const f = selectedFiles();
    const catalog = path.join(directory, 'каталог actions.json');
    fs.writeFileSync(
      catalog,
      JSON.stringify({
        schemaVersion: 1,
        actions: [{ id: 'first', policyPath: f.policy, requestPath: f.request }],
      }),
    );
    const supplied = mode === 'selected' ? [f.policy, f.request] : [catalog];
    const generated = generate([mode, ...supplied]);
    expect(generated.code).toBe(0);
    expect(Object.keys(generated.value)).toEqual(['mcpServers']);
    const server = generated.value.mcpServers.aegis;
    expect(server.command).toBe(process.execPath);
    expect(path.isAbsolute(server.args[0])).toBe(true);
    expect(server.args.slice(2)).toEqual(supplied);
    expect(server).not.toHaveProperty('env');
    expect(generated.text).not.toContain('SECRET_ACTION');
    expect(generated.text).not.toContain('SECRET_ENV_VALUE');
    expect(await statusFrom(generated.value)).toMatchObject({
      mode: 'action-route-status',
      selection: mode === 'selected' ? 'single-action' : 'catalog',
      selectedActionCount: 1,
      actionAttempts: 0,
      ownerInvocations: 0,
      authorization: 'none',
    });
    expect(fs.existsSync(f.marker)).toBe(false);
  },
);

it('exports relay path without reading bearer contents or requiring endpoint existence', () => {
  const endpoint = path.join(directory, 'endpoint private.json');
  const token = 'ab'.repeat(32);
  fs.writeFileSync(endpoint, JSON.stringify({ schemaVersion: 1, port: 1, token }));
  const before = generate(['relay', endpoint]);
  expect(before.code).toBe(0);
  expect(before.text).not.toContain(token);
  fs.unlinkSync(endpoint);
  expect(generate(['relay', endpoint]).value).toEqual(before.value);
  expect(before.value.mcpServers.aegis.args.slice(1)).toEqual(['--action-mcp-connect', endpoint]);
});

it.each(
  [
    [],
    ['wrong', 'PRIVATE_VALUE'],
    ['selected'],
    ['catalog', 'relative_PRIVATE'],
    ['relay', '//server/share/PRIVATE'],
    ['catalog', 'bad\nPRIVATE'],
    ['catalog', 'PRIVATE_ONE', 'PRIVATE_TWO'],
  ].map((args) => [args]),
)('returns fixed private-free error on malformed arguments %j', (args) => {
  const result = generate(args);
  expect(result.code).toBe(1);
  expect(result.value).toEqual({ error: 'expected-action-mcp-config-arguments' });
});

it('generation performs no selected-file read, file writes, process spawn or server listen', () => {
  const preload = path.join(directory, 'instrument.cjs');
  const target = path.join(directory, 'nonexistent catalog.json');
  const marker = path.join(directory, 'side-effect');
  fs.writeFileSync(
    preload,
    `const fs=require('node:fs');const write=fs.writeFileSync.bind(fs);const fail=()=>{write(${JSON.stringify(marker)},'called');throw Error('SIDE_EFFECT')};
const target=${JSON.stringify(target)};for(const name of ['readFileSync','readFile','openSync','open']){const orig=fs[name];fs[name]=function(file,...args){if(file===target)return fail();return orig.call(this,file,...args)}}
for(const name of ['readFile','open']){const orig=fs.promises[name];fs.promises[name]=function(file,...args){if(file===target)return fail();return orig.call(this,file,...args)}}
for(const name of ['writeFileSync','writeFile','appendFileSync','appendFile','mkdirSync','mkdir'])fs[name]=fail;
for(const name of ['writeFile','appendFile','mkdir'])fs.promises[name]=fail;
const cp=require('node:child_process');for(const name of ['spawn','spawnSync','exec','execFile','fork'])cp[name]=fail;
require('node:net').Server.prototype.listen=fail;`,
  );
  expect(generate(['catalog', target], preload).code).toBe(0);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(target)).toBe(false);
});
