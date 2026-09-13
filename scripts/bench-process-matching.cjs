// Offline comparison of the actual scanner before/after a change. No OS process
// enumeration, UAC, monitoring timers or user configuration writes are invoked.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');

const root = path.resolve(__dirname, '..');
const relative = 'src/main/process-scanner.js';
const filename = path.join(root, relative);
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
if (!/^[0-9a-f]{40}$/.test(baseline || '') || !reportPath || fs.existsSync(reportPath))
  throw new Error('Provide --baseline=<full commit SHA> and a new --report=<file>');

const previousSource = execFileSync('git', ['show', `${baseline}:${relative}`], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const currentSource = fs.readFileSync(filename, 'utf8');
const hash = (source) => createHash('sha256').update(source).digest('hex');

/** Load trusted repository scanner code as an isolated CJS instance with real dependencies. */
function load(source) {
  const module = { exports: {} };
  compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], {
    filename,
  })(createRequire(filename), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const previous = load(previousSource),
  current = load(currentSource);
const custom = [
  { id: 'bench-worker', displayName: 'Fixture Worker', names: ['local-fixture-worker.exe'] },
];
let rows = [],
  previousCalls = 0,
  currentCalls = 0;
for (const scanner of [previous, current]) {
  scanner.init({ trackSeenAgent() {}, getCustomAgents: () => custom });
  scanner._setPlatformForTest({
    providesStartTime: false,
    listProcesses: async () => {
      if (scanner === previous) previousCalls++;
      else currentCalls++;
      return rows;
    },
  });
}

/** Measure complete scanner calls over a controlled provider, including catalog and bookkeeping. */
async function measure(scanner, iterations) {
  const cpu = process.cpuUsage(),
    start = performance.now();
  for (let i = 0; i < iterations; i++) await scanner.scanProcesses();
  const elapsed = performance.now() - start;
  const used = process.cpuUsage(cpu);
  return { elapsedMs: elapsed / iterations, cpuMicros: used.user + used.system };
}

/** Summarize interleaved samples without asserting a machine-dependent timing threshold. */
function summarize(samples, iterations) {
  const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  return {
    samples: samples.length,
    scans: samples.length * iterations,
    medianMsPerScan: elapsed[Math.floor(elapsed.length / 2)],
    p95MsPerScan: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
    cpuMsPerScan:
      samples.reduce((sum, sample) => sum + sample.cpuMicros, 0) /
      (1000 * samples.length * iterations),
  };
}

async function main() {
  const report = {
    schema: 1,
    kind: 'offline-process-name-index',
    baseline,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256: { previous: hash(previousSource), current: hash(currentSource) },
    inputsSha256: Object.fromEntries(
      [
        'src/shared/agent-database.json',
        'src/shared/constants.js',
        'src/main/settings-validation.js',
      ].map((name) => [name, hash(fs.readFileSync(path.join(root, name)))]),
    ),
    cases: [],
  };
  const names = ['CODEX.EXE', 'ollama.exe', 'copilot-language-server', 'local-fixture-worker.exe'];
  for (const count of [128, 512, 2048]) {
    rows = Array.from({ length: count }, (_, index) => ({
      pid: 1000 + index,
      name: index % 16 === 0 ? names[(index / 16) % names.length] : `ordinary-worker-${index}.exe`,
    }));
    const unchanged = structuredClone(rows);
    previous._resetForTest();
    current._resetForTest();
    // Reset restores catalog/capabilities, so re-arm only the supported seams.
    for (const scanner of [previous, current]) {
      scanner.init({ trackSeenAgent() {}, getCustomAgents: () => custom });
      scanner._setPlatformForTest({ providesStartTime: false });
    }
    const expected = await previous.scanProcesses();
    assert.deepStrictEqual(await current.scanProcesses(), expected);
    await measure(previous, 20);
    await measure(current, 20);
    const beforeCalls = previousCalls,
      afterCalls = currentCalls;
    const oldSamples = [],
      newSamples = [];
    const iterations = 5;
    for (let trial = 0; trial < 30; trial++) {
      if (trial % 2 === 0) {
        oldSamples.push(await measure(previous, iterations));
        newSamples.push(await measure(current, iterations));
      } else {
        newSamples.push(await measure(current, iterations));
        oldSamples.push(await measure(previous, iterations));
      }
    }
    assert.equal(previousCalls - beforeCalls, 150);
    assert.equal(currentCalls - afterCalls, 150);
    assert.deepStrictEqual(rows, unchanged);
    assert.deepStrictEqual(await current.scanProcesses(), await previous.scanProcesses());
    report.cases.push({
      processes: count,
      agents: expected.agents.length,
      providerCallsPerArm: 150,
      previous: summarize(oldSamples, iterations),
      current: summarize(newSamples, iterations),
      matchingResults: true,
    });
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
