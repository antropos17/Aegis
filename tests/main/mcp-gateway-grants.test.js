import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const subject = require.resolve('../../src/main/mcp-gateway-grants');
const { consumeGatewayGrant, initializeGatewayCredentialKey, readGatewayCredentialKey } = require(
  subject,
);
const fixture = fileURLToPath(new URL('./fixtures/mcp-grant-consumer.cjs', import.meta.url));
let dir;
const children = new Set();
const grant = () => ({
  id: randomBytes(24).toString('hex'),
  taskId: randomBytes(24).toString('hex'),
  notBefore: Date.now() - 1000,
  expiresAt: Date.now() + 60000,
});
const marker = (value) => createHash('sha256').update(value.id).digest('hex') + '.used';

function consumer(value, hold = false) {
  const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child);
  const exited = once(child, 'exit');
  const outcome = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('message', (message) => {
      if (message === 'ready') child.send({ storePath: dir, grant: value, hold });
      else resolve(message);
    });
    child.once('exit', () => reject(Error('consumer exited before its result')));
  });
  return { child, outcome, exited };
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-grants-')));
});
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
  children.clear();
  if (path.basename(dir).startsWith('aegis-grants-') && !(await fs.lstat(dir)).isSymbolicLink())
    await fs.rm(dir, { recursive: true, force: true });
});

describe('persistent one-shot MCP grants', () => {
  it('persists one private credential key and fails closed on damage or a held lock', async () => {
    await fs.writeFile(path.join(dir, '.consume-lock'), '');
    await expect(initializeGatewayCredentialKey(dir)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['.consume-lock']);
    await fs.unlink(path.join(dir, '.consume-lock'));

    const first = await initializeGatewayCredentialKey(dir);
    const second = await initializeGatewayCredentialKey(dir);
    const read = await readGatewayCredentialKey(dir);
    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
    expect(read.equals(first)).toBe(true);
    expect(await fs.readdir(dir)).toEqual(['.credential-key']);
    first.fill(0);
    second.fill(0);
    read.fill(0);

    await fs.writeFile(path.join(dir, '.credential-key'), 'damaged');
    await expect(readGatewayCredentialKey(dir)).rejects.toThrow();
    await expect(initializeGatewayCredentialKey(dir)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['.credential-key']);
  });
  it('persists only a hashed receipt and denies replay after module restart or task changes', async () => {
    const value = grant();
    await expect(consumeGatewayGrant(dir, value)).resolves.toBe(true);
    expect(await fs.readdir(dir)).toEqual([marker(value)]);
    expect(await fs.readFile(path.join(dir, marker(value)), 'utf8')).toBe('{"consumed":true}\n');
    delete require.cache[subject];
    const restarted = require(subject);
    await expect(restarted.consumeGatewayGrant(dir, value)).rejects.toThrow();
    await expect(
      restarted.consumeGatewayGrant(dir, { ...value, taskId: grant().taskId }),
    ).rejects.toThrow();
  });

  it('admits exactly one competing native process and never retries locked writers', async () => {
    const value = grant();
    const running = Array.from({ length: 6 }, () => consumer(value));
    const outcomes = await Promise.all(running.map((item) => item.outcome));
    expect(outcomes.filter((item) => item === 'consumed')).toHaveLength(1);
    expect(outcomes.filter((item) => item === 'denied')).toHaveLength(5);
    await Promise.all(running.map((item) => item.exited));
    expect(await fs.readdir(dir)).toEqual([marker(value)]);
  }, 15000);

  it('retains consumption when the process dies before dispatch and a new process retries', async () => {
    const value = grant();
    const first = consumer(value, true);
    expect(await first.outcome).toBe('consumed');
    first.child.kill('SIGKILL');
    await first.exited;
    const restarted = consumer(value);
    expect(await restarted.outcome).toBe('denied');
    await restarted.exited;
    expect(await fs.readdir(dir)).toEqual([marker(value)]);
  }, 15000);

  it.each([
    { notBefore: Date.now() + 60000 },
    { expiresAt: 0 },
    { expiresAt: NaN },
    { notBefore: -1 },
    { id: '../not-a-grant' },
    { taskId: 'short' },
    { id: 'a'.repeat(32) + '\n' },
    { taskId: 'a'.repeat(32) + '\n' },
  ])('rejects invalid or out-of-window authorization before writing: %j', async (change) => {
    await expect(consumeGatewayGrant(dir, { ...grant(), ...change })).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('rejects a lifetime exceeding 24 hours relative to the same grant start', async () => {
    const value = grant();
    value.expiresAt = value.notBefore + 86400001;
    await expect(consumeGatewayGrant(dir, value)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it.each(['', 'truncated', '{"consumed":false}'])(
    'treats every existing receipt as consumed, regardless of contents',
    async (contents) => {
      const value = grant();
      await fs.writeFile(path.join(dir, marker(value)), contents);
      await expect(consumeGatewayGrant(dir, value)).rejects.toThrow();
      expect(await fs.readFile(path.join(dir, marker(value)), 'utf8')).toBe(contents);
    },
  );

  it('does not remove or recover a crashed writer lock', async () => {
    await fs.writeFile(path.join(dir, '.consume-lock'), '');
    await expect(consumeGatewayGrant(dir, grant())).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['.consume-lock']);
  });

  it('counts unknown entries and serializes the final capacity slot between processes', async () => {
    for (let start = 0; start < 1022; start += 64)
      await Promise.all(
        Array.from({ length: Math.min(64, 1022 - start) }, (_, offset) =>
          fs.writeFile(path.join(dir, 'unknown-' + (start + offset)), ''),
        ),
      );
    const running = Array.from({ length: 6 }, () => consumer(grant()));
    const outcomes = await Promise.all(running.map((item) => item.outcome));
    expect(outcomes.filter((item) => item === 'consumed')).toHaveLength(1);
    await Promise.all(running.map((item) => item.exited));
    expect(await fs.readdir(dir)).toHaveLength(1023);
    await expect(consumeGatewayGrant(dir, grant())).rejects.toThrow();
    expect(await fs.readdir(dir)).toHaveLength(1023);
  }, 20000);

  it('requires an existing absolute directory and rejects files', async () => {
    await fs.writeFile(path.join(dir, 'file'), '');
    for (const selected of ['relative', path.join(dir, 'missing'), path.join(dir, 'file')])
      await expect(consumeGatewayGrant(selected, grant())).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['file']);
  });

  it('rejects a symbolic directory itself and a symbolic ancestor', async (context) => {
    const target = path.join(dir, 'target');
    const alias = path.join(dir, 'alias');
    await fs.mkdir(path.join(target, 'child'), { recursive: true });
    try {
      await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'ENOTSUP') {
        context.skip();
        return;
      }
      throw error;
    }
    await expect(consumeGatewayGrant(alias, grant())).rejects.toThrow();
    await expect(consumeGatewayGrant(path.join(alias, 'child'), grant())).rejects.toThrow();
    expect(await fs.readdir(path.join(target, 'child'))).toEqual([]);
  });
});
