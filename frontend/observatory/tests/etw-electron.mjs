import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { runScenario } from './etw-scenario.mjs';
import { etwRecoveryPassed } from '../../../tools/development/etw-package.mjs';

const { values } = parseArgs({
  options: { executable: { type: 'string' }, output: { type: 'string' } },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
assert(path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''));
const out = path.resolve(values.output);
fs.mkdirSync(out);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = { ...process.env, TEMP: path.join(out, 'temp'), TMP: path.join(out, 'temp') };
fs.mkdirSync(env.TEMP);
const receipt = {
  status: 'FAIL',
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  productionAdmission: false,
  scope:
    'two planned live captures; held issuer/FILETIME proof, abrupt collector exit, independent guard, fresh capture',
  pidTidReuse: 'modeled regression only; real rapid-exit fixture is separate',
  pathConfirmation: 'not-qualified',
  preArmAndSimultaneousCollectorGuardCrash: 'not-qualified',
};
try {
  const fixtureExe = path.join(out, 'aider.exe');
  execFileSync(
    path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/warnaserror+',
      '/out:' + fixtureExe,
      path.join(root, 'tests/fixtures/etw-read-process.cs'),
    ],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
  );
  receipt.crash = await runScenario({
    executable: values.executable,
    fixtureExe,
    out: path.join(out, 'crash'),
    fault: true,
  });
  assert.equal(receipt.crash.status, 'PASS', 'Collector-crash case incomplete; no new UAC retry');
  receipt.normal = await runScenario({
    executable: values.executable,
    fixtureExe,
    out: path.join(out, 'normal'),
    fault: false,
  });
  assert.equal(receipt.normal.status, 'PASS');
  receipt.newSessionAfterRecovery =
    receipt.normal.summary.sessionId !== receipt.crash.summary.sessionId;
  receipt.status = 'PASS';
  assert(etwRecoveryPassed(receipt), 'Incomplete attribution/recovery evidence');
} catch (error) {
  receipt.status = 'FAIL';
  receipt.failure = error.message;
  process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  const data = JSON.stringify(receipt, null, 2);
  assert(Buffer.byteLength(data) <= 262144, 'ETW root receipt exceeded its budget');
  fs.writeFileSync(path.join(out, 'receipt.json'), data, { flag: 'wx' });
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, output: out }));
}
