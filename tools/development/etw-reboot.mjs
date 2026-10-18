import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { boundedCommand } from './bounded-command.mjs';
import { GUI_EXECUTABLE } from '../../scripts/produce-protected-gui-manifest.mjs';
import {
  rebootPrepared,
  rebootBoundaryObserved,
  rebootPassed,
  rebootHostClosed,
} from './etw-reboot-contract.mjs';
import {
  rebootHash,
  readRebootReceipt,
  newRebootOutput,
  observeWindowsBoot,
  rebootBinding,
} from './etw-reboot-support.mjs';
import { withRebootHost } from './etw-reboot-host.mjs';

// This driver never restarts Windows. The user controls the disruptive boundary.
// No service, scheduled task, autostart entry or stored elevation is introduced.
const { values } = parseArgs({
  options: {
    phase: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string' },
    prepared: { type: 'string' },
    'source-sha': { type: 'string' },
  },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
assert(['prepare', 'resume', 'cancel'].includes(values.phase), 'Select prepare, resume or cancel');
assert(path.isAbsolute(values.candidate ?? '') && path.isAbsolute(values.output ?? ''));
assert(
  (values.phase !== 'prepare') === path.isAbsolute(values.prepared ?? ''),
  'Only resume/cancel require --prepared',
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = path.resolve(values.candidate),
  output = path.resolve(values.output);
const candidateRelative = path.relative(candidate, output);
assert(
  candidateRelative.startsWith('..' + path.sep) || path.isAbsolute(candidateRelative),
  'Output must be outside candidate',
);
const initial = rebootBinding(root, candidate, values['source-sha']);
newRebootOutput(output, root);
const env = { ...process.env, TEMP: path.join(output, 'temp'), TMP: path.join(output, 'temp') };
delete env.ELECTRON_RUN_AS_NODE;
const r = {
  schemaVersion: 1,
  status: 'FAIL',
  phase: values.phase,
  productionAdmission: false,
  startedAt: new Date().toISOString(),
  ...initial,
  commands: [],
};
const free = () =>
  Object.fromEntries(
    [...new Set([path.parse(output).root, process.env.SystemDrive + '\\'])].map((drive) => {
      const stat = fs.statfsSync(drive);
      return [drive, stat.bavail * stat.bsize];
    }),
  );
let prior;
try {
  r.freeBefore = free();
  assert(
    Object.values(r.freeBefore).every((bytes) => bytes >= 3 * 1024 ** 3),
    'Insufficient free space',
  );
  r.boot = observeWindowsBoot(env);
  if (values.phase !== 'prepare') {
    const prepared = readRebootReceipt(values.prepared);
    prior = prepared.value;
    r.preparationSha256 = rebootHash(prepared.bytes);
    assert(rebootPrepared(prior), 'Incomplete preparation receipt');
    assert.equal(prior.sourceHead, initial.sourceHead, 'Source revision changed');
    assert.equal(prior.packageManifestSha256, initial.packageManifestSha256, 'Package changed');
    if (values.phase === 'resume')
      assert(
        rebootBoundaryObserved(prior, r.boot),
        'A later Windows boot after preparation is required; no UAC or capture was started',
      );
    else
      assert.equal(
        Date.parse(prior.boot.lastBootUtc),
        Date.parse(r.boot.lastBootUtc),
        'Cancellation is only for the original boot',
      );
  }
  const helper = path.join(candidate, 'resources/etw-file/EtwFile.exe');
  const execution = await withRebootHost(helper, output, env, async (hostEnv) => {
    const result = await boundedCommand(
      process.execPath,
      [
        path.join(root, 'frontend/observatory/tests/etw-reboot-scenario.mjs'),
        '--phase',
        values.phase,
        '--executable',
        path.join(candidate, GUI_EXECUTABLE),
        '--output',
        path.join(output, 'scenario'),
      ],
      { cwd: root, env: hostEnv, log: path.join(output, 'scenario.log'), timeoutMs: 600000 },
    );
    r.commands.push(result);
    assert(
      result.code === 0 && !result.error && !result.reason,
      'Packaged phase failed; inspect retained private evidence',
    );
    return readRebootReceipt(path.join(output, 'scenario/receipt.json')).value;
  });
  r.host = execution.host;
  r.scenario = execution.result;
  assert(!execution.failure, execution.failure);
  assert.deepEqual(
    rebootBinding(root, candidate, values['source-sha']),
    initial,
    'Source/package changed during phase',
  );
  r.completedAt = new Date().toISOString();
  if (values.phase === 'prepare') {
    r.status = 'PREPARED';
    assert(rebootPrepared(r), 'Preparation incomplete');
  } else if (values.phase === 'resume') {
    r.status = 'PASS';
    assert(rebootPassed(prior, r), 'Reboot qualification incomplete');
  } else {
    r.status = 'CANCELLED';
    assert(
      r.scenario?.status === 'CANCELLED' &&
        rebootHostClosed(r.host, [70]) &&
        r.scenario.recovery?.previousJournalDigest === prior.scenario.reserved.journalDigest,
      'Cancellation incomplete',
    );
  }
} catch (error) {
  r.status = 'FAIL';
  r.failure = error.message;
  process.exitCode = 1;
} finally {
  r.completedAt = new Date().toISOString();
  r.freeAfter = free();
  const bytes = JSON.stringify(r, null, 2) + '\n';
  assert(Buffer.byteLength(bytes) <= 262144, 'Private receipt exceeded budget');
  fs.writeFileSync(path.join(output, 'receipt.json'), bytes, { flag: 'wx' });
  console.log(JSON.stringify({ status: r.status, phase: r.phase, failure: r.failure, output }));
}
