'use strict';

const path = require('node:path');
const { readActionFile, parseActionJson } = require('./action-policy');
const bindings = require('./execution-binding');
const LIMITS = Object.freeze({ actions: 8, captureMs: 1500 });
const catalogs = new WeakMap();
let testDeps = null;
const unavailable = () => new Error('catalog-unavailable');
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const absolute = (value) =>
  typeof value === 'string' &&
  !value.includes('\0') &&
  path.isAbsolute(value) &&
  !/^[\\/]{2}/.test(value) &&
  (process.platform !== 'win32' || (/^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')));

function descriptor(id) {
  return {
    name: 'aegis_action_' + id,
    description:
      'Run this operator-selected action under its exact AEGIS policy. Child output is discarded. Descendants are not isolated.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  };
}
function clear(entry) {
  entry.revoked = true;
  for (const action of entry.actions) {
    if (action.binding) entry.revoke(action.binding);
    action.binding = null;
    action.policyPath = null;
    action.requestPath = null;
  }
}

/** Capture an immutable operator selection; manifest edits apply on the next connection only.
 * All per-action bindings must be captured before the single deadline.
 * @param {string} catalogPath Selected bounded local JSON manifest.
 * @param {{signal?: AbortSignal}} [options] Owner cancellation.
 * @returns {Promise<object>} Private frozen capability, never a serialized approval.
 * @since v0.15.1 */
async function captureActionCatalog(catalogPath, { signal } = {}) {
  if (signal?.aborted) throw unavailable();
  const deps = testDeps || {};
  const read = deps.read || readActionFile;
  const capture = deps.capture || bindings.captureExecutionBinding;
  const now = deps.now || (() => performance.now());
  const started = now();
  const entry = {
    revoked: false,
    actions: [],
    ids: [],
    revoke: deps.revoke || bindings.revokeExecutionBinding,
    active: deps.active || bindings.isExecutionBindingActive,
  };
  const controller = new AbortController();
  let timer;
  let abort;
  const stopped = () => entry.revoked || signal?.aborted || now() - started >= LIMITS.captureMs;
  try {
    await Promise.race([
      (async () => {
        const bytes = await read(catalogPath);
        let manifest;
        try {
          if (stopped() || !Buffer.isBuffer(bytes)) throw unavailable();
          manifest = parseActionJson(bytes);
        } finally {
          if (Buffer.isBuffer(bytes)) bytes.fill(0);
        }
        if (
          !exact(manifest, ['schemaVersion', 'actions']) ||
          manifest.schemaVersion !== 1 ||
          !Array.isArray(manifest.actions) ||
          !manifest.actions.length ||
          manifest.actions.length > LIMITS.actions
        )
          throw unavailable();
        const ids = new Set();
        for (const action of manifest.actions) {
          if (
            !exact(action, ['id', 'policyPath', 'requestPath']) ||
            typeof action.id !== 'string' ||
            !/^[a-z][a-z0-9_-]{0,31}$/.test(action.id) ||
            ids.has(action.id) ||
            !absolute(action.policyPath) ||
            !absolute(action.requestPath)
          )
            throw unavailable();
          ids.add(action.id);
        }
        entry.ids = [...ids];
        entry.actions = manifest.actions.map((action) => ({ ...action, binding: null }));
        await Promise.all(
          entry.actions.map(async (action) => {
            if (stopped()) throw unavailable();
            const binding = await capture(action.policyPath, action.requestPath, {
              signal: controller.signal,
            });
            if (stopped()) {
              entry.revoke(binding);
              throw unavailable();
            }
            if (!binding || typeof binding !== 'object') throw unavailable();
            action.binding = binding;
          }),
        );
        if (stopped()) throw unavailable();
      })(),
      new Promise((_resolve, reject) => {
        abort = () => {
          clear(entry);
          controller.abort();
          reject(unavailable());
        };
        timer = setTimeout(abort, LIMITS.captureMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
    if (stopped()) throw unavailable();
    const cap = Object.freeze({});
    catalogs.set(cap, entry);
    return cap;
  } catch {
    clear(entry);
    controller.abort();
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Return detached public metadata, including after revocation; never selected paths.
 * @param {object} cap Captured catalog. @returns {object[]} Fixed descriptors.
 * @since v0.15.1 */
function listActionCatalog(cap) {
  const entry = catalogs.get(cap);
  if (!entry) throw unavailable();
  return entry.ids.map(descriptor);
}

/** Select a private action for a trusted execution owner; no I/O or recapture.
 * Any observed revoked member invalidates the complete catalog.
 * @param {object} cap Captured catalog. @param {string} name Published tool name.
 * @returns {{policyPath:string,requestPath:string,binding:object}} Private selection.
 * @since v0.15.1 */
function selectActionCatalog(cap, name) {
  const entry = catalogs.get(cap);
  if (!entry || entry.revoked) throw unavailable();
  if (
    !entry.actions.every((action) =>
      entry.active(action.binding, action.policyPath, action.requestPath),
    )
  ) {
    clear(entry);
    throw unavailable();
  }
  const action = entry.actions.find((candidate) => 'aegis_action_' + candidate.id === name);
  if (!action) throw unavailable();
  return {
    policyPath: action.policyPath,
    requestPath: action.requestPath,
    binding: action.binding,
  };
}

/** @param {object} cap Owned catalog. @returns {void} @since v0.15.1 */
function revokeActionCatalog(cap) {
  const entry = catalogs.get(cap);
  if (entry && !entry.revoked) clear(entry);
}
/** @param {object} deps Trusted reader/binding/clock seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  captureActionCatalog,
  listActionCatalog,
  selectActionCatalog,
  revokeActionCatalog,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
