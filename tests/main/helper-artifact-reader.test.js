import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readHelperArtifactFiles } = require('../../src/main/helper-artifact-reader');
let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-helper-reader-'));
  await fs.writeFile(path.join(root, 'manifest.json'), '{}');
  await fs.writeFile(path.join(root, 'signature.bin'), Buffer.alloc(64));
  await fs.writeFile(path.join(root, 'helper.bin'), 'inert helper');
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
  for (const row of await fs.readdir(root)) await fs.unlink(path.join(root, row));
  await fs.rmdir(root);
});
it('reads owned bounded fixed filenames and refuses imported paths', async () => {
  const value = await readHelperArtifactFiles({ root, keyId: 'owner' }, () => {});
  await fs.writeFile(path.join(root, 'helper.bin'), 'replaced');
  expect(value.artifact.toString()).toBe('inert helper');
  await expect(
    readHelperArtifactFiles({ root, keyId: 'owner', artifact: '../outside' }, () => {}),
  ).rejects.toThrow('helper-artifact-unavailable');
});
it('rejects missing/truncated or excessive files without leaking source paths', async () => {
  await fs.unlink(path.join(root, 'signature.bin'));
  await expect(readHelperArtifactFiles({ root, keyId: 'owner' }, () => {})).rejects.toThrow(
    'helper-artifact-unavailable',
  );
});
it('detects replacement between pathname inspection and retained-handle read', async () => {
  await fs.writeFile(path.join(root, 'replacement.bin'), 'other helper');
  const open = fs.open.bind(fs);
  let replaced = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    if (args[0] === path.join(root, 'helper.bin') && !replaced) {
      replaced = true;
      await fs.unlink(args[0]);
      await fs.rename(path.join(root, 'replacement.bin'), args[0]);
    }
    return open(...args);
  });
  await expect(readHelperArtifactFiles({ root, keyId: 'owner' }, () => {})).rejects.toThrow(
    'helper-artifact-unavailable',
  );
  expect(replaced).toBe(true);
});
it('rechecks owner epoch during bounded asynchronous reads and detects growth', async () => {
  let checks = 0;
  await expect(
    readHelperArtifactFiles({ root, keyId: 'owner' }, () => {
      if (++checks === 10) throw Error('revoked');
    }),
  ).rejects.toThrow('helper-artifact-unavailable');
  const open = fs.open.bind(fs);
  let grew = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (args[0] === path.join(root, 'helper.bin')) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        if (!grew) {
          grew = true;
          await fs.appendFile(args[0], 'growth');
        }
        return read(...readArgs);
      };
    }
    return handle;
  });
  await expect(readHelperArtifactFiles({ root, keyId: 'owner' }, () => {})).rejects.toThrow(
    'helper-artifact-unavailable',
  );
  expect(grew).toBe(true);
});
it('refuses linked leaf fixtures without following imported targets', async () => {
  await fs.unlink(path.join(root, 'helper.bin'));
  await fs.mkdir(path.join(root, 'target'));
  await fs.symlink(path.join(root, 'target'), path.join(root, 'helper.bin'), 'junction');
  try {
    await expect(readHelperArtifactFiles({ root, keyId: 'owner' }, () => {})).rejects.toThrow(
      'helper-artifact-unavailable',
    );
  } finally {
    await fs.unlink(path.join(root, 'helper.bin'));
    await fs.rmdir(path.join(root, 'target'));
  }
});
