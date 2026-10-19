'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { TextDecoder } = require('node:util');
const MAX_FRAME = 768 * 1024;
/** @returns {Error} Fixed private failure. @since v0.19.3 */
const failure = () => Error('private-windows-io-failed');
/** @param {object} value Private schema input. @param {string[]} keys Exact keys.
 * @returns {boolean} Whether the schema keys match. @since v0.19.3 */
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function ordinary(selected, directory) {
  if (
    typeof selected !== 'string' ||
    !/^[A-Z]:\\/.test(selected) ||
    selected.length > 260 ||
    [...selected].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.win32.normalize(selected) !== selected
  )
    throw failure();
  let cursor = selected;
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (
      stat.isSymbolicLink() ||
      (cursor === selected
        ? directory
          ? !stat.isDirectory()
          : !stat.isFile()
        : !stat.isDirectory())
    )
      throw failure();
    const parent = path.win32.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function bindFolder(root, pins, maxFiles, maxBytes) {
  ordinary(root, true);
  if (!Array.isArray(pins) || !pins.length || pins.length > maxFiles) throw failure();
  const expected = new Map();
  for (const pin of pins) {
    if (
      !exact(pin, ['name', 'sha256']) ||
      typeof pin.name !== 'string' ||
      !/^[A-Za-z0-9_.-]+$/.test(pin.name) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      expected.has(pin.name)
    )
      throw failure();
    expected.set(pin.name, pin.sha256);
  }
  const names = fs.readdirSync(root);
  if (names.length !== expected.size) throw failure();
  let total = 0;
  for (const name of names) {
    if (!expected.has(name)) throw failure();
    const selected = path.win32.join(root, name);
    ordinary(selected, false);
    const size = fs.statSync(selected).size;
    total += size;
    if (size > 64 * 1024 * 1024 || total > maxBytes) throw failure();
    const bytes = fs.readFileSync(selected);
    try {
      if (createHash('sha256').update(bytes).digest('hex') !== expected.get(name)) throw failure();
    } finally {
      bytes.fill(0);
    }
  }
  return names;
}

/** Bind explicit owner-pinned host and existing framework assets before launch.
 * Trusted filesystem stability remains the caller's responsibility during load.
 * @param {object} assets Exact host folder and explicit runtime/version/hash pins.
 * @returns {{executable: string, args: string[], cwd: string, env: object}} Private spawn input.
 * @since v0.19.3 */
function qualifyAssets(assets) {
  try {
    if (
      !exact(assets, [
        'hostRoot',
        'hostFiles',
        'runtimeRoot',
        'runtimeVersion',
        'runtimeFiles',
        'hostFxrSha256',
        'executableSha256',
      ]) ||
      assets.runtimeVersion !== '10.0.10'
    )
      throw failure();
    const hostNames = bindFolder(assets.hostRoot, assets.hostFiles, 5, 4 * 1024 * 1024);
    const required = [
      'HookTransaction.dll',
      'HookTransaction.deps.json',
      'HookTransaction.runtimeconfig.json',
      'HookConfigTarget.dll',
      'HookPrivateBackup.dll',
    ];
    if (hostNames.length !== required.length || required.some((name) => !hostNames.includes(name)))
      throw failure();
    const runtimeRoot = assets.runtimeRoot;
    ordinary(runtimeRoot, true);
    bindFolder(
      path.win32.join(runtimeRoot, 'shared', 'Microsoft.NETCore.App', assets.runtimeVersion),
      assets.runtimeFiles,
      256,
      128 * 1024 * 1024,
    );
    const executable = path.win32.join(runtimeRoot, 'dotnet.exe');
    const fxrRoot = path.win32.join(runtimeRoot, 'host', 'fxr');
    ordinary(fxrRoot, true);
    const versions = fs.readdirSync(fxrRoot);
    if (
      versions.some((version) => !/^\d+\.\d+\.\d+$/.test(version)) ||
      versions.some(
        (version) => version.localeCompare(assets.runtimeVersion, undefined, { numeric: true }) > 0,
      )
    )
      throw failure();
    for (const [selected, digest] of [
      [executable, assets.executableSha256],
      [path.win32.join(fxrRoot, assets.runtimeVersion, 'hostfxr.dll'), assets.hostFxrSha256],
    ]) {
      ordinary(selected, false);
      if (
        !/^[a-f0-9]{64}$/.test(digest) ||
        fs.statSync(selected).size > 8 * 1024 * 1024 ||
        createHash('sha256').update(fs.readFileSync(selected)).digest('hex') !== digest
      )
        throw failure();
    }
    const config = JSON.parse(
      fs.readFileSync(
        path.win32.join(assets.hostRoot, 'HookTransaction.runtimeconfig.json'),
        'utf8',
      ),
    );
    if (
      !exact(config, ['runtimeOptions']) ||
      !exact(config.runtimeOptions, ['tfm', 'rollForward', 'framework', 'configProperties']) ||
      !exact(config.runtimeOptions.framework, ['name', 'version']) ||
      !exact(config.runtimeOptions.configProperties, [
        'System.Reflection.Metadata.MetadataUpdater.IsSupported',
        'System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization',
        'CSWINRT_USE_WINDOWS_UI_XAML_PROJECTIONS',
      ]) ||
      Object.values(config.runtimeOptions.configProperties).some((value) => value !== false) ||
      config.runtimeOptions.tfm !== 'net10.0' ||
      config.runtimeOptions.framework.name !== 'Microsoft.NETCore.App' ||
      config.runtimeOptions.framework.version !== assets.runtimeVersion ||
      config.runtimeOptions.rollForward !== 'Disable'
    )
      throw failure();
    return {
      executable,
      args: [
        'exec',
        '--fx-version',
        assets.runtimeVersion,
        '--roll-forward',
        'Disable',
        path.win32.join(assets.hostRoot, 'HookTransaction.dll'),
      ],
      cwd: assets.hostRoot,
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.SystemRoot,
        DOTNET_ROOT: runtimeRoot,
        DOTNET_MULTILEVEL_LOOKUP: '0',
        DOTNET_ROLL_FORWARD: 'Disable',
        DOTNET_EnableDiagnostics: '0',
        COMPlus_EnableDiagnostics: '0',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
      },
    };
  } catch {
    throw failure();
  }
}

/** One outstanding bounded private frame on an original ChildProcess handle.
 * Every transport ambiguity closes admission and awaits bounded termination/drain.
 * @param {import('node:child_process').ChildProcessWithoutNullStreams} child Owned child.
 * @param {{requestMs: number, sessionMs: number, cleanupMs: number}} limits Monotonic bounds.
 * @returns {object} Private request, close and sanitized status API.
 * @since v0.19.3 */
function createPipe(child, limits) {
  let closed = false,
    nextId = 1,
    pending = null,
    input = Buffer.alloc(0),
    bytesSeen = 0;
  let exited = false,
    streams = 0,
    forcedDrain = false,
    cleanupPromise = null,
    cleanupResolve,
    cleanupResult = null,
    drainBytes = 0;
  const deadline = performance.now() + limits.sessionMs;
  const status = () =>
    cleanupResult ||
    Object.freeze({
      admission: closed ? 'closed' : 'open',
      exit: exited ? 'confirmed' : 'unknown',
      streams: streams === 3 && !forcedDrain ? 'confirmed' : 'unknown',
    });
  const settleCleanup = () => {
    if (exited && streams === 3 && cleanupResolve && !cleanupResult) {
      cleanupResult = status();
      cleanupResolve(cleanupResult);
    }
  };
  for (const stream of [child.stdin, child.stdout, child.stderr])
    stream.once('close', () => {
      streams++;
      settleCleanup();
    });
  child.once('exit', () => {
    exited = true;
    settleCleanup();
  });
  child.once('error', () => {
    void terminate();
  });
  child.once('close', () => {
    if (!closed) void terminate();
    settleCleanup();
  });
  child.stdout.once('end', () => {
    if (!closed) void terminate();
  });
  const sessionTimer = setTimeout(() => {
    void terminate();
  }, limits.sessionMs);

  function terminate() {
    if (cleanupPromise) return cleanupPromise;
    closed = true;
    clearTimeout(sessionTimer);
    cleanupPromise = new Promise((resolve) => {
      cleanupResolve = resolve;
    });
    const timer = setTimeout(() => {
      if (!cleanupResult) {
        cleanupResult = status();
        cleanupResolve(cleanupResult);
      }
    }, limits.cleanupMs);
    cleanupPromise.then(() => clearTimeout(timer));
    const waiting = pending;
    pending = null;
    if (waiting) {
      clearTimeout(waiting.timer);
      cleanupPromise.then(() => waiting.reject(failure()));
    }
    input.fill(0);
    input = Buffer.alloc(0);
    child.stdin.destroy();
    // ChildProcess.kill uses this original native child handle; no PID lookup/reuse cleanup.
    try {
      if (!exited) child.kill('SIGKILL');
    } catch {
      /* Unknown remains fixed and retained. */
    }
    settleCleanup();
    return cleanupPromise;
  }
  child.stdin.on('error', () => {
    void terminate();
  });
  child.stdout.on('error', () => {
    void terminate();
  });
  child.stderr.on('error', () => {
    void terminate();
  });
  child.stderr.on('data', (chunk) => {
    drainBytes += chunk.length;
    void terminate();
    if (drainBytes > MAX_FRAME * 2) {
      forcedDrain = true;
      child.stderr.destroy();
    }
  });
  child.stdout.on('data', (chunk) => {
    bytesSeen += chunk.length;
    if (bytesSeen > 16 * 1024 * 1024) {
      forcedDrain = true;
      child.stdout.destroy();
      void terminate();
      return;
    }
    if (closed) {
      drainBytes += chunk.length;
      if (drainBytes > MAX_FRAME * 2) {
        forcedDrain = true;
        child.stdout.destroy();
      }
      return;
    }
    if (
      !pending ||
      performance.now() >= pending.expiresAt ||
      input.length + chunk.length > MAX_FRAME + 4
    ) {
      void terminate();
      return;
    }
    const combined = Buffer.concat([input, chunk]);
    input.fill(0);
    input = combined;
    if (input.length < 4) return;
    const count = input.readUInt32LE(0);
    if (!count || count > MAX_FRAME || input.length > count + 4) {
      void terminate();
      return;
    }
    if (input.length < count + 4) return;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(4));
      // The host emits flat compact JSON. Reject duplicate/escaped keys before JSON.parse.
      const token =
        /"([A-Za-z]+)":(?:true|false|[0-9]+|"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*")/y;
      const keys = new Set();
      let cursor = 1;
      if (text[0] !== '{' || text.at(-1) !== '}') throw failure();
      while (cursor < text.length - 1) {
        token.lastIndex = cursor;
        const match = token.exec(text);
        if (!match || keys.has(match[1])) throw failure();
        keys.add(match[1]);
        cursor = token.lastIndex;
        if (cursor < text.length - 1 && text[cursor++] !== ',') throw failure();
        if (text[cursor] === '}' && text[cursor - 1] === ',') throw failure();
      }
      const value = JSON.parse(text);
      if (!value || value.id !== pending.id || typeof value.ok !== 'boolean') throw failure();
      if (performance.now() >= pending.expiresAt) throw failure();
      const waiting = pending;
      clearTimeout(waiting.timer);
      input.fill(0);
      input = Buffer.alloc(0);
      pending = null;
      if (!value.ok) {
        pending = waiting;
        void terminate();
        return;
      }
      waiting.resolve(value);
    } catch {
      void terminate();
    }
  });
  const request = (body) => {
    if (closed || pending) return Promise.reject(failure());
    if (nextId > 128 || performance.now() >= deadline)
      return terminate().then(() => {
        throw failure();
      });
    const id = nextId++;
    let frame;
    try {
      const payload = Buffer.from(JSON.stringify({ id, ...body }));
      if (!payload.length || payload.length > MAX_FRAME) {
        payload.fill(0);
        throw failure();
      }
      frame = Buffer.allocUnsafe(payload.length + 4);
      frame.writeUInt32LE(payload.length);
      payload.copy(frame, 4);
      payload.fill(0);
    } catch {
      return Promise.reject(failure());
    }
    return new Promise((resolve, reject) => {
      const expiresAt = Math.min(performance.now() + limits.requestMs, deadline);
      const timer = setTimeout(
        () => {
          void terminate();
        },
        Math.max(1, expiresAt - performance.now()),
      );
      pending = { id, resolve, reject, timer, expiresAt };
      child.stdin.write(frame, (error) => {
        frame.fill(0);
        if (error) void terminate();
      });
    });
  };
  return { request, close: terminate, status };
}

module.exports = { MAX_FRAME, exact, failure, qualifyAssets, createPipe };
