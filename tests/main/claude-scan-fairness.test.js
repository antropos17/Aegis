import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import adapter from '../../src/main/token-adapters/claude-code.js';

let root;
function readRange(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(length);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, length, start));
  } finally {
    fs.closeSync(fd);
  }
}
afterEach(async () => {
  adapter._resetForTest();
  adapter._setFsForTest({ ...fs, readRange });
  if (!root) return;
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^aegis-claude-fair-/);
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

it('observes a later process while preceding transcripts continuously fill the scan budget', async () => {
  adapter._resetForTest();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-claude-fair-'));
  adapter._setHomedirForTest(() => root);
  adapter._setFsForTest({ ...fs, readRange });
  const startedAt = 1790856000000;
  const procs = Array.from({ length: 5 }, (_, index) => ({
    pid: 55550 + index,
    startTime: startedAt,
  }));
  const project = path.join(root, '.claude', 'projects', adapter._encodeCwd(root));
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'sessions'), { recursive: true });
  for (const proc of procs) {
    fs.writeFileSync(
      path.join(root, '.claude', 'sessions', `${proc.pid}.json`),
      JSON.stringify({ sessionId: String(proc.pid), cwd: root, startedAt }),
    );
  }
  const busyFiles = procs.slice(0, 4).map((proc) => path.join(project, `${proc.pid}.jsonl`));
  const progress = JSON.stringify({ type: 'progress', padding: 'x'.repeat(480) }) + '\n';
  const backlog = progress.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(progress)));
  for (const file of busyFiles) fs.writeFileSync(file, backlog);
  const later = procs.at(-1);
  fs.writeFileSync(
    path.join(project, `${later.pid}.jsonl`),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'later-one',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 13, output_tokens: 2 },
        content: 'PRIVATE_LATER_CONTENT',
      },
    }) + '\n',
  );
  const first = await adapter.readUsage(procs);
  expect(first).toEqual([]);
  const observed = [];
  for (let scan = 0; scan < procs.length; scan++) {
    for (const file of busyFiles) fs.appendFileSync(file, backlog);
    observed.push(...(await adapter.readUsage(procs)));
  }
  expect(observed).toMatchObject([
    { pid: later.pid, inputTokens: 13, outputTokens: 2, estimated: false },
  ]);
  expect(observed).toHaveLength(1);
  expect(JSON.stringify(observed)).not.toContain('PRIVATE_LATER_CONTENT');
});
