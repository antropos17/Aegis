import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createVmJournal, readVmJournal } from './vm-journal.mjs';
import { createVmSession } from './vm-session.mjs';
import { encodeVmFrame } from './vm-wire.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Run a fixed in-memory backend with the actual durable developer journal.
 * No VM or process is created. The credential never leaves this test context.
 * @returns {Promise<object>} Explicitly synthetic evidence, never launch authority.
 * @since v0.17.0
 */
export async function collectVmLifecycle() {
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'aegis-vm-lifecycle-'));
  const journalPath = path.join(scratch, 'owned.jsonl');
  const key = randomBytes(32);
  const identity = {
    sessionId: randomBytes(16).toString('hex'),
    vmId: randomUUID(),
    epoch: randomBytes(16).toString('hex'),
  };
  const pins = Object.fromEntries(
    ['config', 'image', 'runtime', 'principal', 'job'].map((name) => [
      `${name}Sha256`,
      sha256(`synthetic-${name}`),
    ]),
  );
  let state = 'off';
  let releases = 0;
  let journal, session, receipt, failure;
  try {
    journal = createVmJournal(journalPath, identity);
    const backend = {
      kind: 'synthetic-vm-fixture',
      async inspect() {
        return {
          vmId: identity.vmId,
          epoch: identity.epoch,
          state,
          configSha256: pins.configSha256,
          pendingOperations: 0,
        };
      },
      async start() {
        state = 'running';
      },
      async receive(_, { challenge }) {
        return encodeVmFrame(key, {
          version: 1,
          ...identity,
          sequence: 1,
          challenge,
          phase: 'initialized',
          imageSha256: pins.imageSha256,
          runtimeSha256: pins.runtimeSha256,
          principalSha256: pins.principalSha256,
          jobSha256: pins.jobSha256,
        });
      },
      async release() {
        releases++;
      },
      async stop() {
        state = 'off';
      },
    };
    session = createVmSession({ backend, identity, pins, journal, key });
    const prepared = await session.prepare();
    const released = await session.release();
    const stopped = await session.stop();
    if (stopped.state !== 'stopped' || state !== 'off' || releases !== 1)
      throw new Error('vm-lifecycle-incomplete');
    journal.close();
    const recovered = readVmJournal(journalPath, identity);
    const journalBytes = fs.readFileSync(journalPath);
    const sourceSha256 = Object.fromEntries(
      ['qualify-vm-lifecycle', 'vm-contract', 'vm-wire', 'vm-session', 'vm-journal'].map((name) => [
        name,
        sha256(fs.readFileSync(fileURLToPath(new URL(`./${name}.mjs`, import.meta.url)))),
      ]),
    );
    receipt = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      sourceSha256,
      summary: {
        scope: 'synthetic-vm-lifecycle',
        effectsRun: false,
        launchAllowed: false,
        nativeContainmentQualified: false,
        states: [prepared.state, released.state, stopped.state],
        fixtureReleases: releases,
        recoveryLaunchAllowed: recovered.launchAllowed,
      },
      journalSha256: sha256(journalBytes),
      journalRows: journalBytes
        .toString('utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    };
  } catch (error) {
    failure = error;
  }
  try {
    if (session && session.snapshot().state !== 'stopped') await session.stop();
    key.fill(0);
    journal?.close();
    if (path.dirname(scratch) !== parent || fs.lstatSync(scratch).isSymbolicLink())
      throw new Error('vm-lifecycle-cleanup-unsafe');
    if (fs.existsSync(journalPath)) {
      if (fs.lstatSync(journalPath).isSymbolicLink())
        throw new Error('vm-lifecycle-cleanup-unsafe');
      fs.unlinkSync(journalPath);
    }
    fs.rmdirSync(scratch);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--receipt')
      throw new Error('vm-lifecycle-receipt-required');
    const selected = process.argv[3];
    if (!path.isAbsolute(selected) || path.extname(selected) !== '.json' || fs.existsSync(selected))
      throw new Error('vm-lifecycle-receipt-invalid');
    const receipt = await collectVmLifecycle();
    fs.writeFileSync(selected, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify(receipt.summary) + '\n');
  } catch {
    process.stderr.write('vm-lifecycle-unavailable\n');
    process.exitCode = 2;
  }
}
