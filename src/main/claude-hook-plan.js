// @ts-check
'use strict';

const { createHash } = require('node:crypto');
const { scanJson, previewEdits } = require('./claude-hook-json');
const { CONTRACT_V2, planInstallV2, planRemovalV2 } = require('./claude-hook-plan-v2');

/** @typedef {import('./claude-hook-json').JsonNode} JsonNode */
/** @typedef {{ start: number, end: number, text: string }} Edit */
/** @typedef {{ configPath: string, configBytes: Buffer, command: string, contract: string, timeoutSeconds: number }} InstallOptions */
/** @typedef {{ configPath: string, configBytes: Buffer, manifest: string, manifestSha256: string }} RemovalOptions */
const CONTRACT = 'aegis-action-policy-hook-v1';
const REQUIREMENTS = Object.freeze([
  'owner-confirmed-exact-plan',
  'verified-private-backup',
  'revalidate-current-bytes',
  'verify-written-readback',
]);
const HASH = /^[a-f0-9]{64}$/;
/** @param {string|Buffer} value */
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** @param {string} value */
const hasControl = (value) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
/** @param {unknown} value @param {string[]} keys @returns {Record<string, unknown>} */
function fields(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('INVALID_OPTIONS');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (
    names.length !== keys.length ||
    names.some(
      (key) =>
        typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value'),
    )
  )
    throw Error('INVALID_OPTIONS');
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
/** @param {unknown} path */
function checkPath(path) {
  if (
    typeof path !== 'string' ||
    path.length > 4096 ||
    hasControl(path) ||
    Buffer.from(path).toString('utf8') !== path ||
    !/^(?:[A-Za-z]:[/\\]|\/|\\\\[^\\]+\\)/.test(path)
  )
    throw Error('INVALID_OPTIONS');
}
/** @param {unknown} command @param {unknown} timeout */
function checkSelection(command, timeout) {
  if (
    typeof command !== 'string' ||
    command.length > 4096 ||
    !command.trim() ||
    Buffer.byteLength(command) > 4096 ||
    hasControl(command) ||
    typeof timeout !== 'number' ||
    !Number.isInteger(timeout) ||
    timeout < 2 ||
    timeout > 60
  )
    throw Error('INVALID_SELECTION');
}
/** @param {string} command @param {number} timeout */
const entryText = (command, timeout) =>
  JSON.stringify({ matcher: 'Bash', hooks: [{ type: 'command', command, timeout }] });
/** @param {JsonNode} root */
function selectedArray(root) {
  if (root.kind !== 'object') throw Error('UNSUPPORTED_STRUCTURE');
  const hooks = root.members.get('hooks');
  if (hooks && hooks.kind !== 'object') throw Error('UNSUPPORTED_STRUCTURE');
  const array = hooks?.members.get('PreToolUse');
  if (array && array.kind !== 'array') throw Error('UNSUPPORTED_STRUCTURE');
  return { hooks, array };
}
/** @param {JsonNode} node @param {string} command @param {number} timeout */
function equalsEntry(node, command, timeout) {
  const hookArray = node.members.get('hooks');
  const hook = hookArray?.items[0];
  return (
    node.kind === 'object' &&
    node.members.size === 2 &&
    node.members.get('matcher')?.value === 'Bash' &&
    hookArray?.kind === 'array' &&
    hookArray.items.length === 1 &&
    hook?.kind === 'object' &&
    hook.members.size === 3 &&
    hook.members.get('type')?.value === 'command' &&
    hook.members.get('command')?.value === command &&
    hook.members.get('timeout')?.value === timeout
  );
}
/** @param {JsonNode|undefined} array @param {string} command */
const commandEntries = (array, command) =>
  array?.items.filter((node) =>
    node.members.get('hooks')?.items.some((hook) => hook.members.get('command')?.value === command),
  ) || [];
/** @param {string} scope @param {boolean} prefixed @param {string} entry */
function insertion(scope, prefixed, entry) {
  const value =
    scope === 'root'
      ? `"hooks":{"PreToolUse":[${entry}]}`
      : scope === 'hooks'
        ? `"PreToolUse":[${entry}]`
        : entry;
  return (prefixed ? ',' : '') + value;
}
/** @param {{bytes: Buffer, text: string}} source @param {string} path @param {Edit[]} edits */
function result(source, path, edits) {
  return {
    ...previewEdits(source, path, edits),
    ok: true,
    status: edits.length ? 'planned' : 'configured',
    presence: edits.length ? 'Unknown' : 'Configured',
    plannedPresence: 'Configured',
    requirements: REQUIREMENTS,
    commandQualification: 'owner-selected-unqualified',
  };
}
const REASONS = new Set([
  'INVALID_BYTES',
  'CONFIG_TOO_LARGE',
  'INVALID_ENCODING',
  'INVALID_JSON',
  'DUPLICATE_KEY',
  'CONFIG_COMPLEXITY',
  'INVALID_OPTIONS',
  'INVALID_SELECTION',
  'UNSUPPORTED_CONTRACT',
  'UNSUPPORTED_STRUCTURE',
  'PREVIEW_TOO_LARGE',
  'INVALID_MANIFEST',
  'MANIFEST_MISMATCH',
  'OWNED_ENTRY_CHANGED',
  'AMBIGUOUS_OWNERSHIP',
  'SELECTED_COMMAND_CONFLICT',
]);
/** @param {unknown} error */
function failure(error) {
  let reason = 'INVALID_OPTIONS';
  try {
    const message =
      error && typeof error === 'object'
        ? Object.getOwnPropertyDescriptor(error, 'message')?.value
        : undefined;
    if (typeof message === 'string' && REASONS.has(message)) reason = message;
  } catch {
    /* Never inspect hostile exception accessors or include their diagnostics. */
  }
  return { ok: false, reason };
}

/**
 * Plan one hook insertion from explicit bytes; never read/write/discover or execute.
 * Returned fragments and manifest are PRIVATE and may contain the selected command.
 * Existing equal hooks remain unowned. A plan establishes Configured presence only.
 * @param {InstallOptions} options Caller-selected bytes, path and existing command contract.
 * @returns Bounded private edits, hashes and required future writer gates, or fixed failure.
 * @since v0.19.3
 */
function planInstall(options) {
  try {
    if (Object.getOwnPropertyDescriptor(options, 'contract')?.value === CONTRACT_V2)
      return planInstallV2(options);
    const input = fields(options, [
      'configPath',
      'configBytes',
      'command',
      'contract',
      'timeoutSeconds',
    ]);
    checkPath(input.configPath);
    checkSelection(input.command, input.timeoutSeconds);
    if (input.contract !== CONTRACT) throw Error('UNSUPPORTED_CONTRACT');
    const path = /** @type {string} */ (input.configPath);
    const command = /** @type {string} */ (input.command);
    const timeout = /** @type {number} */ (input.timeoutSeconds);
    const source = scanJson(/** @type {Buffer} */ (input.configBytes));
    const { hooks, array } = selectedArray(source.root);
    const selected = commandEntries(array, command);
    if (selected.some((node) => !equalsEntry(node, command, timeout)))
      throw Error('SELECTED_COMMAND_CONFLICT');
    if (selected.length) return result(source, path, []);
    const parent = array || hooks || source.root;
    const children = parent.kind === 'array' ? parent.items : [...parent.members.values()];
    const start = children.length ? children[children.length - 1].end : parent.start + 1;
    const scope = array ? 'array' : hooks ? 'hooks' : 'root';
    const entry = entryText(command, timeout);
    const text = insertion(scope, children.length > 0, entry);
    const plan = result(source, path, [{ start, end: start, text }]);
    const manifest = JSON.stringify({
      version: 1,
      contract: CONTRACT,
      pathSha256: hash(path),
      beforeSha256: plan.beforeSha256,
      installedSha256: plan.afterSha256,
      entrySha256: hash(entry),
      command,
      timeoutSeconds: timeout,
      scope,
      prefixed: children.length > 0,
      startByte: Buffer.byteLength(source.text.slice(0, start)),
      entryIndex: array ? children.length : 0,
    });
    return { ...plan, manifest, manifestSha256: hash(manifest) };
  } catch (error) {
    return failure(error);
  }
}

/** @param {unknown} text @param {string} path */
function readManifest(text, path) {
  try {
    if (typeof text !== 'string' || text.length > 16384 || Buffer.byteLength(text) > 16384)
      throw Error();
    scanJson(Buffer.from(text));
    const item = fields(JSON.parse(text), [
      'version',
      'contract',
      'pathSha256',
      'beforeSha256',
      'installedSha256',
      'entrySha256',
      'command',
      'timeoutSeconds',
      'scope',
      'prefixed',
      'startByte',
      'entryIndex',
    ]);
    checkSelection(item.command, item.timeoutSeconds);
    if (
      item.version !== 1 ||
      item.contract !== CONTRACT ||
      !['root', 'hooks', 'array'].includes(/** @type {string} */ (item.scope)) ||
      typeof item.prefixed !== 'boolean' ||
      typeof item.startByte !== 'number' ||
      !Number.isSafeInteger(item.startByte) ||
      item.startByte < 0 ||
      item.startByte > 262144 ||
      typeof item.entryIndex !== 'number' ||
      !Number.isSafeInteger(item.entryIndex) ||
      item.entryIndex < 0 ||
      item.entryIndex > 20000 ||
      (item.scope !== 'array' && item.entryIndex !== 0) ||
      ['pathSha256', 'beforeSha256', 'installedSha256', 'entrySha256'].some(
        (key) => typeof item[key] !== 'string' || !HASH.test(/** @type {string} */ (item[key])),
      )
    )
      throw Error();
    const entry = entryText(
      /** @type {string} */ (item.command),
      /** @type {number} */ (item.timeoutSeconds),
    );
    if (hash(entry) !== item.entrySha256) throw Error();
    if (hash(path) !== item.pathSha256) return { mismatch: true, item, entry };
    return { mismatch: false, item, entry };
  } catch {
    throw Error('INVALID_MANIFEST');
  }
}

/**
 * Plan rollback only against a trusted recorded installation manifest.
 * Exact installed bytes permit exact rollback; concurrent edits require a fresh
 * targeted preview. Changed/reformatted or ambiguous owned entries are refused.
 * The manifest is a private trust input, not an authenticated ownership proof.
 * @param {RemovalOptions} options Explicit current bytes and previously recorded manifest.
 * @returns Private removal plan or a bounded fixed failure.
 * @since v0.19.3
 */
function planRemoval(options) {
  try {
    const input = fields(options, ['configPath', 'configBytes', 'manifest', 'manifestSha256']);
    checkPath(input.configPath);
    const path = /** @type {string} */ (input.configPath);
    if (
      typeof input.manifest !== 'string' ||
      input.manifest.length > 16384 ||
      typeof input.manifestSha256 !== 'string' ||
      !HASH.test(input.manifestSha256)
    )
      throw Error('INVALID_MANIFEST');
    try {
      if (JSON.parse(input.manifest)?.version === 2) return planRemovalV2(options);
    } catch {
      throw Error('INVALID_MANIFEST');
    }
    if (hash(input.manifest) !== input.manifestSha256) throw Error('MANIFEST_MISMATCH');
    const { item, entry, mismatch } = readManifest(input.manifest, path);
    if (mismatch) throw Error('MANIFEST_MISMATCH');
    const source = scanJson(/** @type {Buffer} */ (input.configBytes));
    if (hash(source.bytes) === item.installedSha256) {
      const inserted = insertion(
        /** @type {string} */ (item.scope),
        /** @type {boolean} */ (item.prefixed),
        entry,
      );
      const startByte = /** @type {number} */ (item.startByte);
      const endByte = startByte + Buffer.byteLength(inserted);
      if (!source.bytes.subarray(startByte, endByte).equals(Buffer.from(inserted)))
        throw Error('MANIFEST_MISMATCH');
      const restored = Buffer.concat([
        source.bytes.subarray(0, startByte),
        source.bytes.subarray(endByte),
      ]);
      if (hash(restored) !== item.beforeSha256) throw Error('MANIFEST_MISMATCH');
      const start = source.bytes.subarray(0, startByte).toString('utf8').length;
      return {
        ...result(source, path, [{ start, end: start + inserted.length, text: '' }]),
        mode: 'exact-rollback',
        presence: 'Unknown',
        plannedPresence: 'Unknown',
      };
    }
    const { array } = selectedArray(source.root);
    const equal =
      array?.items.filter((node) =>
        equalsEntry(
          node,
          /** @type {string} */ (item.command),
          /** @type {number} */ (item.timeoutSeconds),
        ),
      ) || [];
    if (equal.length > 1 || commandEntries(array, /** @type {string} */ (item.command)).length > 1)
      throw Error('AMBIGUOUS_OWNERSHIP');
    if (!array || equal.length !== 1 || source.text.slice(equal[0].start, equal[0].end) !== entry)
      throw Error('OWNED_ENTRY_CHANGED');
    const owned = equal[0];
    const index = array.items.indexOf(owned);
    if (index !== item.entryIndex) throw Error('OWNED_ENTRY_CHANGED');
    const comma = array.commas[index ? index - 1 : 0];
    const edits = [{ start: owned.start, end: owned.end, text: '' }];
    if (array.items.length > 1) edits.push({ start: comma, end: comma + 1, text: '' });
    return {
      ...result(source, path, edits),
      mode: 'targeted-removal',
      presence: 'Unknown',
      plannedPresence: 'Unknown',
    };
  } catch (error) {
    return failure(error);
  }
}

module.exports = { CONTRACT, CONTRACT_V2, planInstall, planRemoval };
