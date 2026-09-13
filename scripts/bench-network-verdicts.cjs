// Compare trusted network scanner revisions with controlled TCP and DNS providers.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const root = path.resolve(__dirname, '..');
const relative = 'src/main/network-monitor.js';
const filename = path.join(root, relative);
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
if (!/^[0-9a-f]{40}$/.test(baseline || '') || !reportPath || fs.existsSync(reportPath))
  throw new Error('Provide --baseline=<trusted full SHA> and a new --report=<file>');
const oldSource = execFileSync('git', ['show', `${baseline}:${relative}`], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const newSource = fs.readFileSync(filename, 'utf8');
const hash = (source) => createHash('sha256').update(source).digest('hex');
const agents = [
  { pid: 100, agent: 'Codex', instanceId: '100:fixture', category: 'ai' },
  { pid: 200, agent: 'Codex', instanceId: '200:fixture', category: 'ai' },
];

function load(source, rows, addresses) {
  const module = { exports: {} },
    realRequire = createRequire(filename);
  compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], {
    filename,
  })(
    (name) => (name === './platform' ? {} : realRequire(name)),
    module,
    module.exports,
    filename,
    path.dirname(filename),
  );
  const calls = { tcp: 0, reverse: 0, forward: 0 };
  module.exports._setDepsForTest({
    getRawTcpConnections: async () => {
      calls.tcp++;
      return rows;
    },
    dnsReverse: async () => {
      calls.reverse++;
      return ['api.openai.com'];
    },
    dnsResolve: async () => {
      calls.forward++;
      return addresses;
    },
  });
  return { scanner: module.exports, calls };
}

async function measure(arm) {
  const start = performance.now();
  for (let i = 0; i < 5; i++) await arm.scanner.scanNetworkConnections(agents);
  return (performance.now() - start) / 5;
}

async function main() {
  const report = {
    schema: 1,
    kind: 'offline-network-verdicts',
    baseline,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256: { previous: hash(oldSource), current: hash(newSource) },
    inputsSha256: Object.fromEntries(
      [
        'src/shared/constants.js',
        'src/shared/agent-database.json',
        'src/main/process-identity.js',
        'src/main/sensor-health.js',
      ].map((name) => [name, hash(fs.readFileSync(path.join(root, name)))]),
    ),
    cases: [],
  };
  for (const [count, unique] of [
    [256, 1],
    [2048, 1],
    [256, 256],
  ]) {
    const addresses = Array.from(
      { length: unique },
      (_, i) => `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
    );
    const rows = Array.from({ length: count }, (_, i) => ({
      pid: agents[i % 2].pid,
      ip: addresses[i % unique],
      port: i % 2 ? 80 : 443,
      localIp: '192.0.2.1',
      localPort: 10000 + i,
      state: 'Established',
    }));
    const input = structuredClone(rows),
      before = load(oldSource, rows, addresses),
      after = load(newSource, rows, addresses);
    const expected = await before.scanner.scanNetworkConnections(agents);
    assert.deepStrictEqual(await after.scanner.scanNetworkConnections(agents), expected);
    assert.equal(expected.length, count);
    await measure(before);
    await measure(after);
    for (const arm of [before, after]) for (const key of Object.keys(arm.calls)) arm.calls[key] = 0;
    const oldSamples = [],
      newSamples = [];
    for (let i = 0; i < 20; i++) {
      if (i % 2) {
        newSamples.push(await measure(after));
        oldSamples.push(await measure(before));
      } else {
        oldSamples.push(await measure(before));
        newSamples.push(await measure(after));
      }
    }
    assert.deepStrictEqual(before.calls, { tcp: 100, reverse: 0, forward: 0 });
    assert.deepStrictEqual(after.calls, before.calls);
    assert.deepStrictEqual(
      await after.scanner.scanNetworkConnections(agents),
      await before.scanner.scanNetworkConnections(agents),
    );
    assert.deepStrictEqual(rows, input);
    const median = (samples) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return (sorted[9] + sorted[10]) / 2;
    };
    report.cases.push({
      sockets: count,
      uniqueAddresses: unique,
      scansPerArm: 100,
      previous: { medianMsPerScan: median(oldSamples) },
      current: { medianMsPerScan: median(newSamples) },
      measuredProviderCallsPerArm: { tcp: 100, reverse: 0, forward: 0 },
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
