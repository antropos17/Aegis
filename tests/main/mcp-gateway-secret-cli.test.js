import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const secret = 'Synthetic_CLI_Secret_42';
const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
const server = fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
let root, paths, child, tool, manifest;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-secret-cli-'));
  paths = Object.fromEntries(
    ['policy', 'request', 'manifest', 'secrets', 'config', 'started', 'listed', 'effects'].map(
      (name) => [name, path.join(root, name + '.json')],
    ),
  );
  tool = {
    name: 'record',
    inputSchema: schema({ recipient: { type: 'string', maxLength: 128 } }),
    outputSchema: schema({ accepted: { type: 'boolean' } }),
  };
  manifest = {
    schemaVersion: 1,
    tools: [tool],
    grants: [{ tool: 'record', arguments: { recipient: 'chosen' } }],
  };
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [server, paths.config],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot }
        : {},
  };
  save(paths.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(paths.request, { schemaVersion: 1, action });
  save(paths.secrets, { schemaVersion: 1, values: [secret] });
});
afterEach(async () => {
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
async function run(suffix = ['--secret-policy', paths.secrets]) {
  save(paths.manifest, manifest);
  save(paths.config, { ...paths, tool, mode: 'normal' });
  child = spawn(
    process.execPath,
    [
      main,
      '--mcp-gateway-stdio',
      paths.policy,
      paths.request,
      paths.manifest,
      ...(paths.store ? [paths.store] : []),
      ...suffix,
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  const done = once(child, 'close');
  let output = '',
    errors = '',
    pending = '';
  child.stdin.on('error', () => {});
  const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
    pending += chunk;
    while (pending.includes('\n')) {
      const offset = pending.indexOf('\n');
      const message = JSON.parse(pending.slice(0, offset));
      pending = pending.slice(offset + 1);
      if (message.id === 1 && message.result) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'record', arguments: manifest.grants[0].arguments },
        });
      } else child.stdin.end();
    }
  });
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} },
  });
  const [code] = await done;
  expect(output + errors).not.toContain(secret);
  expect(output + errors).not.toContain(Buffer.from(secret).toString('base64'));
  expect(output + errors).not.toContain(paths.secrets);
  return { code, output, errors };
}
it('native stdio CLI accepts the policy flag and completes a clean call', async () => {
  const { code, output } = await run();
  expect(code).toBe(0);
  expect(output).toContain('"accepted":true');
  expect(JSON.parse(fs.readFileSync(paths.effects, 'utf8'))).toEqual({
    name: 'record',
    arguments: { recipient: 'chosen' },
  });
});
it('native stdio CLI blocks approved secret arguments without stdout or stderr disclosure', async () => {
  manifest.grants[0].arguments.recipient = secret;
  expect((await run()).code).toBe(2);
  expect(fs.existsSync(paths.started)).toBe(true);
  expect(fs.existsSync(paths.effects)).toBe(false);
});
it('native stdio CLI rejects a secret-bearing catalog before spawning its server', async () => {
  tool.description = secret;
  expect((await run()).code).toBe(2);
  expect(fs.existsSync(paths.started)).toBe(false);
  expect(fs.existsSync(paths.effects)).toBe(false);
});
it('native stdio CLI supports the policy flag after a durable grant store', async () => {
  manifest.schemaVersion = 2;
  Object.assign(manifest.grants[0], {
    id: 'g'.repeat(32),
    taskId: 't'.repeat(32),
    notBefore: Date.now() - 1000,
    expiresAt: Date.now() + 60000,
  });
  paths.store = path.join(root, 'grants');
  fs.mkdirSync(paths.store);
  expect((await run()).code).toBe(0);
  expect(fs.readdirSync(paths.store)).toHaveLength(1);
  expect((await run()).code).toBe(2);
  expect(fs.readFileSync(paths.effects, 'utf8').trim().split('\n')).toHaveLength(1);
});
it.each(['missing', 'invalid'])(
  'native stdio CLI fails closed on %s policy before spawning',
  async (mode) => {
    if (mode === 'missing') fs.unlinkSync(paths.secrets);
    else save(paths.secrets, { schemaVersion: 1, values: [secret], unexpected: secret });
    expect((await run()).code).toBe(2);
    expect(fs.existsSync(paths.started)).toBe(false);
    expect(fs.existsSync(paths.effects)).toBe(false);
  },
);
it.each(['missing-path', 'duplicate'])(
  'native stdio CLI rejects %s secret-policy suffix',
  async (mode) => {
    const suffix =
      mode === 'missing-path'
        ? ['--secret-policy']
        : ['--secret-policy', paths.secrets, '--secret-policy', paths.secrets];
    const result = await run(suffix);
    expect(result.code).toBe(2);
    expect(result.output).toBe('');
    expect(result.errors).toBe('');
    expect(fs.existsSync(paths.started)).toBe(false);
  },
);
