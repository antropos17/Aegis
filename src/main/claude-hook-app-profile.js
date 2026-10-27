'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { scanJson } = require('./claude-hook-json');
const { qualifyAssets } = require('./claude-hook-windows-io-wire');
const { readActionFile, parseActionJson, validActionPolicy } = require('./action-policy');

/** Load only the app's prepared helper descriptor; no renderer-selected assets.
 * @param {string} root Prepared application asset directory.
 * @returns {Promise<object|null>} Private assets or unavailable. @since v0.21.0 */
async function loadProfileAssets(root) {
  try {
    const file = path.join(root, 'assets.json');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.schemaVersion !== 2 || Object.keys(value).length !== 6) return null;
    const assets = { ...value };
    delete assets.schemaVersion;
    const selected = {
      ...assets,
      hostRoot: path.win32.normalize(path.join(root, 'host')),
      runtimeRoot: path.win32.normalize(path.join(root, 'runtime')),
      portable: true,
    };
    qualifyAssets(selected);
    return selected;
  } catch {
    return null;
  }
}

async function ordinary(file, allowMissing = false) {
  let cursor = path.resolve(file);
  for (;;) {
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('profile-unavailable');
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- Private filesystem paths are deliberately discarded.
      if (!allowMissing || error.code !== 'ENOENT') throw Error('profile-unavailable');
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

/** Prepare one bounded app-owned draft; never discover or overwrite a personal profile.
 * @param {string} directory Fixed private application directory. @param {boolean} existingOnly Refuse a missing target during removal.
 * @returns {Promise<{targetPath:string,backupRoot:string}>} Private native selections. @since v0.21.0 */
async function prepareProfile(directory, existingOnly = false) {
  await ordinary(directory, !existingOnly);
  if (!existingOnly) await fs.mkdir(directory, { recursive: true });
  await ordinary(directory);
  const targetPath = path.join(directory, 'settings.json');
  let handle;
  try {
    if (existingOnly) {
      const present = await profilePresence(targetPath);
      if (!present.reviewable) throw Error('profile-unavailable');
    } else {
      handle = await fs.open(targetPath, 'wx', 0o600);
      await handle.writeFile('{}\n');
    }
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Private filesystem paths are deliberately discarded.
    if (error.code !== 'EEXIST') throw Error('profile-unavailable');
  } finally {
    await handle?.close();
  }
  const backups = path.join(directory, 'backups');
  await fs.mkdir(backups, { recursive: true });
  await ordinary(backups);
  if ((await fs.readdir(backups)).length >= 4) throw Error('backup-retention-limit');
  return {
    targetPath: path.win32.normalize(targetPath),
    backupRoot: path.win32.normalize(path.join(backups, randomUUID())),
  };
}

/** Read only bounded file metadata for advisory profile controls; creates no files.
 * @param {string} target Fixed app-owned target. @returns {Promise<object>} Private metadata. @since v0.21.0 */
async function profilePresence(target) {
  try {
    await ordinary(path.dirname(target));
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      return { present: false, reviewable: false, mark: null };
    return {
      present: true,
      reviewable: stat.size <= 262144,
      mark: [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':'),
    };
  } catch {
    return { present: false, reviewable: false, mark: null };
  }
}

function quote(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 4096 ||
    /["'`$%!?|<>^\p{Cc}]/u.test(value)
  )
    throw Error('unsupported-path');
  return '"' + value.replaceAll('\\', '/') + '"';
}

/** Construct the fixed hook route with quoted paths; literal ampersands stay inside the quotes.
 * Quote, expansion, control and other shell-operator syntax remains unsupported.
 * @param {string} executable Application executable. @param {string} appPath Application source/package.
 * @param {string} policyPath Native-dialog selected policy.
 * @returns {string} Private command shown only in native review. @since v0.21.0 */
function profileCommand(executable, appPath, policyPath) {
  return `${quote(executable)} ${quote(appPath)} --action-policy-hook ${quote(policyPath)}`;
}

/** Validate the selected existing policy without retaining or publishing its contents.
 * @param {string} file Native-dialog selected policy.
 * @returns {Promise<boolean>} Valid existing schema-1 policy. @since v0.21.0 */
async function checkProfilePolicy(file) {
  let bytes;
  try {
    bytes = await readActionFile(file);
    return validActionPolicy(parseActionJson(bytes));
  } catch {
    return false;
  } finally {
    bytes?.fill(0);
  }
}

/** Present only exact changed fragments privately, with no unrelated configuration context.
 * @param {object} review Real writer review. @param {string} target Fixed target.
 * @returns {string} Bounded native dialog text. @since v0.21.0 */
function profileReviewText(review, target, observedRemoval = false) {
  const fragments = review.changedFragments.map(
    (item) =>
      `Lines ${item.before.start.line}:${item.before.start.column}–${item.before.end.line}:${item.before.end.column}\nRemove: ${item.removed || '(empty)'}\nInsert: ${item.inserted || '(empty)'}`,
  );
  const explanation = observedRemoval
    ? 'This is a fresh authorization to remove only the recognized current AEGIS Bash hook. Unrelated settings remain unchanged. No historical ownership or rollback is inferred.'
    : 'This configures the Bash hook only; blocking is not verified.';
  const detail = `AEGIS-owned separate Claude settings profile:\n${target}\nPreToolUse · Bash\n\n${fragments.join('\n\n')}\n\nA private backup is retained before writing. ${explanation} The profile is used only by launches explicitly selecting it with --settings.`;
  if (Buffer.byteLength(detail) > 8192) throw Error('preview-too-large');
  return detail;
}

/** Bind the draft-only scope check to the exact already prepared bytes.
 * @param {object} review Private writer plan. @param {Buffer} bytes Fresh guarded read.
 * @returns {'empty'|'configured'|'changed'} Fixed eligibility. @since v0.21.0 */
function profileDraftEligibility(review, bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== review.beforeSha256) return 'changed';
  const source = scanJson(bytes);
  try {
    const selected = source.root.members.get('hooks')?.members.get('PreToolUse');
    return selected?.items.length > 0 ? 'configured' : 'empty';
  } finally {
    source.bytes.fill(0);
  }
}

module.exports = {
  loadProfileAssets,
  prepareProfile,
  profilePresence,
  profileCommand,
  checkProfilePolicy,
  profileReviewText,
  profileDraftEligibility,
};
