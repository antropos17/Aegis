import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runFailure } from './etw-failure-scenario.mjs';
import { runScenario } from './etw-scenario.mjs';
import { compileReadFixture } from './etw-failure-support.mjs';
import { etwFailuresPassed } from '../../../tools/development/etw-failure-contract.mjs';
import { etwDualPassed } from '../../../tools/development/etw-dual-contract.mjs';
import { etwTotalPassed } from '../../../tools/development/etw-total-contract.mjs';
import { etwGroupPassed } from '../../../tools/development/etw-group-contract.mjs';

const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    output: { type: 'string' },
    dual: { type: 'boolean', default: false },
    total: { type: 'boolean', default: false },
    group: { type: 'boolean', default: false },
  },
});
assert(process.platform === 'win32' && process.arch === 'x64');
assert(path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''));
const out = path.resolve(values.output);
fs.mkdirSync(out);
fs.mkdirSync(path.join(out, 'temp'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const total = values.total || values.group,
  dual = values.dual || total;
const r = {
  status: 'FAIL',
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  productionAdmission: false,
  cases: {},
  scope: values.group
    ? 'Five broker-plus-helper loss cases with surviving main plus seventeen earlier cases'
    : total
      ? 'Six all-three-helper loss cases plus eleven existing packaged regressions'
      : dual
        ? 'Four collector/guard loss boundaries plus seven existing packaged regressions'
        : 'Five failure boundaries plus collector-crash and fresh-capture attribution regression',
  simultaneousGuardCollectorLoss: dual ? 'four planned local diagnostic captures' : 'not-run',
  allThreeElevatedPeersLost: total
    ? 'six planned local diagnostic captures; original normal broker survives'
    : 'not-run',
  lossOfBrokerAndAllElevatedPeers: values.group
    ? 'five planned main-custody captures'
    : 'not-qualified by this profile',
  lossOfMainAndAllNativePeers: 'not-qualified; requires protected durable recovery authority',
  protectedInstallationSleepWakeAndPathAdmission: 'not-qualified',
};
try {
  for (const mode of [
    ...(values.group
      ? [
          'group-before-start',
          'group-before-arm',
          'group-broker-first',
          'group-triple-first',
          'group-access-denied',
        ]
      : []),
    ...(total
      ? [
          'triple-before-start',
          'triple-before-arm',
          'triple-collector-first',
          'triple-guard-first',
          'triple-fallback-first',
          'triple-access-denied',
        ]
      : []),
    ...(dual
      ? ['dual-before-start', 'dual-before-arm', 'dual-guard-first', 'dual-collector-first']
      : []),
    'collector-before-start',
    'collector-before-arm',
    'guard-exit',
    'broker-exit',
    'app-exit',
  ]) {
    r.cases[mode] = await runFailure({
      executable: values.executable,
      out: path.join(out, mode),
      mode,
    });
    assert.equal(r.cases[mode].status, 'PASS', 'Fault case incomplete; no next planned capture');
  }
  const fixtureExe = compileReadFixture(root, out, {
    ...process.env,
    TEMP: path.join(out, 'temp'),
    TMP: path.join(out, 'temp'),
  });
  const crash = await runScenario({
    executable: values.executable,
    fixtureExe,
    out: path.join(out, 'collector-after-ready'),
    fault: true,
  });
  assert.equal(crash.status, 'PASS');
  const normal = await runScenario({
    executable: values.executable,
    fixtureExe,
    out: path.join(out, 'normal'),
    fault: false,
  });
  assert.equal(normal.status, 'PASS');
  r.regression = {
    status: 'PASS',
    productionAdmission: false,
    crash,
    normal,
    newSessionAfterRecovery: crash.summary.sessionId !== normal.summary.sessionId,
  };
  r.status = 'PASS';
  assert(etwFailuresPassed(r), 'Incomplete boundary qualification');
  if (dual) assert(etwDualPassed(r), 'Incomplete dual-loss qualification');
  if (total) assert(etwTotalPassed(r), 'Incomplete all-helper-loss qualification');
  if (values.group) assert(etwGroupPassed(r), 'Incomplete main-custody group qualification');
} catch (e) {
  r.status = 'FAIL';
  r.failure = e.message;
  process.exitCode = 1;
} finally {
  r.completedAt = new Date().toISOString();
  const json = JSON.stringify(r, null, 2);
  assert(Buffer.byteLength(json) <= 262144);
  fs.writeFileSync(path.join(out, 'receipt.json'), json, { flag: 'wx' });
  console.log(JSON.stringify({ status: r.status, failure: r.failure, output: out }));
}
