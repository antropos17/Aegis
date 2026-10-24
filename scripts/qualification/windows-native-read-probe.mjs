import { runNativeReadScenario } from './windows-native-read-scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rebootBinding, newRebootOutput } from '../../tools/development/etw-reboot-support.mjs';
import { withRebootHost } from '../../tools/development/etw-reboot-host.mjs';
import {
  compileReadFixture,
  inspectSession,
} from '../../frontend/observatory/tests/etw-failure-support.mjs';
import { nativeReadPassed } from './windows-native-read-oracle.mjs';

const { values } = parseArgs({
  options: {
    'source-sha': { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string' },
    'build-receipt': { type: 'string' },
    config: { type: 'string' },
  },
});
assert(process.platform === 'win32' && process.arch === 'x64');
assert(process.env.RUNNER_ENVIRONMENT === 'github-hosted-hyperv-guest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const key of ['candidate', 'output', 'build-receipt', 'config'])
  assert(path.isAbsolute(values[key] ?? ''));
const out = values.output,
  candidate = values.candidate;
const relative = path.relative(candidate, out);
assert(
  relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
  'Probe output must be outside candidate',
);
const binding = () =>
  rebootBinding(root, candidate, values['source-sha'], values['build-receipt'], values.config);
const initial = binding();
newRebootOutput(out, root);
for (const dir of ['fixture', 'home']) fs.mkdirSync(path.join(out, dir));
const file = path.join(out, 'fixture/.env');
const canary = 'AEGIS_OBJECT_CONTENT_' + crypto.randomBytes(20).toString('hex');
fs.writeFileSync(file, canary.padEnd(4096, '.'));
const env = {
  ...process.env,
  TEMP: path.join(out, 'temp'),
  TMP: path.join(out, 'temp'),
  USERPROFILE: path.join(out, 'home'),
  HOME: path.join(out, 'home'),
};
for (const key of Object.keys(env))
  if (/TOKEN|PASSWORD|SECRET|ELECTRON_RUN_AS_NODE|NODE_OPTIONS/.test(key)) delete env[key];
const helper = path.join(candidate, 'resources/etw-file/EtwFile.exe');
const r = {
  schema: 'aegis-cloud-object-read/1',
  status: 'FAIL',
  ...initial,
  startedAt: new Date().toISOString(),
  fixtureOnly: true,
  realAgent: false,
  syntheticActor: 'Maintained native reader discovered as Aider by the actual scanner',
  productionAdmission: false,
  actualAccessPathObserved: false,
  reads: [],
};

try {
  const before = await inspectSession(helper, out, 'before-object', env);
  assert(before.status === 4201 && before.present === false);
  r.before = before;
  const fixtureExe = compileReadFixture(root, out, env);
  r.fixtureSourceSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'tests/fixtures/etw-read-process.cs')))
    .digest('hex');
  const execution = await withRebootHost(helper, out, env, (hostEnv) =>
    runNativeReadScenario({ fixtureExe, file, out, env: hostEnv, r, canary, candidate, helper }),
  );
  r.host = execution.host;
  assert(!execution.failure, execution.failure);
  assert(
    r.host.exitCode === 0 && r.host.liveChildren === 0,
    'Qualification host closure unconfirmed',
  );
  assert.deepEqual(binding(), initial, 'Source/package/build inputs changed');
  r.bindingUnchanged = true;
  r.after = await inspectSession(helper, out, 'after-object', env);
  assert(r.after.status === 4201 && r.after.present === false);
  r.status = 'PASS';
  assert(nativeReadPassed(r), 'Complete native-read acceptance contract failed');
} catch (error) {
  r.status = 'FAIL';
  r.failure = error.message;
  process.exitCode = 1;
} finally {
  r.completedAt = new Date().toISOString();
  const json = JSON.stringify(r, null, 2) + '\n';
  assert(Buffer.byteLength(json) <= 262144, 'Native-read private receipt budget');
  fs.writeFileSync(path.join(out, 'receipt.json'), json, { flag: 'wx' });
  console.log(JSON.stringify({ status: r.status, failure: r.failure, output: out }));
}
