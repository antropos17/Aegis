import assert from 'node:assert/strict';
import { lstat, readdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/** Independent fixture arithmetic; no production parser or pricing imports.
 * @param {number} count Unique fixture messages. @returns {object} Totals. @since 0.19.2
 */
export function oracle(count) {
  return { inputTokens: count * 100, outputTokens: count * 20, costUsd: count * 0.0006 };
}

/** Check every numeric sample, including restart/replay samples.
 * @param {object} actual Packaged sample. @param {number} count Unique messages.
 * @param {number[]} messagesPerIdentity Parent-owned lifetime counts by slot.
 * @param {number[]} [countsAtLaunch=[0, 0]] Copied counts at successful launch.
 * @returns {void} @since 0.19.2
 */
export function checkSample(actual, count, messagesPerIdentity, countsAtLaunch = [0, 0]) {
  const expected = oracle(count);
  assert.equal(actual.isPackaged, true, 'packaged-required');
  assert.equal(actual.collection, 'ready', 'collection-unavailable');
  assert.equal(actual.inputTokens, expected.inputTokens, 'input-divergence');
  assert.equal(actual.outputTokens, expected.outputTokens, 'output-divergence');
  assert.ok(Number.isFinite(actual.costUsd), 'cost-nonfinite');
  assert.ok(Math.abs(actual.costUsd - expected.costUsd) < 1e-8, 'cost-divergence');
  assert.ok(actual.rowCount <= 3, 'record-growth');
  assert.ok(
    Number.isSafeInteger(actual.ledgerBytes) &&
      actual.ledgerBytes >= 0 &&
      actual.ledgerLimitBytes === 128 * 1024 ** 2 &&
      actual.ledgerBytes <= actual.ledgerLimitBytes,
    'ledger-size-limit',
  );
  const validCounts = (counts) =>
    Array.isArray(counts) &&
    counts.length === 2 &&
    [0, 1].every((slot) => Number.isSafeInteger(counts[slot]) && counts[slot] >= 0);
  assert.ok(
    validCounts(messagesPerIdentity) &&
      validCounts(countsAtLaunch) &&
      messagesPerIdentity[0] + messagesPerIdentity[1] === count &&
      [0, 1].every((slot) => countsAtLaunch[slot] <= messagesPerIdentity[slot]),
    'identity-oracle-invalid',
  );
  assert.ok(
    Array.isArray(actual.identities) &&
      actual.identities.length === 2 &&
      [0, 1].every(
        (slot) => actual.identities.filter((identity) => identity?.slot === slot).length === 1,
      ),
    'identity-slots-invalid',
  );
  for (const identity of actual.identities) {
    const totals = oracle(messagesPerIdentity[identity.slot] - countsAtLaunch[identity.slot]);
    assert.ok(
      Number.isSafeInteger(identity.inputTokens) &&
        identity.inputTokens >= 0 &&
        Number.isSafeInteger(identity.outputTokens) &&
        identity.outputTokens >= 0,
      'identity-totals-invalid',
    );
    if (identity.inputTokens !== totals.inputTokens) throw Error('identity-input-divergence');
    if (identity.outputTokens !== totals.outputTokens) throw Error('identity-output-divergence');
  }
}

/** Reject symbolic links and account for all disposable output before removal.
 * @param {string} root Disposable exact directory. @returns {Promise<number>} Bytes.
 * @since 0.19.2
 */
export async function treeBytes(root) {
  const info = await lstat(root);
  assert.ok(!info.isSymbolicLink(), 'reparse-refused');
  if (!info.isDirectory()) return info.size;
  let bytes = 0;
  for (const name of await readdir(root)) bytes += await treeBytes(path.join(root, name));
  return bytes;
}

/** Cleanup only the validated run-owned disposable directory.
 * @param {string} runRoot Run receipt parent. @param {string} disposable Child directory.
 * @returns {Promise<void>} @since 0.19.2
 */
export async function cleanup(runRoot, disposable) {
  assert.equal(path.resolve(disposable), path.join(path.resolve(runRoot), 'disposable'));
  await checkAncestors(runRoot);
  try {
    await lstat(disposable);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await treeBytes(disposable);
  assert.equal(
    path.resolve(await realpath(disposable)),
    path.join(path.resolve(await realpath(runRoot)), 'disposable'),
    'cleanup-realpath-outside',
  );
  await rm(disposable, { recursive: true, force: false });
}

/** Check every existing ancestor before any directory creation or cleanup.
 * @param {string} target Absolute path. @returns {Promise<void>} @since 0.19.2
 */
export async function checkAncestors(target) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      assert.ok(!info.isSymbolicLink() && info.isDirectory(), 'ancestor-reparse-refused');
      assert.equal(
        path.resolve(await realpath(current)).toLowerCase(),
        path.resolve(current).toLowerCase(),
        'ancestor-realpath-refused',
      );
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

/** Reject incomplete synthetic workload, including a startup-dominated smoke.
 * @param {object} receipt Run measurements. @returns {void} @since 0.19.2
 */
export function checkWorkload(receipt) {
  assert.ok(receipt.uniqueMessages >= 4, 'minimum-workload-missing');
  assert.ok(
    receipt.messagesPerIdentity?.length === 2 &&
      receipt.messagesPerIdentity.every((count) => count >= 2),
    'two-identity-workload-missing',
  );
  assert.ok(
    receipt.identitiesObserved?.length === 2 && receipt.identitiesObserved.every(Boolean),
    'two-identity-accounting-missing',
  );
  assert.equal(receipt.restarts, 2, 'restart-workload-missing');
}

/** A handled rejection drives cancellation; callers await process cleanup.
 * @param {number} timeoutMs Overall deadline. @returns {object} Deadline. @since 0.19.2
 */
export function createDeadline(timeoutMs) {
  let cancelled = false;
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cancelled = true;
      reject(Error('run-timeout'));
    }, timeoutMs);
  });
  promise.catch(() => {});
  return {
    get cancelled() {
      return cancelled;
    },
    guard(operation) {
      return cancelled ? Promise.reject(Error('run-timeout')) : Promise.race([operation, promise]);
    },
    close() {
      clearTimeout(timer);
    },
  };
}

/** Stop an owned Electron process; retain its handle until confirmed exit.
 * @param {object} owner App ownership state. @param {Function} kill Exact-PID tree kill.
 * @param {number} [timeoutMs=10000] Close/exit deadline. @returns {Promise<void>} @since 0.19.2
 */
export async function stopOwned(owner, kill, timeoutMs = 10000) {
  if (owner.stopping) return owner.stopping;
  if (!owner.app) return;
  const current = owner.app;
  const child = current.process();
  const exited = () => child.exitCode !== null || child.signalCode != null;
  owner.stopping = (async () => {
    let timer;
    try {
      if (!exited())
        await Promise.race([
          current.close(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('close-timeout')), timeoutMs);
          }),
        ]);
    } catch {
      /* Forced close below still needs independent exit confirmation. */
    } finally {
      clearTimeout(timer);
    }
    if (!exited()) await kill(child.pid);
    const deadline = performance.now() + timeoutMs;
    while (!exited() && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(exited(), 'process-exit-unconfirmed');
    if (owner.app === current) owner.app = undefined;
  })();
  try {
    await owner.stopping;
  } finally {
    owner.stopping = undefined;
  }
}
