import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const feed = require_('../../src/main/token-feed.js');
const adapter = require_('../../src/main/token-adapters/claude-code.js');
const tracker = require_('../../src/main/token-tracker.js');
const { collectTokenCosts } = require_('../../src/main/token-cost-collector.js');
let root;
let transcript;
let project;
const pid = 44444;
const startedAt = 1790856000000;
const owner = {
  agent: 'Claude Code',
  pid,
  startTime: startedAt,
  instanceId: `${pid}:${startedAt}`,
};
const message = (id, usage) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'claude-sonnet-4-6',
      usage,
      content: 'PRIVATE_CONTENT_SENTINEL',
    },
  }) + '\n';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cache-pricing-'));
  feed._resetForTest();
  adapter._setFsForTest(fs);
  adapter._setHomedirForTest(() => root);
  tracker._resetForTest();
  fs.mkdirSync(path.join(root, '.claude', 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'sessions', `${pid}.json`),
    JSON.stringify({
      sessionId: 'fixture-session',
      cwd: root,
      startedAt,
    }),
  );
  project = path.join(root, '.claude', 'projects', adapter._encodeCwd(root));
  fs.mkdirSync(project, { recursive: true });
  transcript = path.join(project, 'fixture-session.jsonl');
});
afterEach(async () => {
  feed._resetForTest();
  tracker._resetForTest();
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^aegis-cache-pricing-/);
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

it('prices cache reads through the real transcript/feed/collector chain while preserving total tokens', async () => {
  fs.writeFileSync(
    transcript,
    message('read', {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1000000,
      output_tokens: 0,
    }),
  );
  const deltas = await collectTokenCosts([owner]);
  expect(tracker.getCost(owner).costUsd).toBeCloseTo(0.3, 10);
  expect(tracker.getCost(owner).totalTokens).toBe(1000000);
  expect(JSON.stringify(deltas)).not.toContain('PRIVATE_CONTENT_SENTINEL');
  expect(await collectTokenCosts([owner])).toEqual([]);
  expect(tracker.getCost(owner).costUsd).toBeCloseTo(0.3, 10);
});

it('prices mixed cache durations in subagents and shares deduplication with the main transcript', async () => {
  const line = message('mixed', {
    input_tokens: 100,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 400,
    output_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 },
  });
  const subdir = path.join(project, 'fixture-session', 'subagents');
  fs.mkdirSync(subdir, { recursive: true });
  fs.writeFileSync(path.join(subdir, 'agent-leaf.jsonl'), line);
  const deltas = await collectTokenCosts([owner]);
  expect(tracker.getCost(owner)).toMatchObject({
    inputTokens: 1000,
    outputTokens: 50,
    totalTokens: 1050,
    estimated: false,
  });
  expect(tracker.getCost(owner).costUsd).toBeCloseTo(0.00372, 10);
  expect(tracker.getCost(owner).pricingEstimated).toBeUndefined();
  expect(JSON.stringify(deltas)).not.toContain('PRIVATE_CONTENT_SENTINEL');
  fs.writeFileSync(transcript, line);
  expect(await collectTokenCosts([owner])).toEqual([]);
  expect(tracker.getCost(owner).costUsd).toBeCloseTo(0.00372, 10);
});

it('marks unknown cache-write duration as a pricing assumption without guessing token counts', async () => {
  fs.writeFileSync(
    transcript,
    message('unknown-ttl', {
      input_tokens: 0,
      cache_creation_input_tokens: 1000000,
      output_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
    }),
  );
  await collectTokenCosts([owner]);
  expect(tracker.getCost(owner)).toMatchObject({
    totalTokens: 1000000,
    estimated: false,
    pricingEstimated: true,
  });
  expect(tracker.getCost(owner).costUsd).toBeCloseTo(3.75, 10);
  fs.appendFileSync(transcript, message('known', { input_tokens: 1, output_tokens: 0 }));
  await collectTokenCosts([owner]);
  expect(tracker.getCost(owner).pricingEstimated).toBe(true);
});

it('rejects malformed cache categories and uses an explicitly estimated fallback for unknown models', () => {
  expect(
    adapter._extractUsage(
      JSON.parse(
        message('bad', {
          input_tokens: -10,
          output_tokens: '99',
          cache_creation_input_tokens: -20,
          cache_read_input_tokens: 30,
        }),
      ),
    ),
  ).toMatchObject({
    inputTokens: 30,
    outputTokens: 0,
    inputBreakdown: { uncached: 0, read: 30, write5m: 0, write1h: 0, writeUnknown: 0 },
  });
  const breakdown = { uncached: 0, read: 1000000, write5m: 0, write1h: 0, writeUnknown: 0 };
  expect(tracker.computeCost('future-model', 1000000, 0, breakdown)).toEqual({
    costUsd: 3,
    knownModel: false,
    cachePricingEstimated: true,
  });
  expect(tracker.computeCost('claude-sonnet-4-6', 1000000, 0, { ...breakdown, read: -1 })).toEqual({
    costUsd: 3,
    knownModel: true,
    cachePricingEstimated: true,
  });
});
