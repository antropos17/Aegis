import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createModelFixture } from '../../scripts/qualification/model-broker-fixture.mjs';
let server, root, client;
afterEach(async () => {
  vi.restoreAllMocks();
  client?.destroy();
  client = null;
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    server = null;
  }
  if (root) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(root).startsWith('aegis-model-fixture-')).toBe(true);
    try {
      expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
      await fs.rm(root, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    root = null;
  }
});

it('preserves the original setup failure and exposes a cleanup failure without deleting other paths', async () => {
  const mkdtemp = fs.mkdtemp.bind(fs);
  const failure = Object.assign(Error('injected setup'), { code: 'ENOSPC' });
  const cleanupFailure = Object.assign(Error('injected cleanup'), { code: 'EACCES' });
  vi.spyOn(fs, 'mkdtemp').mockImplementation(async (...args) => {
    root = await mkdtemp(...args);
    return root;
  });
  vi.spyOn(fs, 'mkdir').mockRejectedValue(failure);
  const remove = vi.spyOn(fs, 'rm').mockRejectedValue(cleanupFailure);
  let result;
  try {
    await createModelFixture();
  } catch (error) {
    result = error;
  }
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.cause).toBe(failure);
  expect(result.errors[0]).toBe(failure);
  expect(result.errors[1]).toBe(cleanupFailure);
  expect(remove).toHaveBeenCalledExactlyOnceWith(root, { recursive: true, force: true });
});

it.each(['directory', 'certificate', 'endpoint'])(
  'owns and removes all acquired resources after %s setup fails',
  async (phase) => {
    const mkdir = fs.mkdir.bind(fs),
      mkdtemp = fs.mkdtemp.bind(fs),
      readFile = fs.readFile.bind(fs),
      writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'mkdtemp').mockImplementation(async (...args) => {
      root = await mkdtemp(...args);
      return root;
    });
    const create = (phase === 'certificate' ? https : http).createServer;
    vi.spyOn(phase === 'certificate' ? https : http, 'createServer').mockImplementation(
      (...args) => {
        server = create(...args);
        return server;
      },
    );
    const failure = Object.assign(Error('injected setup'), { code: 'ENOSPC' });
    let observedListening = false,
      closeEvents = 0;
    const failAfterListening = async () => {
      observedListening = server.listening;
      server.on('close', () => {
        closeEvents++;
      });
      client = net.createConnection({ host: '127.0.0.1', port: server.address().port });
      client.on('error', () => {});
      await once(client, 'connect');
      throw failure;
    };
    if (phase === 'directory')
      vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
        if (String(args[0]).endsWith('ledger')) throw failure;
        return mkdir(...args);
      });
    if (phase === 'certificate')
      vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
        if (String(args[0]).endsWith('/ca.pem')) return failAfterListening();
        return readFile(...args);
      });
    if (phase === 'endpoint')
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        if (String(args[0]).endsWith('endpoint.json')) return failAfterListening();
        return writeFile(...args);
      });
    await expect(createModelFixture({ secure: phase === 'certificate' })).rejects.toBe(failure);
    if (phase !== 'directory') {
      expect(observedListening).toBe(true);
      expect(server.listening).toBe(false);
      expect(closeEvents).toBe(1);
    }
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
