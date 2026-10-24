'use strict';

const { spawn } = require('node:child_process');
const { exact, createPipe } = require('./claude-hook-windows-io-wire');
const { failure, privateMode, qualifyAssets } = require('./session-context-windows-assets');
const MAX_BYTES = 512 * 1024;
const STAMP_KEYS = [
  'kind',
  'symlink',
  'reparse',
  'volumeId',
  'fileId',
  'size',
  'mtimeNs',
  'ctimeNs',
];
const bounded = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

function stamp(value, maxSize) {
  if (
    !exact(value, ['id', 'ok', ...STAMP_KEYS]) ||
    value.kind !== 'regular' ||
    value.symlink !== false ||
    value.reparse !== false ||
    typeof value.volumeId !== 'string' ||
    typeof value.fileId !== 'string' ||
    !/^[a-f0-9]{16}$/.test(value.volumeId) ||
    !/^[a-f0-9]{32}$/.test(value.fileId) ||
    /^0+$/.test(value.volumeId) ||
    /^0+$/.test(value.fileId) ||
    !bounded(value.size, 0, maxSize) ||
    ['mtimeNs', 'ctimeNs'].some(
      (key) =>
        typeof value[key] !== 'string' ||
        !/^(?:0|[1-9]\d{0,19})$/.test(value[key]) ||
        BigInt(value[key]) > 18446744073709551615n,
    )
  )
    throw failure();
  return Object.freeze(Object.fromEntries(STAMP_KEYS.map((key) => [key, value[key]])));
}

/** Create one lazily launched, bounded Windows explicit-stable-file provider.
 * This private API never discovers files or verifies session/process provenance.
 * @param {object} options Fixed asset pins and request/session/cleanup bounds.
 * @returns {object} Exact reader provider plus idempotent cleanup/status. @since v0.19.3 */
function createWindowsSessionContextIO(options) {
  privateMode();
  if (
    !exact(options, ['assets', 'requestMs', 'sessionMs', 'cleanupMs']) ||
    !bounded(options.requestMs, 100, 10000) ||
    !bounded(options.sessionMs, options.requestMs, 180000) ||
    !bounded(options.cleanupMs, 100, 5000)
  )
    throw failure();
  // Asset qualification occurs before any private path is accepted. No caller
  // selected executable, assembly, args, cwd, environment or spawn callback.
  const assets = qualifyAssets(options.assets);
  let pipe = null,
    started = false,
    ended = false,
    cleanup = null,
    unknown = false;
  let selected = null,
    tailMode = null,
    opened = false,
    pathStats = 0,
    handleStats = 0,
    reads = 0;
  let position = 0,
    transferred = 0,
    eof = false,
    initial = null;
  const confirmed = () =>
    !unknown &&
    (!started || (ended && cleanup?.exit === 'confirmed' && cleanup?.streams === 'confirmed'));
  const status = () => Object.freeze({ started, closed: confirmed(), unknown });
  async function close() {
    ended = true;
    if (pipe) {
      try {
        cleanup = await pipe.close();
      } catch {
        unknown = true;
        throw failure();
      }
      if (cleanup.exit !== 'confirmed' || cleanup.streams !== 'confirmed') unknown = true;
    }
    if (!confirmed()) throw failure();
  }
  async function operation(body, check, admit = () => {}) {
    try {
      privateMode();
      if (ended) throw failure();
      admit();
      const value = await pipe.request(body);
      privateMode();
      if (ended) throw failure();
      return check(value);
    } catch {
      try {
        await close();
      } catch {
        /* Sticky unknown. */
      }
      throw failure();
    }
  }
  const checkStamp = (value) => stamp(value, tailMode ? Number.MAX_SAFE_INTEGER : MAX_BYTES);
  async function statPath(file, tail) {
    try {
      privateMode();
      if (ended || typeof file !== 'string') throw failure();
      if (!started) {
        if (!/^[A-Z]:\\/.test(file) || file.length > 240) throw failure();
        privateMode();
        const child = spawn(assets.executable, [], {
          cwd: assets.cwd,
          env: assets.env,
          windowsHide: true,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        started = true;
        pipe = createPipe(child, options);
        selected = file;
        tailMode = tail;
        pathStats++;
        initial = await operation({ op: tail ? 'tail' : 'open', path: file }, checkStamp);
        position = tail ? Math.max(0, initial.size - MAX_BYTES) : 0;
        return initial;
      }
      if (
        tail !== tailMode ||
        file !== selected ||
        ++pathStats !== 2 ||
        !opened ||
        !eof ||
        handleStats !== 2
      )
        throw failure();
      return await operation({ op: 'stat', scope: 'path' }, checkStamp);
    } catch {
      try {
        await close();
      } catch {
        /* Sticky unknown. */
      }
      throw failure();
    }
  }
  async function openRead(file, tail) {
    try {
      privateMode();
      if (ended || !started || opened || tail !== tailMode || file !== selected || pathStats !== 1)
        throw failure();
      opened = true;
      return Object.freeze({
        stat: () =>
          operation({ op: 'stat', scope: 'handle' }, checkStamp, () => {
            if (++handleStats > 2 || (handleStats === 2 && !eof)) throw failure();
          }),
        read: (target, offset, length, at) =>
          operation(
            { op: 'read', length, position: at },
            (value) => {
              if (
                !exact(value, ['id', 'ok', 'data']) ||
                typeof value.data !== 'string' ||
                value.data.length > Math.ceil(length / 3) * 4 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)
              )
                throw failure();
              const bytes = Buffer.from(value.data, 'base64');
              try {
                if (
                  bytes.length > length ||
                  bytes.length > MAX_BYTES - transferred ||
                  bytes.toString('base64') !== value.data ||
                  (position === initial.size
                    ? length !== 1 || bytes.length !== 0
                    : bytes.length === 0)
                )
                  throw failure();
                bytes.copy(target, offset);
                eof = position === initial.size;
                position += bytes.length;
                transferred += bytes.length;
                return bytes.length;
              } finally {
                bytes.fill(0);
              }
            },
            () => {
              if (
                !Buffer.isBuffer(target) ||
                !bounded(offset, 0, target.length) ||
                !bounded(length, 1, 64 * 1024) ||
                offset + length > target.length ||
                at !== position ||
                handleStats !== 1 ||
                eof ||
                ++reads > 17 ||
                (position === initial.size
                  ? length !== 1
                  : reads > 16 ||
                    length > initial.size - position ||
                    length > MAX_BYTES - transferred)
              )
                throw failure();
            },
          ),
        close: async () => {
          try {
            await operation({ op: 'close' }, (value) => {
              if (!exact(value, ['id', 'ok', 'closed']) || value.closed !== true) throw failure();
            });
          } finally {
            await close();
          }
        },
      });
    } catch {
      try {
        await close();
      } catch {
        /* Sticky unknown. */
      }
      throw failure();
    }
  }
  const provider = (tail) =>
    Object.freeze({
      pathStyle: 'win32',
      statPath: (file) => statPath(file, tail),
      openRead: (file) => openRead(file, tail),
    });
  return Object.freeze({
    files: provider(false),
    tailFiles: provider(true),
    close,
    status,
  });
}

module.exports = { createWindowsSessionContextIO };
