// @ts-check
'use strict';

const path = require('node:path');
const MAX_BYTES = 512 * 1024;
const CHUNK_BYTES = 64 * 1024;
const KEYS = ['kind', 'symlink', 'reparse', 'volumeId', 'fileId', 'size', 'mtimeNs', 'ctimeNs'];
const SELECTION_KEYS = ['sessionId', 'cwd', 'platform', 'format', 'headTruncated', 'tailTruncated'];

/** @typedef {{kind:string,symlink:boolean,reparse:boolean,volumeId:string,fileId:string,size:number,mtimeNs:string,ctimeNs:string}} FileStamp */
/** @typedef {{stat:()=>Promise<unknown>,read:(target:Buffer,offset:number,length:number,position:number)=>Promise<number>,close:()=>Promise<void>}} ReadHandle */
/** @typedef {{pathStyle:'win32'|'posix',statPath:(file:string)=>Promise<unknown>,openRead:(file:string)=>Promise<ReadHandle>}} FileProvider */
/** @typedef {{parse:(source:string,bytes:Buffer|null,selection:object)=>object}} Adapter */
/** @typedef {{sessionId:string,cwd:string,platform:'win32'|'posix',format?:'json'|'jsonl',headTruncated?:boolean,tailTruncated?:boolean}} Selection */

/** Copy only inert selection fields before caller-owned asynchronous IO starts.
 * Invalid scalar values remain for the adapter's existing validation. Accessors
 * and reference values cannot change which selection is parsed after an await.
 * @param {Selection} selection @returns {Readonly<Selection>}
 */
function snapshotSelection(selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(selection);
  const selected = /** @type {Record<string, unknown>} */ ({});
  for (const key of SELECTION_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (
      !Object.hasOwn(descriptor, 'value') ||
      (descriptor.value !== null && ['object', 'function'].includes(typeof descriptor.value))
    )
      throw new Error();
    selected[key] = descriptor.value;
  }
  return Object.freeze(/** @type {Selection} */ (/** @type {unknown} */ (selected)));
}

/** Capture a provider-proved regular, non-link identity/version without references.
 * Unknown regularity, reparse state, identity or exact timestamps is unavailable.
 * @param {unknown} value @param {number} [maxSize] @returns {Readonly<FileStamp>|null}
 */
function stamp(value, maxSize = MAX_BYTES) {
  if (!value || typeof value !== 'object') return null;
  const own = Reflect.ownKeys(value),
    descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    own.length !== KEYS.length ||
    own.some((k) => typeof k !== 'string' || !KEYS.includes(k)) ||
    KEYS.some((k) => !descriptors[k] || !Object.hasOwn(descriptors[k], 'value'))
  )
    return null;
  const row = /** @type {Record<string,unknown>} */ (value);
  if (
    row.kind !== 'regular' ||
    row.symlink !== false ||
    row.reparse !== false ||
    typeof row.volumeId !== 'string' ||
    typeof row.fileId !== 'string' ||
    row.fileId === '0' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.volumeId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.fileId) ||
    typeof row.size !== 'number' ||
    !Number.isSafeInteger(row.size) ||
    row.size < 0 ||
    row.size > maxSize ||
    typeof row.mtimeNs !== 'string' ||
    typeof row.ctimeNs !== 'string' ||
    !/^(?:0|[1-9]\d{0,19})$/.test(row.mtimeNs) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(row.ctimeNs) ||
    BigInt(row.mtimeNs) > 18446744073709551615n ||
    BigInt(row.ctimeNs) > 18446744073709551615n
  )
    return null;
  return Object.freeze({
    kind: 'regular',
    symlink: false,
    reparse: false,
    volumeId: row.volumeId,
    fileId: row.fileId,
    size: row.size,
    mtimeNs: row.mtimeNs,
    ctimeNs: row.ctimeNs,
  });
}

/** @param {Readonly<FileStamp>|null} a @param {Readonly<FileStamp>|null} b @returns {boolean} */
function same(a, b) {
  return (
    a !== null &&
    b !== null &&
    KEYS.every(
      (k) => a[/** @type {keyof FileStamp} */ (k)] === b[/** @type {keyof FileStamp} */ (k)],
    )
  );
}

/** Reject aliases and ambiguous path namespaces without filesystem discovery.
 * This is lexical selection only, not proof against parent redirection.
 * @param {unknown} file @param {'win32'|'posix'} style @returns {file is string}
 */
function explicitPath(file, style) {
  if (
    typeof file !== 'string' ||
    file.length === 0 ||
    file.length > 4096 ||
    /[\p{Cc}\p{Cs}]/u.test(file)
  )
    return false;
  const parts = file.split(style === 'win32' ? /[/\\]/ : /\//);
  if (parts.some((part) => part === '.' || part === '..')) return false;
  if (style === 'posix') return path.posix.isAbsolute(file) && !file.startsWith('//');
  return (
    /^[A-Za-z]:[/\\]/.test(file) &&
    !/[<>"|?*:]|[. ]$/.test(file.slice(3)) &&
    parts
      .slice(1)
      .every(
        (part) =>
          !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      )
  );
}

/**
 * Create complete-file and opt-in JSONL tail readers through caller-owned IO.
 * No default fs/home discovery, runtime caller, logging, persistence or binding.
 * Providers must prove regularity/no links (including reparse points), stable
 * volume/file identity and exact version metadata on path and handle. openRead
 * must be read-only and reject following links as the platform can establish.
 * Unknown proof fails closed. Provider operations must bound their own duration;
 * byte/call limits here do not cancel IO or promise a total wall deadline.
 * Parent redirection or a write restored to identical metadata is not disproved.
 * Adapter.parse must be the trusted owner's synchronous metadata-only parser.
 * Buffer clearing is best effort for owned buffers, never secure erasure of JS
 * parser strings, copied data, kernel buffers or bytes retained by the provider.
 * Tail reads require positioned IO and large-file metadata from that provider;
 * each provider separately qualifies that IO and its stable-file custody boundary.
 * @param {{adapter:Adapter,files:FileProvider}} options Explicit owner dependencies.
 * @returns {{read:(source:string,file:string,selection:Selection)=>Promise<object>,readTail:(source:string,file:string,selection:Selection)=>Promise<object>}}
 * @since v0.19.2
 */
function createSessionContextReader(options) {
  if (
    !options ||
    typeof options.adapter?.parse !== 'function' ||
    !['win32', 'posix'].includes(options.files?.pathStyle) ||
    typeof options.files?.statPath !== 'function' ||
    typeof options.files?.openRead !== 'function'
  )
    throw new Error('session-reader-invalid-options');
  const { adapter, files } = options;

  /** Read explicitly selected bytes; failures pass null bytes.
   * @param {string} source @param {string} file @param {Selection} selection
   * @param {boolean} tail Whether the caller explicitly selected JSONL tail IO.
   * @returns {Promise<object>} Exact adapter projection, with no reader metadata.
   * @since v0.19.2
   */
  async function readSelected(source, file, selection, tail) {
    const selectedSource = ['claude-code', 'codex', 'gemini-cli'].includes(source)
      ? source
      : 'unsupported';
    /** @type {Buffer|null} */ let bytes = null,
      probe = null;
    /** @type {ReadHandle|null} */ let handle = null;
    /** @type {boolean} */ let complete;
    let selected = /** @type {Readonly<Selection>} */ (Object.freeze({})),
      start = 0;
    const maxSize = tail ? Number.MAX_SAFE_INTEGER : MAX_BYTES;
    try {
      selected = snapshotSelection(selection);
      if (
        selectedSource === 'unsupported' ||
        !explicitPath(file, files.pathStyle) ||
        (tail && selected.format !== 'jsonl') ||
        selected.headTruncated ||
        selected.tailTruncated
      )
        throw new Error();
      const before = stamp(await files.statPath(file), maxSize);
      if (!before) throw new Error();
      handle = await files.openRead(file);
      if (
        !handle ||
        typeof handle.stat !== 'function' ||
        typeof handle.read !== 'function' ||
        typeof handle.close !== 'function'
      )
        throw new Error();
      if (!same(before, stamp(await handle.stat(), maxSize))) throw new Error();
      start = Math.max(0, before.size - MAX_BYTES);
      if (start > 0) selected = Object.freeze({ ...selected, headTruncated: true });
      bytes = Buffer.alloc(before.size - start);
      probe = Buffer.alloc(1);
      let position = 0,
        calls = 0;
      while (position < bytes.length) {
        if (++calls > 16) throw new Error();
        const length = Math.min(CHUNK_BYTES, bytes.length - position);
        const count = await handle.read(bytes, position, length, start + position);
        if (!Number.isSafeInteger(count) || count <= 0 || count > length) throw new Error();
        position += count;
      }
      if ((await handle.read(probe, 0, 1, start + position)) !== 0) throw new Error();
      if (
        !same(before, stamp(await handle.stat(), maxSize)) ||
        !same(before, stamp(await files.statPath(file), maxSize))
      )
        throw new Error();
      complete = true;
    } catch {
      complete = false;
    } finally {
      probe?.fill(0);
      if (handle)
        try {
          await handle.close();
        } catch {
          complete = false;
        }
    }
    try {
      // Keep the first LF as an empty sentinel for the parser's head discard.
      // Decode only after removing the possibly split leading UTF-8 codepoint.
      const firstLine = start > 0 && bytes ? bytes.indexOf(10) : -1;
      const parsedBytes =
        start > 0 && bytes ? bytes.subarray(firstLine < 0 ? bytes.length : firstLine) : bytes;
      return adapter.parse(selectedSource, complete ? parsedBytes : null, selected);
    } catch {
      throw new Error('session-reader-unavailable');
    } finally {
      bytes?.fill(0);
    }
  }
  /** Read the complete selected file, up to 512 KiB.
   * @param {string} source @param {string} file @param {Selection} selection
   * @returns {Promise<object>} Exact metadata-only adapter projection.
   * @since v0.19.2
   */
  function read(source, file, selection) {
    return readSelected(source, file, selection, false);
  }

  /** Read at most the final 512 KiB of explicitly selected JSONL.
   * A removed leading byte line always makes the source incomplete. No session
   * headers or binding evidence are synthesized for a tail lacking them.
   * @param {string} source @param {string} file @param {Selection} selection
   * @returns {Promise<object>} Exact metadata-only adapter projection.
   * @since v0.20.1
   */
  function readTail(source, file, selection) {
    return readSelected(source, file, selection, true);
  }
  return Object.freeze({ read, readTail });
}

module.exports = { createSessionContextReader };
