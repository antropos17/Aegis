import { afterEach, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerFile = fileURLToPath(
  new URL('./fixtures/mcp-gateway-reviewed-worker.cjs', import.meta.url),
);
const upstreamFile = fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url));
const workers = [];
const roots = [];
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const rpcInit = { type: 'initialized', ok: true };

function start(root, review = 'approve') {
  const environment = {
    TEMP: root,
    TMP: root,
    HOME: root,
    USERPROFILE: root,
    APPDATA: root,
    LOCALAPPDATA: root,
    ...(process.platform === 'win32'
      ? { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT }
      : {}),
  };
  const child = fork(workerFile, [root, review], {
    cwd: root,
    env: environment,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const state = { child, messages: [], errors: [], exited: null };
  state.exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.on('error', (error) => state.errors.push(error.code));
  child.on('message', (message) => {
    if (state.messages.length < 32) state.messages.push(message);
  });
  workers.push(state);
  return state;
}

async function stop(worker) {
  if (worker.child.connected) {
    try {
      worker.child.send('stop');
    } catch (error) {
      worker.errors.push(error.code);
    }
  }
  async function awaitClose() {
    let timeout;
    const exited = await Promise.race([
      worker.exited,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), 3000);
      }),
    ]);
    clearTimeout(timeout);
    return exited;
  }
  const exited = await awaitClose();
  if (exited) return exited;
  worker.child.kill();
  return awaitClose();
}

afterEach(async () => {
  const owned = workers.splice(0);
  const exited = await Promise.all(owned.map(stop));
  for (const root of roots.splice(0)) {
    // Retain the directory if worker and helper cleanup was not confirmed.
    if (
      exited.some((result) => !result) ||
      owned.some(
        (worker) =>
          !worker.messages.some((message) => message.type === 'stopped' && message.clean === true),
      )
    )
      continue;
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('keeps the consumed grant spent across a gateway process replacement after an effect and withheld response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-restart-'));
  roots.push(root);
  const files = Object.fromEntries(
    [
      'policy',
      'request',
      'manifest',
      'config',
      'effects',
      'started',
      'listed',
      'store',
      'disclosure',
      'secrets',
    ].map((name) => [name, path.join(root, name)]),
  );
  fs.mkdirSync(files.store);
  const objectSchema = (properties) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const tool = {
    name: 'record',
    inputSchema: objectSchema({ recipient: { type: 'string', maxLength: 64 } }),
    outputSchema: objectSchema({ accepted: { type: 'boolean' } }),
  };
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [upstreamFile, files.config],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT, TEMP: root, TMP: root }
        : { TEMP: root, TMP: root },
  };
  const now = Date.now();
  const grant = {
    id: '1'.repeat(32),
    taskId: 't'.repeat(32),
    notBefore: now - 1000,
    expiresAt: now + 120000,
    tool: 'record',
    arguments: { recipient: 'chosen' },
  };
  save(files.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(files.request, { schemaVersion: 1, action });
  save(files.manifest, { schemaVersion: 2, tools: [tool], grants: [grant] });
  save(files.config, { ...files, tool, mode: 'hang' });
  save(files.secrets, { schemaVersion: 1, values: ['Synthetic_Secret_847'] });
  save(files.disclosure, { schemaVersion: 1, tools: [{ name: 'record', paths: ['/recipient'] }] });
  const effects = () =>
    fs.existsSync(files.effects)
      ? fs.readFileSync(files.effects, 'utf8').trim().split('\n').map(JSON.parse)
      : [];

  const first = start(root);
  first.child.send('initialize');
  await vi.waitFor(() => expect(first.messages).toContainEqual(rpcInit), { timeout: 8000 });
  first.child.send('call');
  await vi.waitFor(() => expect(effects()).toHaveLength(1), { timeout: 8000 });
  expect(first.messages.filter((message) => message.type === 'review')).toHaveLength(1);
  expect(first.messages.some((message) => message.type === 'result')).toBe(false);
  const receipt = createHash('sha256').update(grant.id).digest('hex') + '.used';
  expect(fs.existsSync(path.join(files.store, receipt))).toBe(true);
  expect(await stop(first)).toEqual({ code: 0, signal: null });
  expect(first.messages).toContainEqual({ type: 'stopped', clean: true });
  expect(first.messages).toContainEqual({ type: 'result', error: 'gateway-call-failed' });
  expect(fs.existsSync(path.join(files.store, '.consume-lock'))).toBe(false);

  const second = start(root);
  second.child.send('initialize');
  await vi.waitFor(() => expect(second.messages).toContainEqual(rpcInit), { timeout: 8000 });
  second.child.send('call');
  await vi.waitFor(
    () => expect(second.messages).toContainEqual({ type: 'result', error: 'gateway-call-failed' }),
    { timeout: 8000 },
  );
  expect(second.messages.filter((message) => message.type === 'review')).toHaveLength(0);
  expect(effects()).toEqual([{ name: 'record', arguments: { recipient: 'chosen' } }]);
  expect(await stop(second)).toEqual({ code: 0, signal: null });
  expect(second.messages).toContainEqual({ type: 'stopped', clean: true });

  // A fresh grant reaches review in this store, then the scripted owner declines.
  const fresh = { ...grant, id: '2'.repeat(32) };
  save(files.manifest, { schemaVersion: 2, tools: [tool], grants: [fresh] });
  const third = start(root, 'deny');
  third.child.send('initialize');
  await vi.waitFor(() => expect(third.messages).toContainEqual(rpcInit), { timeout: 8000 });
  third.child.send('call');
  await vi.waitFor(
    () =>
      expect(third.messages).toContainEqual({ type: 'result', error: 'gateway-review-declined' }),
    { timeout: 8000 },
  );
  expect(third.messages.filter((message) => message.type === 'review')).toHaveLength(1);
  expect(effects()).toEqual([{ name: 'record', arguments: { recipient: 'chosen' } }]);
  expect(await stop(third)).toEqual({ code: 0, signal: null });
  expect(third.messages).toContainEqual({ type: 'stopped', clean: true });
}, 30000);
