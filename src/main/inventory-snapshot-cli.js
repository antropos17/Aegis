'use strict';

const { inventoryProject, inventoryProfile } = require('./agent-inventory');
const { getInventoryProfile } = require('./inventory-profiles');
const { createSnapshot, validateSnapshot, acceptSnapshot } = require('./inventory-snapshot');
const { compareSnapshots } = require('./inventory-snapshot-diff');
const { summarizeToolCatalog } = require('./inventory-tool-catalog');
const {
  resolveSnapshotSubject,
  checkSnapshotSubject,
  readSnapshotJson,
  writeSnapshotFile,
} = require('./inventory-snapshot-files');
const FLAGS = ['--inventory-snapshot-json', '--inventory-accept-json', '--inventory-diff-json'];
const ERRORS = new Set([
  'snapshot-invalid',
  'snapshot-size-limit',
  'snapshot-unavailable',
  'snapshot-inside-subject',
  'snapshot-exists',
  'snapshot-digest-mismatch',
  'snapshot-already-accepted',
  'snapshot-incomplete',
  'snapshot-changed-since-review',
  'tool-catalog-invalid',
  'tool-catalog-unavailable',
  'unsupported-profile',
]);

async function capture(adapter, subject, toolsFile) {
  getInventoryProfile(adapter);
  let catalog = null;
  if (toolsFile) {
    try {
      catalog = summarizeToolCatalog(await readSnapshotJson(toolsFile));
    } catch (error) {
      // Discard parser/filesystem causes at the report's privacy boundary.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        error.message === 'snapshot-unavailable'
          ? 'tool-catalog-unavailable'
          : 'tool-catalog-invalid',
      );
    }
  }
  const inventory =
    adapter === 'project'
      ? await inventoryProject(subject.root)
      : await inventoryProfile(adapter, subject.root);
  await checkSnapshotSubject(subject);
  return createSnapshot(inventory, subject.rootSha256, catalog);
}

/**
 * Handle explicit snapshot/save, exact-digest acceptance, and fresh comparison commands.
 * @param {string[]} args CLI arguments including the flag.
 * @param {(value: string) => void} write JSON output sink.
 * @returns {Promise<number|null>} 0 unchanged accepted content/successful write, 2 review/partial, 1 error.
 * @since v0.15.1
 */
async function handleSnapshotCLI(args, write) {
  const flag = args[0];
  if (!FLAGS.includes(flag)) return null;
  const count = flag === '--inventory-accept-json' ? 5 : 4;
  const hasTools = args.length === count + 2 && args[count] === '--tools-file';
  const emit = (value) => write(JSON.stringify({ assessment: 'not-performed', ...value }, null, 2));
  if (
    (!hasTools && args.length !== count) ||
    args.slice(1, count).some((arg) => !arg || arg.startsWith('--')) ||
    (hasTools && (!args[count + 1] || args[count + 1].startsWith('--')))
  ) {
    emit({ error: 'expected-snapshot-arguments', reviewRequired: true });
    return 1;
  }
  try {
    const toolsFile = hasTools ? args[count + 1] : null;
    const directory = flag === '--inventory-snapshot-json' ? args[2] : args[3];
    const subject = await resolveSnapshotSubject(directory);
    if (flag === '--inventory-snapshot-json') {
      const snapshot = await capture(args[1], subject, toolsFile);
      await writeSnapshotFile(args[3], snapshot, subject);
      emit({
        mode: 'inventory-snapshot-saved',
        digest: snapshot.digest,
        state: snapshot.state,
        complete: snapshot.body.complete,
        issueCount: snapshot.body.issueCount,
        reviewRequired: true,
      });
      return snapshot.body.complete ? 0 : 2;
    }
    const baseline = validateSnapshot((await readSnapshotJson(args[1], subject)).value);
    if (flag === '--inventory-accept-json' && baseline.digest !== args[2])
      throw new Error('snapshot-digest-mismatch');
    const adapter = flag === '--inventory-accept-json' ? baseline.body.subject.adapter : args[2];
    const current = await capture(adapter, subject, toolsFile);
    if (flag === '--inventory-diff-json') {
      const comparison = compareSnapshots(baseline, current);
      emit(comparison);
      return comparison.reviewRequired ? 2 : 0;
    }
    const accepted = acceptSnapshot(baseline, args[2], current);
    await writeSnapshotFile(args[4], accepted, subject);
    emit({
      mode: 'inventory-snapshot-accepted',
      digest: accepted.digest,
      state: accepted.state,
      complete: true,
      reviewRequired: false,
      reviewedDigest: baseline.digest,
    });
    return 0;
  } catch (error) {
    emit({
      error: ERRORS.has(error.message) ? error.message : 'snapshot-unavailable',
      reviewRequired: true,
    });
    return 1;
  }
}

module.exports = { handleSnapshotCLI, FLAGS };
