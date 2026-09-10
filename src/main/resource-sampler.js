/**
 * @file resource-sampler.js
 * @description Keep slow resource collection from overlapping between scan ticks.
 */
'use strict';

/**
 * Create a single-flight sampler. Busy ticks are skipped: the next idle tick must
 * supply its fresh PID/instance pairing, rather than queuing an aging snapshot.
 * Invalidation suppresses a late result without pretending to cancel its OS query.
 * @param {(targets: Array<{pid: number, instanceId: string|null}>) => Promise<Array>} collect
 * @returns {{sample: Function, invalidate: Function}}
 * @since v0.14.1-alpha
 */
function createResourceSampler(collect) {
  let running = false;
  let generation = 0;

  async function sample(targets) {
    if (running) return null;
    running = true;
    const startedGeneration = generation;
    try {
      const records = await collect(targets.map(({ pid, instanceId }) => ({ pid, instanceId })));
      return generation === startedGeneration ? records : null;
    } finally {
      running = false;
    }
  }

  function invalidate() {
    generation++;
  }

  return { sample, invalidate };
}

module.exports = { createResourceSampler };
