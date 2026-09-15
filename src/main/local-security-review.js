'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inventoryProject, inventoryProfile } = require('./agent-inventory');
const { scanStaticDirectory } = require('./static-analysis');
const { importStaticReport } = require('./static-report-import');
const { createSnapshot, validateSnapshot, acceptSnapshot } = require('./inventory-snapshot');
const { compareSnapshots } = require('./inventory-snapshot-diff');
const { summarizeToolCatalog } = require('./inventory-tool-catalog');
const {
  resolveSnapshotSubject,
  checkSnapshotSubject,
  readSnapshotJson,
  writeSnapshotFile,
} = require('./inventory-snapshot-files');

async function capture(adapter, subject, toolsFile) {
  const catalog = toolsFile ? summarizeToolCatalog(await readSnapshotJson(toolsFile)) : null;
  const inventory =
    adapter === 'project'
      ? await inventoryProject(subject.root)
      : await inventoryProfile(adapter, subject.root);
  await checkSnapshotSubject(subject);
  return { inventory, catalog, snapshot: createSnapshot(inventory, subject.rootSha256, catalog) };
}

/** Run a selected local operation. Paths come only from native dialogs in main.
 * @param {object} selection Validated operation and main-owned paths.
 * @returns {Promise<object>} Public report plus private state for exact-content actions.
 * @since v0.15.1
 */
async function review(selection) {
  const { mode, adapter, directory, toolsFile, baselineFile, reportFile, format } = selection;
  const subject = await resolveSnapshotSubject(directory);
  let report, snapshot, baseline;
  if (mode === 'scan') {
    report = await scanStaticDirectory(adapter, subject.root, { toolsFile });
  } else if (mode === 'import') {
    report = await importStaticReport({
      adapter,
      directory: subject.root,
      reportFile,
      baselineFile,
      format,
    });
  } else {
    const current = await capture(adapter, subject, toolsFile);
    snapshot = current.snapshot;
    if (mode === 'compare') {
      baseline = validateSnapshot((await readSnapshotJson(baselineFile, subject)).value);
      report = {
        ...compareSnapshots(baseline, snapshot),
        inventory: current.inventory,
        catalog: current.catalog,
      };
    } else {
      report = { ...current.inventory, catalog: current.catalog };
    }
  }
  await checkSnapshotSubject(subject);
  return { report, subject, selection, snapshot, baseline };
}

/** Revalidate the displayed snapshot before accepting it; save to a separate file.
 * @param {object} retained Main-owned review.
 * @param {string} digest Digest the UI presented for explicit acceptance.
 * @param {string} output Native save-dialog path.
 * @param {function} [authorize] Validate the requesting document at the write boundary.
 * @returns {Promise<object>} Saved accepted snapshot, never an authenticity verdict.
 * @since v0.15.1
 */
async function accept(retained, digest, output, authorize = () => {}) {
  const baseline = retained.baseline ?? retained.snapshot;
  const { adapter, toolsFile } = retained.selection;
  await checkSnapshotSubject(retained.subject);
  const current = await capture(adapter, retained.subject, toolsFile);
  const accepted = acceptSnapshot(baseline, digest, current.snapshot);
  await writeSnapshotFile(output, accepted, retained.subject, authorize);
  return accepted;
}

/** Save the captured unreviewed snapshot without overwriting an existing file.
 * @param {object} retained Main-owned review. @param {string} output Dialog path.
 * @param {function} [authorize] Validate the requesting document at the write boundary.
 * @returns {Promise<void>} Durable write. @since v0.15.1
 */
async function saveSnapshot(retained, output, authorize = () => {}) {
  await checkSnapshotSubject(retained.subject);
  await writeSnapshotFile(output, retained.snapshot, retained.subject, authorize);
}

/** Export only the retained redacted report, with exclusive creation outside the subject.
 * @param {object} retained Main-owned report. @param {string} filename Dialog path.
 * @param {function} [authorize] Validate the requesting document at the write boundary.
 * @returns {Promise<void>} Durable new file; raw renderer objects are never exported.
 * @since v0.15.1
 */
async function exportReport(retained, filename, authorize = () => {}) {
  const data = Buffer.from(JSON.stringify(retained.report, null, 2) + '\n');
  if (data.length > 8 * 1024 * 1024) throw new Error('report-size-limit');
  await checkSnapshotSubject(retained.subject);
  const directory = await fs.promises.realpath(path.dirname(filename));
  const name = path.basename(filename);
  if (!name || name.includes(':') || name.includes('\\')) throw new Error('report-unavailable');
  const target = path.join(directory, name);
  const relative = path.relative(retained.subject.root, target);
  if (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  )
    throw new Error('snapshot-inside-subject');
  let handle,
    created,
    succeeded = false;
  let createdPath = target;
  try {
    authorize();
    handle = await fs.promises.open(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    created = await handle.stat();
    if (!created.isFile()) throw new Error('report-unavailable');
    createdPath = await fs.promises.realpath(target);
    if (createdPath !== target || (await fs.promises.realpath(directory)) !== directory)
      throw new Error('report-unavailable');
    const opened = await fs.promises.lstat(target);
    if (!opened.isFile() || opened.ino !== created.ino || opened.dev !== created.dev)
      throw new Error('report-unavailable');
    authorize();
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    const final = await fs.promises.lstat(target);
    if (
      !final.isFile() ||
      final.ino !== created.ino ||
      final.dev !== created.dev ||
      final.size !== data.length ||
      (await fs.promises.realpath(target)) !== target
    )
      throw new Error('report-unavailable');
    authorize();
    succeeded = true;
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error
    throw new Error(error.code === 'EEXIST' ? 'snapshot-exists' : 'report-unavailable');
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!succeeded && created?.isFile()) {
      try {
        const current = await fs.promises.lstat(createdPath);
        if (
          current.isFile() &&
          current.ino === created.ino &&
          current.dev === created.dev &&
          (await fs.promises.realpath(createdPath)) === createdPath
        )
          await fs.promises.unlink(createdPath);
      } catch (_) {
        /* Preserve the fixed failure code and unrelated files. */
      }
    }
  }
}

module.exports = { review, accept, saveSnapshot, exportReport };
