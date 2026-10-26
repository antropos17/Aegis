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
    if ((await fs.stat(file)).size > 65536) return null;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.schemaVersion !== 1 || Object.keys(value).length !== 7) return null;
    const assets = { ...value };
    delete assets.schemaVersion;
    const selected = { ...assets, hostRoot: path.win32.normalize(path.join(root, 'host')) };
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
 * @param {string} directory Fixed private application directory.
 * @returns {Promise<{targetPath:string,backupRoot:string}>} Private native selections. @since v0.21.0 */
async function prepareProfile(directory) {
  await ordinary(directory, true);
  await fs.mkdir(directory, { recursive: true });
  await ordinary(directory);
  const targetPath = path.join(directory, 'settings.json');
  let handle;
  try {
    handle = await fs.open(targetPath, 'wx', 0o600);
    await handle.writeFile('{}\n');
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

function quote(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 4096 ||
    /["'`$%!?&|<>^\p{Cc}]/u.test(value)
  )
    throw Error('unsupported-path');
  return '"' + value.replaceAll('\\', '/') + '"';
}

/** Construct the fixed AEGIS hook route, refusing shell metacharacters in selections.
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
function profileReviewText(review, target) {
  const fragments = review.changedFragments.map(
    (item) =>
      `Lines ${item.before.start.line}:${item.before.start.column}–${item.before.end.line}:${item.before.end.column}\nRemove: ${item.removed || '(empty)'}\nInsert: ${item.inserted || '(empty)'}`,
  );
  const detail = `AEGIS-owned separate Claude settings profile:\n${target}\nPreToolUse · Bash\n\n${fragments.join('\n\n')}\n\nA private backup is retained before writing. This configures the Bash hook only; blocking is not verified. The profile is used only by launches explicitly selecting it with --settings.`;
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
  profileCommand,
  checkProfilePolicy,
  profileReviewText,
  profileDraftEligibility,
};
