import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import { queryObjects } from 'node:v8';
import adapter from '../../src/main/token-adapters/claude-code.js';

afterEach(() => adapter._resetForTest());

it('releases per-session JS sets after churn and preserves dedup when the oldest session resumes', async () => {
  adapter._resetForTest();
  const home = path.resolve('fixture-claude-retention');
  const cwd = path.join(home, 'workspace');
  const project = path.join(home, '.claude', 'projects', adapter._encodeCwd(cwd));
  const registry = (pid) => path.join(home, '.claude', 'sessions', `${pid}.json`);
  const transcript = (sid) => path.join(project, `${sid}.jsonl`);
  const message = (id, input) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: input, output_tokens: 2 },
      },
    }) + '\n';
  const files = new Map();
  const startedAt = 1790856000000;
  for (let index = 0; index < 5000; index++) {
    files.set(registry(50000 + index), JSON.stringify({ sessionId: `s-${index}`, cwd, startedAt }));
    files.set(transcript(`s-${index}`), message('original', 1));
  }
  adapter._setHomedirForTest(() => home);
  adapter._setLoggerForTest({ warn() {} });
  adapter._setFsForTest({
    existsSync: (file) => files.has(file),
    statSync: (file) => ({ size: Buffer.byteLength(files.get(file)) }),
    readRange: (file, start, length) =>
      Buffer.from(files.get(file)).subarray(start, start + length),
    readdirSync: () => [],
  });
  const before = queryObjects(Set, { format: 'count' });
  const beforeMaps = queryObjects(Map, { format: 'count' });
  let input = 0;
  for (let index = 0; index < 5000; index++) {
    const deltas = await adapter.readUsage([{ pid: 50000 + index, startTime: startedAt }]);
    input += deltas.reduce((sum, delta) => sum + delta.inputTokens, 0);
  }
  expect(input).toBe(5000);
  expect(await adapter.readUsage([])).toEqual([]);
  // Independent V8 heap observation, rather than an implementation-owned size counter.
  expect(queryObjects(Set, { format: 'count' }) - before).toBeLessThan(64);
  expect(queryObjects(Map, { format: 'count' }) - beforeMaps).toBeLessThan(64);

  files.set(transcript('s-0'), message('original', 1) + message('after-resume', 7));
  const resumed = await adapter.readUsage([{ pid: 50000, startTime: startedAt }]);
  expect(resumed).toMatchObject([{ pid: 50000, inputTokens: 7, outputTokens: 2 }]);
  expect(resumed).toHaveLength(1);
  // Rewrite below the old cursor; the old ID still must not become new usage.
  files.set(transcript('s-0'), message('original', 1));
  expect(await adapter.readUsage([{ pid: 50000, startTime: startedAt }])).toEqual([]);
});
