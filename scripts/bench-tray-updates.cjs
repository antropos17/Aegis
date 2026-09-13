// Execute trusted tray revisions with an in-memory activity log and fake native APIs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/main/tray-icon.js');
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
if (!/^[0-9a-f]{40}$/.test(baseline || '') || !reportPath || fs.existsSync(reportPath))
  throw new Error('Provide --baseline=<trusted full SHA> and a new --report=<file>');
const oldSource = execFileSync('git', ['show', `${baseline}:src/main/tray-icon.js`], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const newSource = fs.readFileSync(filename, 'utf8');
const hash = (source) => createHash('sha256').update(source).digest('hex');

function load(source, size) {
  const calls = { history: 0, tooltip: 0, menu: 0, image: 0 };
  const visible = {};
  let sensitive = 6;
  const events = Array.from({ length: size }, (_, i) => ({ sensitive: i < 6 }));
  const fakeElectron = {
    Menu: {
      buildFromTemplate: (items) =>
        items.map(({ click, ...item }) => {
          // Callbacks are separate function instances; compare only visible menu fields.
          void click;
          return item;
        }),
    },
    nativeImage: { createFromBuffer: (buffer) => buffer },
  };
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  compileFunction(source, ['require', 'module', 'exports', '__filename', '__dirname'], {
    filename,
  })(
    (name) => (name === 'electron' ? fakeElectron : realRequire(name)),
    module,
    module.exports,
    filename,
    path.dirname(filename),
  );
  module.exports.init({
    tray: {
      setToolTip: (value) => {
        calls.tooltip++;
        visible.tooltip = value;
      },
      setContextMenu: (value) => {
        calls.menu++;
        visible.menu = value;
      },
      setImage: (value) => {
        calls.image++;
        visible.image = value;
      },
    },
    currentTrayColor: 'green',
    getSensitiveCount: () => sensitive,
    getActivityLog: () => {
      calls.history++;
      return events;
    },
    isMonitoringPaused: () => false,
    getAgentCount: () => 2,
  });
  return {
    calls,
    visible,
    update(count) {
      sensitive = count;
      for (let i = 0; i < 6; i++) events[i].sensitive = i < count;
      module.exports.updateTrayIcon();
    },
  };
}

function measure(arm, changing) {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) arm.update(changing ? 5 + (i % 2) : 6);
  return (performance.now() - start) / 1000;
}

const report = {
  schema: 1,
  kind: 'offline-tray-updates',
  baseline,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  sourceSha256: { previous: hash(oldSource), current: hash(newSource) },
  cases: [],
};
for (const size of [1000, 10000]) {
  for (const changing of [false, true]) {
    const before = load(oldSource, size),
      after = load(newSource, size);
    // Verify every visible field after increases/decreases, before measuring.
    for (const count of [0, 1, 5, 6, 5, 0, 6]) {
      before.update(count);
      after.update(count);
      assert.deepStrictEqual(after.visible, before.visible);
    }
    measure(before, changing);
    measure(after, changing);
    for (const arm of [before, after]) for (const key of Object.keys(arm.calls)) arm.calls[key] = 0;
    const oldSamples = [],
      newSamples = [];
    for (let i = 0; i < 10; i++) {
      if (i % 2) {
        newSamples.push(measure(after, changing));
        oldSamples.push(measure(before, changing));
      } else {
        oldSamples.push(measure(before, changing));
        newSamples.push(measure(after, changing));
      }
    }
    assert.deepStrictEqual(after.visible, before.visible);
    assert.equal(before.calls.history, 10000);
    assert.equal(after.calls.history, 0);
    assert.equal(after.calls.menu, 0);
    assert.equal(after.calls.tooltip, changing ? 10000 : 0);
    const median = (samples) => samples.sort((a, b) => a - b)[5];
    report.cases.push({
      events: size,
      changingSensitiveCount: changing,
      updatesPerArm: 10000,
      previous: { medianMsPerUpdate: median(oldSamples), calls: before.calls },
      current: { medianMsPerUpdate: median(newSamples), calls: after.calls },
      matchingVisibleState: true,
    });
  }
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
