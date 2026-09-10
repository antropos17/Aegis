/**
 * Deterministic operation counts for collection backpressure and token routing.
 * Uses synthetic processes and injected providers; never reads a user's transcripts.
 * Run: node bench/collection-efficiency.js
 */
'use strict';

const assert = require('node:assert/strict');
const { createResourceSampler } = require('../src/main/resource-sampler');
const adapter = require('../src/main/token-adapters/claude-code');
const feed = require('../src/main/token-feed');

async function main() {
  const procs = Array.from({ length: 100 }, (_, i) => ({
    pid: i + 1,
    startTime: 1700000000000,
    agent: i < 2 ? 'Claude Code' : 'Cursor',
  }));
  let registryReads = 0;
  adapter._setHomedirForTest(() => '/synthetic-home');
  adapter._setFsForTest({
    readFileSync: () => {
      registryReads++;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
  });
  // The previous feed forwarded the entire batch to each adapter.
  await adapter.readUsage(procs);
  const beforeReads = registryReads;
  registryReads = 0;
  await feed.readUsageByPid(procs);
  assert.equal(beforeReads, 100);
  assert.equal(registryReads, 2);

  async function burst(serialized) {
    let calls = 0;
    let active = 0;
    let peak = 0;
    const releases = [];
    const collect = async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return [];
    };
    const sampler = createResourceSampler(collect);
    const promises = Array.from({ length: 20 }, () =>
      serialized ? sampler.sample([{ pid: 1, instanceId: '1:1000' }]) : collect(),
    );
    for (const release of releases) release();
    await Promise.all(promises);
    return { calls, peak };
  }
  const before = await burst(false);
  const after = await burst(true);
  assert.deepEqual(before, { calls: 20, peak: 20 });
  assert.deepEqual(after, { calls: 1, peak: 1 });
  console.log(
    JSON.stringify(
      {
        fixture: '100 agents, 2 Claude Code; 20 ticks while resource provider is blocked',
        registryReads: { before: beforeReads, after: registryReads },
        resourceQueries: { before, after },
        limitation:
          'Operation counts on synthetic providers, not an application-wide latency benchmark',
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
