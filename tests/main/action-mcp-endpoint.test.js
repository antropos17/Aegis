import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp-endpoint');
const endpoint = { schemaVersion: 1, port: 42001, token: 'a'.repeat(64) };
let directory, filename;
const handles = [];
const seen = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-endpoint-'));
  filename = path.join(directory, 'endpoint.json');
});
afterEach(async () => {
  api._resetForTest();
  for (const handle of handles.splice(0)) await handle.close().catch(() => {});
  seen.length = 0;
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect((await fs.lstat(directory)).isSymbolicLink()).toBe(false);
  await fs.rm(directory, { recursive: true, force: true });
});
function instrument(build) {
  api._setDepsForTest({
    open: async (...args) => {
      const handle = await fs.open(...args);
      handles.push(handle);
      const base = {
        stat: () => handle.stat(),
        close: () => handle.close(),
        writeFile: (bytes) => {
          seen.push(bytes);
          return handle.writeFile(bytes);
        },
      };
      return { ...base, ...build(handle, base) };
    },
  });
}
const absent = async () => expect(fs.lstat(filename)).rejects.toMatchObject({ code: 'ENOENT' });

describe('exclusive endpoint publication and owned cleanup', () => {
  it('does not replace or remove an existing file', async () => {
    await fs.writeFile(filename, 'PRIVATE_EXISTING');
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    expect(await fs.readFile(filename, 'utf8')).toBe('PRIVATE_EXISTING');
  });

  it('removes only its unchanged published file and clears the private write buffer', async () => {
    instrument(() => ({}));
    const cleanup = await api.publishActionEndpoint(filename, endpoint);
    expect(JSON.parse(await fs.readFile(filename, 'utf8'))).toEqual(endpoint);
    expect(await cleanup()).toBe(true);
    await absent();
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
    expect(await cleanup()).toBe(false);
  });

  it('preserves a replacement with identical bytes but a different file identity', async () => {
    const cleanup = await api.publishActionEndpoint(filename, endpoint);
    const bytes = await fs.readFile(filename);
    await fs.rename(filename, path.join(directory, 'original.json'));
    await fs.writeFile(filename, bytes);
    expect(await cleanup()).toBe(false);
    expect(await fs.readFile(filename)).toEqual(bytes);
  });

  it('preserves changed data in the originally created file', async () => {
    instrument(() => ({}));
    const cleanup = await api.publishActionEndpoint(filename, endpoint);
    await fs.writeFile(filename, 'PRIVATE_CHANGED');
    expect(await cleanup()).toBe(false);
    expect(await fs.readFile(filename, 'utf8')).toBe('PRIVATE_CHANGED');
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });

  it('does not follow a substituted symlink or Windows junction', async () => {
    const cleanup = await api.publishActionEndpoint(filename, endpoint);
    const target = path.join(directory, 'target');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'keep'), 'PRIVATE_TARGET');
    await fs.unlink(filename);
    await fs.symlink(target, filename, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await cleanup()).toBe(false);
    expect((await fs.lstat(filename)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(target, 'keep'), 'utf8')).toBe('PRIVATE_TARGET');
    await fs.unlink(filename);
  });
});

describe('partial publication failures', () => {
  it('removes a confirmed partial write and zeros the buffer before rejecting', async () => {
    instrument((handle) => ({
      writeFile: async (bytes) => {
        seen.push(bytes);
        await handle.write(bytes.subarray(0, 25));
        throw new Error('PRIVATE_WRITE_ERROR');
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    await absent();
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });

  it('recovers from a post-write stat failure using the independently recorded creation identity', async () => {
    let calls = 0;
    instrument((handle) => ({
      stat: async () => {
        if (++calls === 2) throw new Error('PRIVATE_STAT_ERROR');
        return handle.stat();
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    await absent();
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });

  it('retains the empty file when creation identity could not be established', async () => {
    instrument(() => ({
      stat: async () => {
        throw new Error('PRIVATE_UNKNOWN_IDENTITY');
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    expect((await fs.stat(filename)).size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('retains an uncertain partial file when current handle metadata cannot be recovered', async () => {
    let calls = 0;
    instrument((handle) => ({
      stat: async () => {
        if (++calls > 1) throw new Error('PRIVATE_STAT');
        return handle.stat();
      },
      writeFile: async (bytes) => {
        seen.push(bytes);
        await handle.write(bytes.subarray(0, 15));
        throw new Error('PRIVATE_WRITE');
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    expect((await fs.stat(filename)).size).toBe(15);
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });

  it.each([false, true])(
    'cleans up when close fails once (already closed: %s)',
    async (alreadyClosed) => {
      let calls = 0;
      instrument((handle) => ({
        close: async () => {
          if (++calls === 1) {
            if (alreadyClosed) await handle.close();
            throw new Error('PRIVATE_CLOSE');
          }
          await handle.close();
        },
      }));
      await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
        'endpoint-unavailable',
      );
      await absent();
      expect(seen[0].every((byte) => byte === 0)).toBe(true);
    },
  );

  it('preserves a replacement made while the original handle reports write failure', async () => {
    instrument((handle) => ({
      writeFile: async (bytes) => {
        seen.push(bytes);
        await handle.write(bytes.subarray(0, 15));
        await fs.rename(filename, path.join(directory, 'original.json'));
        await fs.writeFile(filename, 'PRIVATE_REPLACEMENT');
        throw new Error('PRIVATE_WRITE');
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    expect(await fs.readFile(filename, 'utf8')).toBe('PRIVATE_REPLACEMENT');
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });

  it('preserves unrelated changed bytes even when the original inode remains', async () => {
    instrument((handle) => ({
      writeFile: async (bytes) => {
        seen.push(bytes);
        await handle.write(Buffer.from('PRIVATE_CHANGED'));
        throw new Error('PRIVATE_WRITE');
      },
    }));
    await expect(api.publishActionEndpoint(filename, endpoint)).rejects.toThrow(
      'endpoint-unavailable',
    );
    expect(await fs.readFile(filename, 'utf8')).toBe('PRIVATE_CHANGED');
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });
});
