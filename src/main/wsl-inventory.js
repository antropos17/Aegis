/** Win32 running-distribution inventory. Names confer no process or action authority. */
'use strict';
const { execFile: defaultExecFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const CADENCE_MS = 30000;
const FRESH_MS = 90000;
const DEADLINE_MS = 3000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ROWS = 128;
const ARGS = ['--list', '--running', '--quiet'];

/** Resolve a fixed system binary without PATH or caller-selected roots.
 * @param {object} [runtime] Host runtime (test seam).
 * @param {object} [files] Filesystem (test seam).
 * @returns {string|null} Verified file path, or null to fail closed.
 * @since 0.19.2-beta
 */
function resolveWslExecutable(runtime = process, files = fs) {
  // Node has no GetSystemDirectory binding. Restrict this observer to the usual
  // protected Windows root; alternative installations remain unavailable.
  const root = 'C:\\Windows';
  if (runtime.platform !== 'win32' || runtime.env?.SystemRoot?.toLowerCase() !== root.toLowerCase())
    return null;
  const directory = path.win32.join(root, runtime.arch === 'ia32' ? 'Sysnative' : 'System32');
  const file = path.win32.join(directory, 'wsl.exe');
  let descriptor;
  try {
    for (const location of [root, directory]) {
      const stat = files.lstatSync(location);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    }
    const stat = files.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 64) return null;
    descriptor = files.openSync(file, 'r');
    const header = Buffer.alloc(64);
    if (files.readSync(descriptor, header, 0, 64, 0) !== 64 || header.readUInt16LE(0) !== 0x5a4d)
      return null;
    const offset = header.readUInt32LE(60);
    if (offset < 64 || offset > 1024 * 1024 || offset > stat.size - 4) return null;
    const signature = Buffer.alloc(4);
    if (files.readSync(descriptor, signature, 0, 4, offset) !== 4) return null;
    return signature.readUInt32LE(0) === 0x00004550 ? file : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) files.closeSync(descriptor);
  }
}

/** Validate bounded quiet output, preserving names without stripping decorations.
 * @param {unknown} output Raw stdout bytes.
 * @returns {string[]|null} Names, or null for any malformed output.
 * @since 0.19.2-beta
 */
function parseWslOutput(output) {
  if (!Buffer.isBuffer(output) || output.length > MAX_OUTPUT_BYTES) return null;
  if (output.length === 0) return [];
  try {
    const utf16 = output[0] === 0xff && output[1] === 0xfe;
    if (output[0] === 0xfe && output[1] === 0xff) return null;
    // Legacy BOM-less WSL output must contain a recognizable ASCII UTF-16
    // code unit; an arbitrary UTF-8 NUL must not trigger reinterpretation.
    const legacy = output[1] === 0 || (output.at(-2) === 10 && output.at(-1) === 0);
    if (!utf16 && output.includes(0) && !legacy) return null;
    const encoding = utf16 || legacy ? 'utf-16le' : 'utf-8';
    if (encoding === 'utf-16le' && output.length % 2 !== 0) return null;
    const text = new TextDecoder(encoding, { fatal: true }).decode(output);
    if (text === '') return [];
    const rows = text.split(/\r?\n/);
    // A single terminal newline is transport formatting, interior empty rows are invalid.
    if (rows.at(-1) === '') rows.pop();
    if (rows.length === 0 || rows.length > MAX_ROWS) return null;
    const names = new Set();
    for (const name of rows) {
      if (
        name.length > 256 ||
        name !== name.trim() ||
        !/^[\p{L}\p{N}\p{M}_][\p{L}\p{N}\p{M} ._-]*$/u.test(name) ||
        / {2}|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)
      )
        return null;
      const key = name.normalize('NFC').toLowerCase();
      if (names.has(key)) return null;
      names.add(key);
    }
    return rows;
  } catch {
    return null;
  }
}

/** Discard transport diagnostics. @param {unknown} error @returns {string} Fixed reason. */
function failureReason(error) {
  if (error?.code === 'ENOENT') return 'cli-missing';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'invalid-output';
  if (error?.killed === true || error?.code === 'ETIMEDOUT') return 'timeout';
  return 'runtime-unavailable';
}

/** Create a passive owner; only refresh may invoke the fixed host inventory command.
 * @param {{execFile?: Function, now?: Function, platform?: string, resolveExecutable?: Function, onUpdate?: Function}} [options]
 * @returns {{refresh: Function, snapshot: Function, cancelRefresh: Function, stop: Function}} Lifecycle.
 * @since 0.19.2-beta
 */
function createWslInventory(options = {}) {
  const execFile = options.execFile || defaultExecFile;
  const now = options.now || Date.now;
  const platform = options.platform || process.platform;
  const resolveExecutable = options.resolveExecutable || resolveWslExecutable;
  let state = {
    status: 'pending',
    reason: null,
    observedAt: null,
    attemptedAt: null,
    distributions: [],
  };
  let inFlight = null;
  let activeChild = null;
  let cancel = null;
  let generation = 0;
  let stopped = false;

  /** Read a copied cached observation without spawning.
   * @returns {object} Dated inventory.
   * @since 0.19.2-beta
   */
  function snapshot() {
    const age = state.observedAt === null ? null : now() - state.observedAt;
    return {
      ...state,
      stale: stopped || state.status !== 'ready' || age === null || age < 0 || age >= FRESH_MS,
      distributions: [...state.distributions],
    };
  }

  /** Query metadata only. @param {string} file @returns {Promise<object>} Sanitized result. */
  function query(file) {
    return new Promise((resolve) => {
      let settled = false;
      let deadline = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        activeChild = null;
        cancel = null;
        resolve(result);
      };
      cancel = () => finish({ cancelled: true });
      deadline = setTimeout(() => {
        const child = activeChild;
        finish({ reason: 'timeout' });
        try {
          child?.kill('SIGKILL');
        } catch {
          /* Deadline settles independently. */
        }
      }, DEADLINE_MS);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^WSL_UTF8$/i.test(key)),
      );
      env.WSL_UTF8 = '1';
      try {
        const child = execFile(
          file,
          [...ARGS],
          {
            timeout: DEADLINE_MS,
            killSignal: 'SIGKILL',
            maxBuffer: MAX_OUTPUT_BYTES,
            windowsHide: true,
            shell: false,
            encoding: 'buffer',
            env,
          },
          (error, stdout) => {
            if (settled) return;
            if (error) return finish({ reason: failureReason(error) });
            const distributions = parseWslOutput(stdout);
            finish(distributions === null ? { reason: 'invalid-output' } : { distributions });
          },
        );
        if (!settled) activeChild = child;
        child?.stdin?.end();
      } catch (error) {
        const child = activeChild;
        finish({ reason: failureReason(error) });
        try {
          child?.kill('SIGKILL');
        } catch {
          /* A stdin setup failure still settles independently. */
        }
      }
    });
  }

  /** Throttle/coalesce queries, retain dated names on failure and retire on empty success.
   * @returns {Promise<object>} Copied observation; never rejects.
   * @since 0.19.2-beta
   */
  function refresh() {
    if (stopped) return Promise.resolve(snapshot());
    if (inFlight) return inFlight;
    const attemptedAt = now();
    if (
      state.attemptedAt !== null &&
      attemptedAt >= state.attemptedAt &&
      attemptedAt - state.attemptedAt < CADENCE_MS
    )
      return Promise.resolve(snapshot());
    state = { ...state, attemptedAt };
    const owner = generation;
    const work = Promise.resolve()
      .then(async () => {
        if (stopped || owner !== generation) return snapshot();
        const file = platform === 'win32' ? resolveExecutable() : null;
        const outcome =
          platform !== 'win32'
            ? { reason: 'unsupported-platform' }
            : !file
              ? { reason: 'cli-missing' }
              : await query(file);
        if (!stopped && owner === generation && !outcome.cancelled) {
          state = outcome.distributions
            ? {
                status: 'ready',
                reason: null,
                observedAt: now(),
                attemptedAt,
                distributions: outcome.distributions,
              }
            : { ...state, status: 'unavailable', reason: outcome.reason || 'runtime-unavailable' };
          try {
            options.onUpdate?.(snapshot());
          } catch {
            /* Caller owns its logging. */
          }
        }
        return snapshot();
      })
      .catch(() => {
        if (!stopped && owner === generation)
          state = { ...state, status: 'unavailable', reason: 'runtime-unavailable' };
        return snapshot();
      })
      .finally(() => {
        if (inFlight === work) inFlight = null;
      });
    inFlight = work;
    return work;
  }

  /** Cancel a paused query; suppress its late results and allow a resumed refresh.
   * @returns {void}
   * @since 0.19.2-beta
   */
  function cancelRefresh() {
    generation++;
    const child = activeChild;
    cancel?.();
    inFlight = null;
    state = { ...state, attemptedAt: null };
    try {
      child?.kill('SIGKILL');
    } catch {
      /* Completed children need no cleanup. */
    }
  }

  /** Permanently stop the owner and kill only its active host CLI.
   * @returns {void}
   * @since 0.19.2-beta
   */
  function stop() {
    if (stopped) return;
    stopped = true;
    cancelRefresh();
  }
  return { refresh, snapshot, cancelRefresh, stop };
}

module.exports = { createWslInventory, parseWslOutput, resolveWslExecutable };
