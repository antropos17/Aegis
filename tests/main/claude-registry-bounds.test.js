import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import adapter from '../../src/main/token-adapters/claude-code.js';

const MAX = 64 * 1024;
const pid = 44444;
const startedAt = 1790856000000;
let root;
let registryPath;
let registry;
let unboundedRead;
let requests;
let source;
let warn;
function readRange(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(length);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, length, start));
  } finally {
    fs.closeSync(fd);
  }
}
beforeEach(() => {
  adapter._resetForTest();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-registry-bounds-'));
  registryPath = path.join(root, '.claude', 'sessions', `${pid}.json`);
  registry = JSON.stringify({ sessionId: 'fixture', cwd: root, startedAt });
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, registry);
  const project = path.join(root, '.claude', 'projects', adapter._encodeCwd(root));
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, 'fixture.jsonl'),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'one',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: 'PRIVATE_TRANSCRIPT',
      },
    }) + '\n',
  );
  requests = [];
  unboundedRead = vi.fn((...args) => fs.readFileSync(...args));
  source = {
    ...fs,
    readFileSync: unboundedRead,
    readRange(file, start, length) {
      requests.push({ file, start, length });
      return readRange(file, start, length);
    },
  };
  adapter._setFsForTest(source);
  adapter._setHomedirForTest(() => root);
  warn = vi.fn();
  adapter._setLoggerForTest({ warn });
});
afterEach(async () => {
  adapter._resetForTest();
  adapter._setFsForTest({ ...fs, readRange });
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^aegis-registry-bounds-/);
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

it('rejects an oversized but valid registry before reading its body and recovers next scan', async () => {
  fs.writeFileSync(registryPath, registry + ' '.repeat(2 * MAX));
  expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toEqual([]);
  expect(unboundedRead).not.toHaveBeenCalled();
  expect(requests).toEqual([]);
  fs.writeFileSync(registryPath, registry);
  const deltas = await adapter.readUsage([{ pid, startTime: startedAt }]);
  expect(deltas).toMatchObject([{ pid, inputTokens: 10, outputTokens: 2, estimated: false }]);
  expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toEqual([]);
  expect(JSON.stringify([deltas, warn.mock.calls])).not.toContain('PRIVATE_TRANSCRIPT');
});

it('accepts a registry exactly at the byte limit using a bounded EOF probe', async () => {
  fs.writeFileSync(registryPath, registry + ' '.repeat(MAX - Buffer.byteLength(registry)));
  expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toMatchObject([
    { pid, inputTokens: 10, outputTokens: 2 },
  ]);
  expect(unboundedRead).not.toHaveBeenCalled();
  expect(requests.filter((request) => request.file === registryPath)).toEqual([
    { file: registryPath, start: 0, length: MAX + 1 },
  ]);
});

it.each(['growth', 'truncation'])(
  'defers a registry %s race and resumes without duplicate usage',
  async (change) => {
    const originalStat = source.statSync;
    source.statSync = (file) => {
      const stat = originalStat(file);
      if (file === registryPath)
        fs.writeFileSync(file, change === 'growth' ? registry + ' '.repeat(2 * MAX) : '{}');
      return stat;
    };
    adapter._setFsForTest(source);
    expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toEqual([]);
    expect(requests.every((request) => request.length <= MAX + 1)).toBe(true);
    expect(unboundedRead).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    source.statSync = originalStat;
    adapter._setFsForTest(source);
    fs.writeFileSync(registryPath, registry);
    expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toMatchObject([
      { pid, inputTokens: 10, outputTokens: 2 },
    ]);
    expect(await adapter.readUsage([{ pid, startTime: startedAt }])).toEqual([]);
  },
);

it('charges registry reads to the shared 4 MiB call budget across many monitored PIDs', async () => {
  const bytes = Buffer.from(registry + ' '.repeat(MAX - Buffer.byteLength(registry)));
  source.statSync = () => ({ size: MAX });
  source.existsSync = () => false;
  source.readRange = (_file, _start, length) => {
    requests.push({ length });
    return bytes.subarray(0, length);
  };
  adapter._setFsForTest(source);
  const procs = Array.from({ length: 200 }, (_, index) => ({
    pid: pid + index,
    startTime: startedAt,
  }));
  expect(await adapter.readUsage(procs)).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.reduce((sum, request) => sum + request.length, 0)).toBeLessThanOrEqual(
    4 * 1024 * 1024,
  );
  expect(unboundedRead).not.toHaveBeenCalled();
});
