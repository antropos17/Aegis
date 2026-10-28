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
  // Native transaction admission uses an uppercase drive prefix. Drive-letter
  // casing does not change the selected Windows volume or its pinned identity.
  const nativePath = (value) =>
    path.win32.normalize(value).replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase());
  return {
    targetPath: nativePath(targetPath),
    backupRoot: nativePath(path.join(backups, randomUUID())),
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
 * @param {string} [nativePath] Canonical private native storage, absent for legacy routes.
 * @returns {string} Private command shown only in native review. @since v0.21.0 */
function profileCommand(executable, appPath, policyPath, nativePath) {
  return `${quote(executable)} ${quote(appPath)} --action-policy-hook ${quote(policyPath)}${nativeArgument(nativePath)}`;
}

function nativeArgument(nativePath) {
  if (nativePath === undefined) return '';
  quote(nativePath); // Retain the existing shell metacharacter/path rejection.
  if (nativePath.length > 2048 || path.resolve(nativePath) !== nativePath)
    throw Error('unsupported-path');
  // Single quotes retain canonical Windows backslashes for the native switch.
  return ` '--user-data-dir=${nativePath}'`;
}

/** Derive one private native directory from a server-issued install token.
 * @param {string} target Fixed profile settings path. @param {string} token Server token.
 * @returns {string} Canonical path within the fixed profile parent. @since v0.21.0 */
function nativeProfilePath(target, token) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw Error('unsupported-path');
  const selected = path.resolve(path.dirname(target), `native-${token}`);
  nativeArgument(selected);
  return selected;
}

/** Recognize only exact current or legacy commands for the fixed owned profile.
 * Recognition supplies no historical ownership of existing directory contents.
 * @param {string} command Profile command. @param {object} selection Fixed app paths.
 * @returns {{policyPath:string,nativePath?:string}|null} Exact binding or refusal. @since v0.21.0 */
function parseProfileCommand(command, { target, executable, appPath }) {
  if (typeof command !== 'string') return null;
  const match =
    /^"[^"]+" "[^"]+" --action-policy-hook "([^"]+)"(?: '--user-data-dir=([^']+)')?$/.exec(command);
  if (!match) return null;
  try {
    const nativePath = match[2];
    if (nativePath) {
      const token = /^native-([0-9a-f]{32})$/.exec(path.basename(nativePath))?.[1];
      if (!token || nativeProfilePath(target, token) !== nativePath) return null;
    }
    return profileCommand(executable, appPath, match[1], nativePath) === command
      ? { policyPath: match[1], ...(nativePath ? { nativePath } : {}) }
      : null;
  } catch {
    return null;
  }
}

/** Inspect only an ordinary canonical native directory; never create or adopt it.
 * @param {string} directory Selected native directory. @returns {Promise<string>} Identity mark.
 * @since v0.21.0 */
async function nativeProfileIdentity(directory) {
  await ordinary(directory);
  if ((await fs.realpath(directory)) !== directory) throw Error('profile-unavailable');
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n)
    throw Error('profile-unavailable');
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

/** Reserve a fresh native directory only after explicit install confirmation.
 * Created directories are retained on every outcome; no path-based rollback occurs.
 * @param {string} directory Previewed native directory. @returns {Promise<string>} Identity mark.
 * @since v0.21.0 */
async function reserveNativeProfile(directory) {
  await ordinary(path.dirname(directory));
  await fs.mkdir(directory); // Exclusive: EEXIST, links and prior data are never adopted.
  return nativeProfileIdentity(directory);
}

/** Construct the fixed after-event hook using the same trusted selected paths.
 * @param {string} executable Application executable. @param {string} appPath Application source/package.
 * @param {string} policyPath Native-dialog selected policy.
 * @param {string} [nativePath] Canonical private native storage, absent for legacy routes.
 * @returns {string} Private command shown only in native review. @since v0.21.0 */
function profileAfterCommandLegacy(executable, appPath, policyPath, nativePath) {
  return `${quote(executable)} ${quote(appPath)} --action-policy-after-hook ${quote(policyPath)}${nativeArgument(nativePath)}`;
}

/** Construct the supported after-event route with stdout redirection.
 * @param {string} executable Application executable. @param {string} appPath Application source/package.
 * @param {string} policyPath Native-dialog selected policy.
 * @param {string} [nativePath] Canonical private native storage, absent for legacy routes.
 * @returns {string} Exact Git Bash command. @since v0.21.0 */
function profileAfterCommand(executable, appPath, policyPath, nativePath) {
  return `${profileAfterCommandLegacy(executable, appPath, policyPath, nativePath)} > /dev/null`;
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
  const multipleEvents = Array.isArray(review.eventNames) && review.eventNames.length === 3;
  const explanation = observedRemoval
    ? `This is a fresh authorization to remove only the recognized current AEGIS Bash ${multipleEvents ? 'hooks' : 'hook'}. Unrelated settings remain unchanged. No historical ownership or rollback is inferred.`
    : multipleEvents
      ? 'For the supported Git Bash route, after-hook stdout is discarded. If redirection succeeds, stderr and exit status remain available; redirection or hook failure can leave delivery unknown. Blocking is not verified.'
      : 'This configures the Bash hook only; blocking is not verified.';
  const events = multipleEvents
    ? 'PreToolUse / PostToolUse / PostToolUseFailure · Bash'
    : 'PreToolUse · Bash';
  const detail = `AEGIS-owned separate Claude settings profile:\n${target}\n${events}\n\n${fragments.join('\n\n')}\n\nA private backup is retained before writing. ${explanation} The profile is used only by launches explicitly selecting it with --settings.`;
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
  parseProfileCommand,
  nativeProfilePath,
  nativeProfileIdentity,
  reserveNativeProfile,
  profileAfterCommand,
  profileAfterCommandLegacy,
  checkProfilePolicy,
  profileReviewText,
  profileDraftEligibility,
};
