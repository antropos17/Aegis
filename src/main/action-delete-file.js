'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readActionFile, parseActionJson } = require('./action-policy');
const {
  captureExecutionBinding,
  isExecutionBindingActive,
  matchesExecutionBinding,
  revokeExecutionBinding,
} = require('./execution-binding');
const { isExecutionRuntimeSupported } = require('./execution-runtime');
const terminal = require('./action-confirmation-terminal');

const LIMITS = Object.freeze({ prepareMs: 1500, rules: 32 });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const result = (decision, reason, state = 'not-started') => ({
  schemaVersion: 1,
  mode: 'action-delete-file',
  decision,
  reason,
  operation: { state },
  control: 'selected-file-only',
  outsideRouteCoverage: 'unknown',
});

function validPath(filename) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename.includes('\0') ||
    Buffer.byteLength(filename) > 4096 ||
    !path.isAbsolute(filename) ||
    path.resolve(filename) !== filename ||
    filename === path.parse(filename).root ||
    /^[\\/]{2}/.test(filename)
  )
    return false;
  const parts = filename.slice(path.parse(filename).root.length).split(path.sep);
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  if (process.platform === 'win32') {
    if (!/^[a-z]:\\/i.test(filename)) return false;
    if (parts.some((part) => /[:<>"|?*]/.test(part) || /[. ]$/.test(part))) return false;
  }
  // eslint-disable-next-line no-control-regex -- Filesystem operands cannot contain control characters.
  return !/[\x00-\x1f\x7f-\x9f]/.test(filename);
}

function validOperation(value) {
  return keys(value, ['kind', 'path']) && value.kind === 'delete-file' && validPath(value.path);
}

function validPolicy(value) {
  if (
    !keys(value, ['schemaVersion', 'defaultDecision', 'rules']) ||
    value.schemaVersion !== 1 ||
    value.defaultDecision !== 'deny' ||
    !Array.isArray(value.rules) ||
    value.rules.length > LIMITS.rules
  )
    return false;
  const seen = new Set();
  for (const rule of value.rules) {
    if (
      !keys(rule, ['operation', 'decision']) ||
      !validOperation(rule.operation) ||
      !['allow', 'deny'].includes(rule.decision) ||
      seen.has(rule.operation.path)
    )
      return false;
    seen.add(rule.operation.path);
  }
  return true;
}

async function selected(filename, binding, policyPath, requestPath, kind) {
  let bytes;
  try {
    bytes = await readActionFile(filename);
    if (!matchesExecutionBinding(binding, policyPath, requestPath, kind, bytes))
      throw new Error('configuration-changed');
    return parseActionJson(bytes);
  } catch {
    revokeExecutionBinding(binding);
    throw new Error('configuration-unavailable');
  } finally {
    bytes?.fill(0);
  }
}

async function prepare(policyPath, requestPath, binding) {
  const request = await selected(requestPath, binding, policyPath, requestPath, 'request');
  if (!keys(request, ['schemaVersion', 'operation']) || request.schemaVersion !== 1)
    return { reason: 'request-invalid' };
  if (!validOperation(request.operation)) return { reason: 'request-invalid' };
  const policy = await selected(policyPath, binding, policyPath, requestPath, 'policy');
  if (!validPolicy(policy)) return { reason: 'policy-invalid' };
  const rule = policy.rules.find((entry) => entry.operation.path === request.operation.path);
  if (rule?.decision !== 'allow') return { reason: 'policy-deny' };
  if ([policyPath, requestPath].some((name) => path.resolve(name) === request.operation.path))
    return { reason: 'target-invalid' };
  return { operation: request.operation };
}

async function bounded(work, signal) {
  let timer;
  let abort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => (signal.aborted ? null : work())),
      new Promise((resolve) => {
        abort = () => resolve(null);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        timer = setTimeout(abort, LIMITS.prepareMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function sameFile(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.mode === b.mode
  );
}

async function inspectTarget(filename) {
  if (!validPath(filename)) throw new Error('invalid');
  const root = path.parse(filename).root;
  const parts = filename.slice(root.length).split(path.sep);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid');
  }
  const stat = await fs.promises.lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid');
  if ((await fs.promises.realpath(filename)) !== filename) throw new Error('invalid');
  return stat;
}

/**
 * Confirm and remove one exact regular file through an AEGIS-owned operation.
 * No executable or provider tool is launched. Filesystem identity is rechecked
 * before unlink; same-account replacement between that check and unlink remains
 * outside the guarantee.
 * @param {string} policyPath Explicit bounded policy file.
 * @param {string} requestPath Explicit bounded request file.
 * @param {{signal?: AbortSignal, binding?: object}} [options] Owner cancellation and optional borrowed connection binding.
 * @returns {Promise<object>} Redacted decision and deletion outcome.
 * @since v0.16.0
 */
async function deleteSelectedFile(policyPath, requestPath, options = {}) {
  const { signal, binding: borrowedBinding } = options;
  const borrowed = Object.hasOwn(options, 'binding');
  if (signal?.aborted) return result('deny', 'action-cancelled');
  if (borrowed && !isExecutionBindingActive(borrowedBinding, policyPath, requestPath))
    return result('deny', 'configuration-changed');
  if (!isExecutionRuntimeSupported()) return result('deny', 'runtime-unsupported');
  if (!terminal.isTerminalAvailable()) return result('deny', 'terminal-required');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const stopWatching = terminal.watchTerminalLifetime(abort);
  let binding;
  let stopReading = () => {};
  try {
    binding = borrowed
      ? borrowedBinding
      : await captureExecutionBinding(policyPath, requestPath, { signal: controller.signal });
    const first = await bounded(() => prepare(policyPath, requestPath, binding), controller.signal);
    if (!first || controller.signal.aborted) return result('deny', 'preparation-unavailable');
    if (!first.operation) return result('deny', first.reason);
    const before = await bounded(() => inspectTarget(first.operation.path), controller.signal);
    if (!before || controller.signal.aborted) return result('deny', 'target-unavailable');
    const confirmed = await terminal.confirmInTerminal(first.operation, {
      signal: controller.signal,
      kind: 'delete-file',
    });
    if (!confirmed || controller.signal.aborted) return result('deny', 'confirmation-denied');
    stopReading = terminal.monitorTerminalInput(abort);
    const second = await bounded(
      () => prepare(policyPath, requestPath, binding),
      controller.signal,
    );
    if (!second?.operation || controller.signal.aborted)
      return result('deny', 'configuration-changed');
    const after = await bounded(() => inspectTarget(second.operation.path), controller.signal);
    if (!after || !sameFile(before, after) || controller.signal.aborted)
      return result('deny', 'target-changed');
    try {
      await fs.promises.unlink(second.operation.path);
      return result('allow', 'file-deleted', 'deleted');
    } catch {
      return result('unknown', 'deletion-unavailable', 'unknown');
    }
  } catch {
    return result('deny', 'preparation-unavailable');
  } finally {
    controller.abort();
    stopReading();
    stopWatching();
    signal?.removeEventListener('abort', abort);
    if (!borrowed) revokeExecutionBinding(binding);
  }
}

/**
 * Route one explicit terminal deletion invocation.
 * @param {string[]} args CLI flag, policy and request.
 * @param {(value:string) => void} write Redacted report sink.
 * @returns {Promise<number>} 0 only for observed deletion, 1 for bad argv, 2 otherwise.
 * @since v0.16.0
 */
async function handleDeleteFileCLI(args, write) {
  if (
    args.length !== 3 ||
    args[0] !== '--action-delete-file-confirm' ||
    args.slice(1).some((arg) => typeof arg !== 'string' || !arg || arg.startsWith('--'))
  ) {
    write(JSON.stringify({ error: 'expected-delete-file-arguments' }));
    return 1;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    const report = await deleteSelectedFile(args[1], args[2], { signal: controller.signal });
    write(JSON.stringify(report));
    return report.operation.state === 'deleted' ? 0 : 2;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

module.exports = { deleteSelectedFile, handleDeleteFileCLI, LIMITS };
