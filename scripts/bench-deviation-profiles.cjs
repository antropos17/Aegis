// Compare trusted detector revisions using isolated in-memory baseline providers.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const root = path.resolve(__dirname, '..');
const relative = 'src/main/anomaly-detector.js';
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
const realRequire = createRequire(filename);
const scoring = realRequire('./scoring-utils');
const endpoints = Array.from({ length: 256 }, (_, i) => `fixture-${i}.invalid:443`);
const directories = Array.from({ length: 128 }, (_, i) => `/fixture/dir-${i}`);

function fixture(count, distinct, mode) {
  const agents = {},
    sessions = {};
  for (let i = 0; i < count; i++) {
    const name = `Fixture-${distinct ? i : 0}`;
    if (!agents[name])
      agents[name] = {
        sessionCount: 5,
        sessions: Array.from({ length: 5 }, () => ({ networkEndpoints: [...endpoints] })),
        averages: {
          filesPerSession: 10,
          sensitivePerSession: 1,
          knownSensitiveReasons: ['credentials'],
          typicalDirectories: [...directories],
          hourHistogram: Array(24).fill(1),
        },
      };
    sessions[`instance-${i}`] = {
      agentName: name,
      files: new Set(['file']),
      sensitiveCount: 0,
      sensitiveReasons: new Set(['credentials']),
      directories: new Set(directories),
      activeHours: new Set([10]),
      endpoints: new Set(mode === 'normal' ? endpoints : [...endpoints, `new-${i}.invalid:443`]),
    };
  }
  return { agents, sessions };
}

function load(source, data) {
  const module = { exports: {} },
    arm = { detector: null, calls: 0 };
  const provider = {
    getSessionData: () => data.sessions,
    getBaselines: () => ({ agents: data.agents }),
  };
  const tracked = Object.fromEntries(
    Object.entries(scoring).map(([name, fn]) => [
      name,
      (...args) => {
        arm.calls++;
        return fn(...args);
      },
    ]),
  );
  compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], {
    filename,
  })(
    (name) =>
      name === './baselines' ? provider : name === './scoring-utils' ? tracked : realRequire(name),
    module,
    module.exports,
    filename,
    path.dirname(filename),
  );
  arm.detector = module.exports;
  return arm;
}

function measure(arm, ids, fresh) {
  const start = performance.now();
  for (let i = 0; i < 5; i++) {
    if (fresh) arm.detector.forgetInstances(ids);
    arm.detector.checkDeviations();
  }
  return (performance.now() - start) / 5;
}

const report = {
  schema: 1,
  kind: 'offline-deviation-profile-work',
  baseline,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  sourceSha256: { previous: hash(oldSource), current: hash(newSource) },
  scoringSha256: hash(fs.readFileSync(path.join(root, 'src/main/scoring-utils.js'))),
  fixture: { historicalSessions: 5, endpointsPerSession: 256, typicalDirectories: 128 },
  cases: [],
};
for (const [count, distinct] of [
  [1, false],
  [8, false],
  [8, true],
]) {
  for (const mode of ['normal', 'already-warned', 'new-warnings']) {
    const original = fixture(count, distinct, mode);
    const beforeData = structuredClone(original),
      afterData = structuredClone(original);
    const before = load(oldSource, beforeData),
      after = load(newSource, afterData);
    const ids = Object.keys(original.sessions),
      fresh = mode === 'new-warnings';
    const expected = before.detector.checkDeviations();
    assert.deepStrictEqual(after.detector.checkDeviations(), expected);
    assert.equal(expected.length, mode === 'normal' ? 0 : count);
    for (let i = 0; i < 4; i++) {
      measure(before, ids, fresh);
      measure(after, ids, fresh);
    }
    before.calls = after.calls = 0;
    const previousSamples = [],
      currentSamples = [];
    for (let i = 0; i < 20; i++) {
      if (i % 2) {
        currentSamples.push(measure(after, ids, fresh));
        previousSamples.push(measure(before, ids, fresh));
      } else {
        previousSamples.push(measure(before, ids, fresh));
        currentSamples.push(measure(after, ids, fresh));
      }
    }
    assert.equal(before.calls, fresh ? count * 4 * 100 : 0);
    assert.equal(after.calls, before.calls);
    assert.deepStrictEqual(beforeData, original);
    assert.deepStrictEqual(afterData, original);
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return (sorted[9] + sorted[10]) / 2;
    };
    report.cases.push({
      instances: count,
      profiles: distinct ? count : 1,
      mode,
      checksPerArm: 100,
      previous: { medianMsPerCheck: median(previousSamples), dimensionCalls: before.calls },
      current: { medianMsPerCheck: median(currentSamples), dimensionCalls: after.calls },
      matchingResults: true,
    });
    before.detector.forgetInstances(ids);
    after.detector.forgetInstances(ids);
    assert.deepStrictEqual(after.detector.checkDeviations(), before.detector.checkDeviations());
  }
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
