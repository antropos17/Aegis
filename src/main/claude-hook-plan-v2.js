'use strict';

const { createHash } = require('node:crypto');
const { scanJson, previewEdits } = require('./claude-hook-json');

const CONTRACT_V2 = 'aegis-action-policy-hook-v2';
const EVENTS = Object.freeze(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
const REQUIREMENTS = Object.freeze([
  'owner-confirmed-exact-plan',
  'verified-private-backup',
  'revalidate-current-bytes',
  'verify-written-readback',
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/;

function fields(value, names) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('INVALID_OPTIONS');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== names.length ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !names.includes(key) ||
        !Object.hasOwn(descriptors[key], 'value'),
    )
  )
    throw Error('INVALID_OPTIONS');
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

const hasControls = (value) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

function validPath(value) {
  return (
    typeof value === 'string' &&
    value.length <= 4096 &&
    !hasControls(value) &&
    Buffer.from(value).toString('utf8') === value &&
    /^(?:[A-Za-z]:[/\\]|\/|\\\\[^\\]+\\)/.test(value)
  );
}

function validCommand(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 4096 &&
    Buffer.byteLength(value) <= 4096 &&
    !hasControls(value)
  );
}

const entryText = (command, timeout) =>
  JSON.stringify({ matcher: 'Bash', hooks: [{ type: 'command', command, timeout }] });

function eventArray(root, event) {
  if (root.kind !== 'object') throw Error('UNSUPPORTED_STRUCTURE');
  const hooks = root.members.get('hooks');
  if (hooks && hooks.kind !== 'object') throw Error('UNSUPPORTED_STRUCTURE');
  const array = hooks?.members.get(event);
  if (array && array.kind !== 'array') throw Error('UNSUPPORTED_STRUCTURE');
  return { hooks, array };
}

function matches(node, command, timeout) {
  const list = node.members.get('hooks');
  const hook = list?.items[0];
  return (
    node.kind === 'object' &&
    node.members.size === 2 &&
    node.members.get('matcher')?.value === 'Bash' &&
    list?.kind === 'array' &&
    list.items.length === 1 &&
    hook?.kind === 'object' &&
    hook.members.size === 3 &&
    hook.members.get('type')?.value === 'command' &&
    hook.members.get('command')?.value === command &&
    hook.members.get('timeout')?.value === timeout
  );
}

function hasCommand(node, command) {
  return node.members
    .get('hooks')
    ?.items.some((hook) => hook.members.get('command')?.value === command);
}

function project(source, path, edits) {
  return {
    ...previewEdits(source, path, edits),
    ok: true,
    status: edits.length ? 'planned' : 'configured',
    presence: edits.length ? 'Unknown' : 'Configured',
    plannedPresence: 'Configured',
    requirements: REQUIREMENTS,
    commandQualification: 'owner-selected-unqualified',
    eventNames: EVENTS,
  };
}

function failure(error) {
  const allowed = new Set([
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
  const message =
    error && typeof error === 'object'
      ? Object.getOwnPropertyDescriptor(error, 'message')?.value
      : null;
  return {
    ok: false,
    reason: typeof message === 'string' && allowed.has(message) ? message : 'INVALID_OPTIONS',
  };
}

/** Plan one three-event transaction from explicit bytes and private fixed commands.
 * @param {object} options Trusted planner selection. @returns Private plan or fixed refusal. @since v0.21.0 */
function planInstallV2(options) {
  let source;
  try {
    const input = fields(options, [
      'configPath',
      'configBytes',
      'command',
      'afterCommand',
      'contract',
      'timeoutSeconds',
    ]);
    if (!validPath(input.configPath)) throw Error('INVALID_OPTIONS');
    if (
      !validCommand(input.command) ||
      !validCommand(input.afterCommand) ||
      input.command === input.afterCommand ||
      !Number.isInteger(input.timeoutSeconds) ||
      input.timeoutSeconds < 2 ||
      input.timeoutSeconds > 60
    )
      throw Error('INVALID_SELECTION');
    if (input.contract !== CONTRACT_V2) throw Error('UNSUPPORTED_CONTRACT');
    source = scanJson(input.configBytes);
    const entries = [
      entryText(input.command, input.timeoutSeconds),
      entryText(input.afterCommand, input.timeoutSeconds),
      entryText(input.afterCommand, input.timeoutSeconds),
    ];
    const commands = [input.command, input.afterCommand, input.afterCommand];
    const selected = EVENTS.map((event, index) => {
      const array = eventArray(source.root, event).array;
      const own = (array?.items || []).filter((node) => hasCommand(node, commands[index]));
      const other = (array?.items || []).filter((node) =>
        hasCommand(node, index ? input.command : input.afterCommand),
      );
      if (
        other.length ||
        own.length > 1 ||
        own.some((node) => !matches(node, commands[index], input.timeoutSeconds))
      )
        throw Error('SELECTED_COMMAND_CONFLICT');
      return { array, own };
    });
    const configured = selected.filter((item) => item.own.length).length;
    if (configured && configured !== EVENTS.length) throw Error('SELECTED_COMMAND_CONFLICT');
    if (configured === EVENTS.length) {
      if (selected.some((item) => item.array.items.length !== 1))
        throw Error('SELECTED_COMMAND_CONFLICT');
      return project(source, input.configPath, []);
    }
    if (selected.some((item) => item.array?.items.length)) throw Error('SELECTED_COMMAND_CONFLICT');
    const hooks = source.root.members.get('hooks');
    const edits = [];
    const indices = [];
    if (!hooks) {
      const members = [...source.root.members.values()];
      const start = members.length ? members.at(-1).end : source.root.start + 1;
      edits.push({
        start,
        end: start,
        text: `${members.length ? ',' : ''}"hooks":{${EVENTS.map((event, i) => `"${event}":[${entries[i]}]`).join(',')}}`,
      });
      indices.push(0, 0, 0);
    } else {
      const missing = [];
      for (let i = 0; i < EVENTS.length; i++) {
        const array = selected[i].array;
        indices.push(array?.items.length || 0);
        if (!array) missing.push(`"${EVENTS[i]}":[${entries[i]}]`);
        else {
          const count = array.items.length;
          const start = count ? array.items.at(-1).end : array.start + 1;
          edits.push({ start, end: start, text: `${count ? ',' : ''}${entries[i]}` });
        }
      }
      if (missing.length) {
        const members = [...hooks.members.values()];
        const start = members.length ? members.at(-1).end : hooks.start + 1;
        edits.push({ start, end: start, text: `${members.length ? ',' : ''}${missing.join(',')}` });
      }
    }
    const plan = project(source, input.configPath, edits);
    const manifest = JSON.stringify({
      version: 2,
      contract: CONTRACT_V2,
      pathSha256: hash(input.configPath),
      beforeSha256: plan.beforeSha256,
      installedSha256: plan.afterSha256,
      command: input.command,
      afterCommand: input.afterCommand,
      timeoutSeconds: input.timeoutSeconds,
      indices,
      edits: plan.edits,
    });
    if (Buffer.byteLength(manifest) > 16384) throw Error('PREVIEW_TOO_LARGE');
    return { ...plan, manifest, manifestSha256: hash(manifest) };
  } catch (error) {
    return failure(error);
  } finally {
    source?.bytes.fill(0);
  }
}

/** Plan removal only from the session's retained private V2 manifest.
 * @param {object} options Private current bytes and manifest. @returns Exact/targeted removal or refusal. @since v0.21.0 */
function planRemovalV2(options) {
  let source;
  try {
    const input = fields(options, ['configPath', 'configBytes', 'manifest', 'manifestSha256']);
    if (
      !validPath(input.configPath) ||
      typeof input.manifest !== 'string' ||
      Buffer.byteLength(input.manifest) > 16384 ||
      typeof input.manifestSha256 !== 'string' ||
      !HASH.test(input.manifestSha256)
    )
      throw Error('INVALID_MANIFEST');
    if (hash(input.manifest) !== input.manifestSha256) throw Error('MANIFEST_MISMATCH');
    scanJson(Buffer.from(input.manifest)).bytes.fill(0);
    const item = fields(JSON.parse(input.manifest), [
      'version',
      'contract',
      'pathSha256',
      'beforeSha256',
      'installedSha256',
      'command',
      'afterCommand',
      'timeoutSeconds',
      'indices',
      'edits',
    ]);
    if (
      item.version !== 2 ||
      item.contract !== CONTRACT_V2 ||
      !validCommand(item.command) ||
      !validCommand(item.afterCommand) ||
      item.command === item.afterCommand ||
      !Number.isInteger(item.timeoutSeconds) ||
      item.timeoutSeconds < 2 ||
      item.timeoutSeconds > 60 ||
      ![item.pathSha256, item.beforeSha256, item.installedSha256].every(
        (value) => typeof value === 'string' && HASH.test(value),
      ) ||
      !Array.isArray(item.indices) ||
      item.indices.length !== 3 ||
      item.indices.some((index) => !Number.isSafeInteger(index) || index < 0 || index > 20000) ||
      !Array.isArray(item.edits) ||
      !item.edits.length ||
      item.edits.length > 4
    )
      throw Error('INVALID_MANIFEST');
    if (item.pathSha256 !== hash(input.configPath)) throw Error('MANIFEST_MISMATCH');
    let previous = -1;
    const saved = item.edits.map((value) => {
      const edit = fields(value, ['startByte', 'endByte', 'replacementUtf8']);
      if (
        !Number.isSafeInteger(edit.startByte) ||
        edit.startByte < 0 ||
        edit.startByte <= previous ||
        edit.startByte > 262144 ||
        edit.endByte !== edit.startByte ||
        typeof edit.replacementUtf8 !== 'string' ||
        !edit.replacementUtf8 ||
        Buffer.byteLength(edit.replacementUtf8) > 16384
      )
        throw Error('INVALID_MANIFEST');
      previous = edit.startByte;
      return edit;
    });
    source = scanJson(input.configBytes);
    if (hash(source.bytes) === item.installedSha256) {
      let shift = 0;
      const removals = saved.map((edit) => {
        const start = edit.startByte + shift;
        const length = Buffer.byteLength(edit.replacementUtf8);
        shift += length;
        if (!source.bytes.subarray(start, start + length).equals(Buffer.from(edit.replacementUtf8)))
          throw Error('MANIFEST_MISMATCH');
        return { start, end: start + length };
      });
      let restored = Buffer.from(source.bytes);
      for (const edit of [...removals].reverse())
        restored = Buffer.concat([restored.subarray(0, edit.start), restored.subarray(edit.end)]);
      if (hash(restored) !== item.beforeSha256) throw Error('MANIFEST_MISMATCH');
      const edits = removals.map((edit) => ({
        start: source.bytes.subarray(0, edit.start).toString('utf8').length,
        end: source.bytes.subarray(0, edit.end).toString('utf8').length,
        text: '',
      }));
      return {
        ...project(source, input.configPath, edits),
        mode: 'exact-rollback',
        presence: 'Unknown',
        plannedPresence: 'Unknown',
      };
    }
    const commands = [item.command, item.afterCommand, item.afterCommand];
    const edits = [];
    for (let i = 0; i < EVENTS.length; i++) {
      const array = eventArray(source.root, EVENTS[i]).array;
      const own = (array?.items || []).filter((node) => hasCommand(node, commands[i]));
      const wrong = (array?.items || []).filter((node) =>
        hasCommand(node, i ? item.command : item.afterCommand),
      );
      if (own.length > 1 || wrong.length) throw Error('AMBIGUOUS_OWNERSHIP');
      if (
        !array ||
        own.length !== 1 ||
        !matches(own[0], commands[i], item.timeoutSeconds) ||
        array.items.indexOf(own[0]) !== item.indices[i] ||
        source.text.slice(own[0].start, own[0].end) !== entryText(commands[i], item.timeoutSeconds)
      )
        throw Error('OWNED_ENTRY_CHANGED');
      const index = array.items.indexOf(own[0]);
      edits.push({ start: own[0].start, end: own[0].end, text: '' });
      if (array.items.length > 1) {
        const comma = array.commas[index ? index - 1 : 0];
        edits.push({ start: comma, end: comma + 1, text: '' });
      }
    }
    return {
      ...project(source, input.configPath, edits),
      mode: 'targeted-removal',
      presence: 'Unknown',
      plannedPresence: 'Unknown',
    };
  } catch (error) {
    return failure(error);
  } finally {
    source?.bytes.fill(0);
  }
}

module.exports = { CONTRACT_V2, planInstallV2, planRemovalV2 };
