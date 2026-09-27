'use strict';

const { performance } = require('node:perf_hooks');
const { createBatcher } = require('../src/main/ipc-batcher');
const { FILE_ACCESS_BATCHER_OPTIONS } = require('../src/main/file-access-batching');

const repetitions = 100;
const samples = 11;
const warmups = 3;

function events(count) {
  return Array.from({ length: count }, (_, i) => {
    const sensitive = i % 17 === 0;
    const selfAccess = !sensitive && i % 3 === 0;
    return {
      sensitive,
      selfAccess,
      instanceId: `${i % 83}:1000`,
      file: `C:\\bench\\file-${i % 353}`,
      action: 'read',
    };
  });
}

function measure(batch) {
  const begin = performance.now();
  for (let run = 0; run < repetitions; run++) {
    const batcher = createBatcher('file-access', () => {}, FILE_ACCESS_BATCHER_OPTIONS);
    for (const event of batch) batcher.push(event);
    batcher.flush();
  }
  return (performance.now() - begin) / repetitions;
}

for (const count of [1000, 3000]) {
  const batch = events(count);
  for (let i = 0; i < warmups; i++) measure(batch);
  const durations = Array.from({ length: samples }, () => measure(batch)).sort((a, b) => a - b);
  const median = durations[Math.floor(samples / 2)];
  console.log(
    JSON.stringify({
      count,
      repetitions,
      samples,
      medianMs: median,
      minMs: durations[0],
      maxMs: durations.at(-1),
    }),
  );
}
