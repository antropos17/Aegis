'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const MAX_BYTES = 16384;
const SCHEMA = 'aegis-project-watch/1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) =>
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key]);
const inside = (value, base) => {
  const rel = path.relative(base, value);
  return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};

function ordinary(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 4096 ||
    /^[\\/]{2}/.test(value) ||
    /\p{Cc}/u.test(value)
  )
    throw Error('directory-unavailable');
  const absolute = path.resolve(value);
  let cursor = absolute,
    count = 0,
    first;
  for (;;) {
    if (++count > 64) throw Error('directory-unavailable');
    const stat = fs.lstatSync(cursor, { bigint: true });
    if (!first) first = stat;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('directory-unavailable');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const canonical = fs.realpathSync(absolute);
  const stat = fs.lstatSync(canonical, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.ino === 0n ||
    first.dev !== stat.dev ||
    first.ino !== stat.ino
  )
    throw Error('directory-unavailable');
  return { path: canonical, device: String(stat.dev), file: String(stat.ino) };
}

/** Own one private, persisted project selection; renderer operations never supply a path.
 * @param {object} options Trusted app paths, dialog/window, change callback and optional boundary fixtures.
 * @returns {object} Closed control operations and main-only watch-root capability. @since v0.21.0 */
function createProjectWatchSelection(options) {
  const { userData, dialog, getWindow, onChanged = () => {}, home = os.homedir() } = options;
  const storage = path.join(userData, 'project-watch-selection.json');
  const blockedTrees = [
    userData,
    path.join(home, 'AppData'),
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    ...(process.platform === 'win32'
      ? []
      : ['/etc', '/proc', '/sys', '/dev', '/usr', '/bin', '/sbin', '/var', '/System', '/Library']),
    ...(options.blockedTrees || []),
  ].filter((p) => typeof p === 'string' && path.isAbsolute(p));
  let loaded = false,
    selection = null,
    invalid = false,
    storeHash = null,
    available = false;
  let closed = false,
    busy = false;
  function readStore() {
    ordinary(userData);
    let before;
    try {
      before = fs.lstatSync(storage, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_BYTES)
    )
      throw Error('store-unavailable');
    let fd, bytes;
    try {
      fd = fs.openSync(
        storage,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
      );
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!same(before, opened)) throw Error('store-unavailable');
      bytes = Buffer.alloc(Number(before.size) + 1);
      let length = 0,
        count;
      while ((count = fs.readSync(fd, bytes, length, bytes.length - length, length)) > 0)
        length += count;
      if (
        length !== Number(before.size) ||
        !same(opened, fs.fstatSync(fd, { bigint: true })) ||
        !same(opened, fs.lstatSync(storage, { bigint: true }))
      )
        throw Error('store-unavailable');
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
        hash: digest(bytes.subarray(0, length)),
      };
    } finally {
      bytes?.fill(0);
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const stored = readStore();
      if (!stored) return;
      storeHash = stored.hash;
      const body = JSON.parse(stored.text);
      if (stored.text !== JSON.stringify(body) + '\n') throw Error('store-unavailable');
      if (
        !body ||
        Object.keys(body).sort().join(',') !== 'schema,selection' ||
        body.schema !== SCHEMA
      )
        throw Error('store-unavailable');
      const root = body.selection;
      if (
        root !== null &&
        (!root ||
          Object.keys(root).sort().join(',') !== 'device,file,path' ||
          typeof root.path !== 'string' ||
          root.path.length > 4096 ||
          ![root.device, root.file].every((v) => typeof v === 'string' && /^\d{1,128}$/.test(v)))
      )
        throw Error('store-unavailable');
      selection = root;
    } catch {
      invalid = true;
    }
  }
  function validate(value) {
    const root = ordinary(value);
    if (
      root.path === path.parse(root.path).root ||
      inside(home, root.path) ||
      path.dirname(root.path) === path.dirname(path.resolve(home)) ||
      blockedTrees.some(
        (base) => inside(root.path, path.resolve(base)) || inside(path.resolve(base), root.path),
      )
    )
      throw Error('directory-refused');
    return root;
  }
  function inspect(notify = false) {
    load();
    const previous = available;
    available = false;
    if (!closed && !invalid && selection) {
      try {
        const current = validate(selection.path);
        available =
          current.path === selection.path &&
          current.device === selection.device &&
          current.file === selection.file;
      } catch {
        /* A missing or replaced root never chooses a fallback. */
      }
    }
    if (notify && previous !== available) onChanged();
    return invalid || selection ? (available ? 'SELECTED' : 'UNAVAILABLE') : 'UNSELECTED';
  }
  function status(code = inspect()) {
    return {
      success: true,
      code,
      selected: invalid || !!selection,
      available: !closed && available,
    };
  }
  function persist(next) {
    const current = readStore();
    if ((current?.hash || null) !== storeHash) throw Error('store-changed');
    const bytes = Buffer.from(JSON.stringify({ schema: SCHEMA, selection: next }) + '\n');
    if (bytes.length > MAX_BYTES) {
      bytes.fill(0);
      throw Error('store-unavailable');
    }
    const temporary = storage + '.' + randomUUID() + '.tmp';
    let cleanupError;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, storage);
      storeHash = digest(bytes);
      selection = next;
      invalid = false;
      available = !!next;
    } finally {
      bytes.fill(0);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') cleanupError = error;
      }
    }
    if (cleanupError) throw Error('store-unavailable', { cause: cleanupError });
  }
  async function handle(action, guard) {
    if (!['status', 'select', 'clear'].includes(action))
      return { success: false, error: 'Invalid project-watch operation' };
    const window = getWindow?.();
    const owned = () =>
      !closed && window && !window.isDestroyed() && getWindow() === window && guard?.() === true;
    if (!owned()) return { success: false, error: 'Renderer request denied' };
    if (busy) return status('BUSY');
    busy = true;
    try {
      inspect(true);
      if (action === 'status') return status();
      let next = null;
      if (action === 'select') {
        const chosen = await dialog.showOpenDialog(window, {
          title: 'Choose one project folder to monitor',
          properties: ['openDirectory'],
        });
        if (!owned()) return { success: false, error: 'Renderer request denied' };
        if (chosen.canceled) return status('CANCELLED');
        if (chosen.filePaths?.length !== 1) return status('DIRECTORY_REFUSED');
        try {
          next = validate(chosen.filePaths[0]);
        } catch {
          return status('DIRECTORY_REFUSED');
        }
      }
      if (!owned()) return { success: false, error: 'Renderer request denied' };
      persist(next);
      onChanged();
      return status(next ? 'SELECTED' : 'UNSELECTED');
    } catch {
      return status('STORE_UNAVAILABLE');
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    handle,
    getWatchKey() {
      const state = inspect();
      return digest(JSON.stringify([selection, invalid, state === 'UNAVAILABLE']));
    },
    async resolveRoot() {
      const state = inspect(true);
      const bound = selection;
      return state === 'SELECTED'
        ? {
            state: 'selected',
            path: bound.path,
            isCurrent: () =>
              inspect() === 'SELECTED' &&
              selection?.path === bound.path &&
              selection.device === bound.device &&
              selection.file === bound.file,
          }
        : { state: state === 'UNSELECTED' ? 'unselected' : 'unavailable' };
    },
    close() {
      closed = true;
    },
  });
}

module.exports = { createProjectWatchSelection };
