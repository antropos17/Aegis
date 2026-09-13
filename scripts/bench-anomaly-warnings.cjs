// Compare trusted anomaly-detector revisions with deterministic in-memory sessions.
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
  throw new Error('Provide --baseline=<trusted full commit SHA> and a new --report=<file>');
const previousSource = execFileSync('git', ['show', `${baseline}:${relative}`], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const currentSource = fs.readFileSync(filename, 'utf8');
const hash = (source) => createHash('sha256').update(source).digest('hex');
const realRequire = createRequire(filename);
const scoring = realRequire('./scoring-utils');
const endpoints = Array.from({ length: 256 }, (_, i) => `fixture-${i}.invalid:443`);
const directories = Array.from({ length: 128 }, (_, i) => `/fixture/dir-${i}`);
const profile = {
  sessionCount: 5,
  sessions: Array.from({ length: 5 }, () => ({ networkEndpoints: endpoints })),
  averages: {
    filesPerSession: 10,
    sensitivePerSession: 1,
    knownSensitiveReasons: [],
    typicalDirectories: directories,
    hourHistogram: Array(24).fill(1),
  },
};
let sessions;
const provider = {
  getSessionData: () => sessions,
  getBaselines: () => ({ agents: { Fixture: profile } }),
};

function load(source) {
  const module = { exports: {} };
  const arm = { calls: 0, detector: null };
  const tracked = Object.fromEntries(
    Object.entries(scoring).map(([key, score]) => [
      key,
      (...args) => {
        arm.calls++;
        return score(...args);
      },
    ]),
  );
  const requireFixture = (name) =>
    name === './baselines' ? provider : name === './scoring-utils' ? tracked : realRequire(name);
  compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], {
    filename,
  })(requireFixture, module, module.exports, filename, path.dirname(filename));
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
  kind: 'offline-anomaly-warning-work',
  baseline,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  sourceSha256: { previous: hash(previousSource), current: hash(currentSource) },
  scoringSha256: hash(fs.readFileSync(path.join(root, 'src/main/scoring-utils.js'))),
  cases: [],
};
for (const count of [8, 64]) {
  for (const mode of ['normal', 'already-warned', 'new-warnings']) {
    sessions = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `instance-${i}`,
        {
          agentName: 'Fixture',
          files: new Set(['file']),
          sensitiveCount: 0,
          sensitiveReasons: new Set(),
          directories: new Set(directories),
          activeHours: new Set([10]),
          endpoints: new Set(
            mode === 'normal' ? endpoints : [...endpoints, `new-${i}.invalid:443`],
          ),
        },
      ]),
    );
    const ids = Object.keys(sessions),
      before = load(previousSource),
      after = load(currentSource);
    assert.deepStrictEqual(after.detector.checkDeviations(), before.detector.checkDeviations());
    const fresh = mode === 'new-warnings';
    for (let i = 0; i < 4; i++) {
      measure(before, ids, fresh);
      measure(after, ids, fresh);
    }
    before.calls = after.calls = 0;
    const oldSamples = [],
      newSamples = [];
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        oldSamples.push(measure(before, ids, fresh));
        newSamples.push(measure(after, ids, fresh));
      } else {
        newSamples.push(measure(after, ids, fresh));
        oldSamples.push(measure(before, ids, fresh));
      }
    }
    const median = (samples) => samples.sort((a, b) => a - b)[10];
    report.cases.push({
      instances: count,
      mode,
      checksPerArm: 100,
      previous: { medianMsPerCheck: median(oldSamples), dimensionCalls: before.calls },
      current: { medianMsPerCheck: median(newSamples), dimensionCalls: after.calls },
      matchingResults: true,
    });
    assert.equal(before.calls, count * 4 * 100);
    assert.equal(after.calls, fresh ? count * 4 * 100 : 0);
    before.detector.forgetInstances(ids);
    after.detector.forgetInstances(ids);
    assert.deepStrictEqual(after.detector.checkDeviations(), before.detector.checkDeviations());
  }
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
