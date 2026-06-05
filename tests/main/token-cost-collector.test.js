/**
 * @file token-cost-collector.test.js
 * @description Unit suite for the per-tick token-cost COLLECTOR — the seam that
 *   sits between the live scan loop and the token-feed/token-tracker pair. It
 *   filters the scanned agents down to those carrying a real OS birth-time,
 *   makes ONE feed read for them, and folds every returned measured delta into
 *   the tracker under its own source pid (C-01).
 *
 *   DI-style: the feed's adapter registry is swapped via `_setAdaptersForTest`
 *   (NOT `vi.mock`, which would hit the ESM/CJS module-identity trap), and both
 *   the tracker and the feed are reset before each case so accounting state
 *   never leaks across tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

// createRequire pulls the main-process CJS modules through Node's native require
// cache — the SAME cache the collector's own `require('./token-feed')` hits. A
// bare ESM `import` would key a separate module record (the ESM/CJS identity
// trap), so `_setAdaptersForTest` set here would be invisible to the collector.
// Mirrors the blocklist / scan-loop test convention.
const require = createRequire(import.meta.url);
const tokenFeed = require('../../src/main/token-feed.js');
const tokenTracker = require('../../src/main/token-tracker.js');
const { collectTokenCosts } = require('../../src/main/token-cost-collector.js');

/** A scanned-agent stub. `name` defaults to a non-token agent so the procs-filter
 *  cases stay isolated from the Claude-Code honesty-warn path. */
const agent = (pid, startTime, name = 'OtherAgent') => ({ agent: name, pid, startTime });

/** A measured per-PID usage delta as the claude-code adapter would emit one. */
const delta = (pid, inputTokens) => ({
  pid,
  model: 'claude-opus-4-8',
  inputTokens,
  outputTokens: 5,
  estimated: false,
});

beforeEach(() => {
  tokenTracker._resetForTest();
  tokenFeed._resetForTest();
});

describe('token-cost-collector — folds measured deltas into the tracker', () => {
  it('(a) records one non-zero cost entry per delta pid (C-01: keyed by source pid)', async () => {
    tokenFeed._setAdaptersForTest([
      { id: 'fake', readUsage: vi.fn(async () => [delta(1, 100), delta(2, 200)]) },
    ]);

    await collectTokenCosts([agent(1, 1000), agent(2, 2000)]);

    const costs = tokenTracker.getAllCosts();
    expect(costs).toHaveLength(2);
    const byPid = Object.fromEntries(costs.map((c) => [c.pid, c]));
    expect(byPid[1]).toBeDefined();
    expect(byPid[2]).toBeDefined();
    expect(byPid[1].totalTokens).toBeGreaterThan(0);
    expect(byPid[2].totalTokens).toBeGreaterThan(0);
  });

  it('(b) forwards procs ONLY for agents whose startTime is a number', async () => {
    const readUsage = vi.fn(async () => []);
    tokenFeed._setAdaptersForTest([{ id: 'fake', readUsage }]);

    await collectTokenCosts([agent(1, 1000), agent(2, 2000), agent(3, undefined), agent(4, null)]);

    expect(readUsage).toHaveBeenCalledTimes(1);
    const procs = readUsage.mock.calls[0][0];
    expect(procs).toEqual([
      { pid: 1, startTime: 1000 },
      { pid: 2, startTime: 2000 },
    ]);
  });

  it('(c) reads the feed exactly once per tick', async () => {
    const readUsage = vi.fn(async () => [delta(1, 10)]);
    tokenFeed._setAdaptersForTest([{ id: 'fake', readUsage }]);

    await collectTokenCosts([agent(1, 1000)]);

    expect(readUsage).toHaveBeenCalledTimes(1);
  });
});
