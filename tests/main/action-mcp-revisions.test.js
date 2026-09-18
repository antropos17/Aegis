import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directories = [];
const peers = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-revisions-'));
  directories.push(directory);
  const policy = path.join(directory, 'PRIVATE_POLICY.json');
  const request = path.join(directory, 'PRIVATE_REQUEST.json');
  const sentinels = ['first', 'changed'].map((name) => path.join(directory, name));
  const write = (index = 0) => {
    const action = {
      executable: process.execPath,
      cwd: directory,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(sentinels[index])},'PRIVATE_BODY')`,
      ],
      env:
        process.platform === 'win32'
          ? {
              SYSTEMROOT: process.env.SystemRoot,
              WINDIR: process.env.SystemRoot,
              TEMP: directory,
              TMP: directory,
            }
          : {},
    };
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
    fs.writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision: 'allow' }],
      }),
    );
  };
  write();
  const original = [fs.readFileSync(policy), fs.readFileSync(request)];
  return {
    directory,
    policy,
    request,
    sentinels,
    write,
    restore: () => {
      fs.writeFileSync(policy, original[0]);
      fs.writeFileSync(request, original[1]);
    },
  };
}

function launch(f) {
  const child = spawn(
    process.execPath,
    ['src/main/main.js', '--action-mcp-stdio', f.policy, f.request],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let pending = '';
  let stderr = '';
  let nextId = 0;
  const waiters = new Map();
  let exited = false;
  const closed = new Promise((resolve) =>
    child.once('close', () => {
      exited = true;
      resolve();
    }),
  );
  const lifetime = setTimeout(() => child.kill(), 9000);
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stderr.on('data', (b) => {
    stderr += b;
    if (stderr.length > 65536) child.kill();
  });
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    if (pending.length > 65536) {
      child.kill();
      return;
    }
    while (pending.includes('\n')) {
      const end = pending.indexOf('\n');
      const raw = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        child.kill();
        return;
      }
      const waiter = waiters.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(Error('MCP response timeout'));
      }, 3500);
      waiters.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    }).then((message) => {
      expect(JSON.stringify(message)).not.toContain('PRIVATE');
      expect(JSON.stringify(message)).not.toContain(f.directory);
      expect(JSON.stringify(message)).not.toMatch(/\b[a-f0-9]{64}\b/i);
      return message;
    });
  const peer = {
    send,
    init: async () => {
      const reply = await send('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'revision-test', version: '1' },
      });
      if (reply.result)
        child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      return reply;
    },
    call: () => send('tools/call', { name: 'aegis_execute_selected', arguments: {} }),
    stop: async () => {
      child.stdin.end();
      const killer = setTimeout(() => child.kill(), 500);
      let limit;
      try {
        await Promise.race([
          closed,
          new Promise((_resolve, reject) => {
            limit = setTimeout(() => {
              child.kill();
              child.stdout.destroy();
              child.stderr.destroy();
              child.unref();
              reject(Error('MCP cleanup timeout'));
            }, 1500);
          }),
        ]);
      } finally {
        clearTimeout(killer);
        clearTimeout(limit);
        clearTimeout(lifetime);
        if (!exited) child.kill();
        for (const waiter of waiters.values()) clearTimeout(waiter.timer);
      }
      expect(exited).toBe(true);
      expect(stderr).toBe('');
    },
  };
  peers.push(peer);
  return peer;
}

function denied(reply, reason) {
  expect(reply.result.isError).toBe(true);
  expect(reply.result.structuredContent).toMatchObject({
    decision: 'deny',
    reason,
    execution: { state: 'not-started' },
  });
}

afterEach(async () => {
  for (const peer of peers.splice(0)) await peer.stop();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('revokes a changed matching pair, rejects restored bytes, and requires a fresh server', async () => {
  const f = fixture();
  const peer = launch(f);
  expect((await peer.init()).result).toBeDefined();
  f.write(1);
  denied(await peer.call(), 'configuration-changed');
  f.restore();
  denied(await peer.call(), 'configuration-changed');
  expect(f.sentinels.some((file) => fs.existsSync(file))).toBe(false);
  await peer.stop();
  peers.splice(peers.indexOf(peer), 1);
  const fresh = launch(f);
  expect((await fresh.init()).result).toBeDefined();
  const result = await fresh.call();
  expect(result.result.isError).toBe(false);
  expect(result.result.structuredContent).toMatchObject({
    decision: 'allow',
    execution: { state: 'exited', exitCode: 0 },
  });
  expect(fs.existsSync(f.sentinels[0])).toBe(true);
  expect(fs.existsSync(f.sentinels[1])).toBe(false);
});

it('binds exact policy bytes including otherwise insignificant whitespace', async () => {
  const f = fixture();
  const peer = launch(f);
  expect((await peer.init()).result).toBeDefined();
  fs.appendFileSync(f.policy, '\n');
  denied(await peer.call(), 'configuration-changed');
  expect(f.sentinels.some((file) => fs.existsSync(file))).toBe(false);
});

it('does not revive a binding after an observed missing file is restored', async () => {
  const f = fixture();
  const peer = launch(f);
  expect((await peer.init()).result).toBeDefined();
  fs.unlinkSync(f.request);
  denied(await peer.call(), 'configuration-unavailable');
  f.restore();
  const result = await peer.call();
  expect(result.result.structuredContent).toMatchObject({
    decision: 'deny',
    execution: { state: 'not-started' },
  });
  expect(['configuration-unavailable', 'configuration-changed']).toContain(
    result.result.structuredContent.reason,
  );
  expect(f.sentinels.some((file) => fs.existsSync(file))).toBe(false);
});

it('cannot initialize or execute later when selected input was missing at initialization', async () => {
  const f = fixture();
  fs.unlinkSync(f.policy);
  const peer = launch(f);
  expect((await peer.init()).error).toBeDefined();
  f.restore();
  expect((await peer.init()).error).toBeDefined();
  expect((await peer.call()).error).toBeDefined();
  expect(f.sentinels.some((file) => fs.existsSync(file))).toBe(false);
});
