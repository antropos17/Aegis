'use strict';

const { spawn } = require('node:child_process');
const { debuglog, TextDecoder } = require('node:util');
const inspector = require('node:inspector');
const { IO_CONTRACT } = require('./claude-hook-writer');
const { exact, failure, qualifyAssets, createPipe } = require('./claude-hook-windows-io-wire');

const bounded = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
function privateMode() {
  // Effective flags survive env deletion; STREAM can print raw readable pipe chunks.
  if (
    process.execArgv.length ||
    inspector.url() ||
    ['child_process', 'stream', 'net', 'worker'].some((name) => debuglog(name).enabled) ||
    Object.entries(process.env).some(
      ([key, value]) =>
        value &&
        /^(NODE_OPTIONS|NODE_DEBUG|NODE_DEBUG_NATIVE|DOTNET_STARTUP_HOOKS|COREHOST_TRACE|DOTNET_HOST_TRACE)$/i.test(
          key,
        ),
    ) ||
    process.report?.reportOnFatalError ||
    process.report?.reportOnSignal ||
    process.report?.reportOnUncaughtException
  )
    throw failure();
}
function encoded(bytes, max) {
  if (!Buffer.isBuffer(bytes) || bytes.length > max) throw failure();
  return bytes.toString('base64');
}
function decoded(value, max) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw failure();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > max || bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw failure();
  }
  return bytes;
}

/**
 * Create a PRIVATE Windows fixture-only IO session over an explicit owned inert file.
 * No caller, discovery, hook execution, reference import, restore or cleanup exists.
 * Owner-pinned assets and stable trusted load directories are prerequisites.
 * @param {object} options Explicit ownedFixture/targetPath/new backupRoot/assets and bounded limits.
 * @returns {Promise<object>} Four writer IO callbacks, bounded close and sanitized status.
 * @since v0.19.3
 */
async function createWindowsHookIO(options) {
  let pipe;
  try {
    privateMode();
    if (
      !exact(options, [
        'ownedFixture',
        'targetPath',
        'backupRoot',
        'assets',
        'requestMs',
        'sessionMs',
        'cleanupMs',
      ]) ||
      options.ownedFixture !== true ||
      typeof options.targetPath !== 'string' ||
      typeof options.backupRoot !== 'string' ||
      !/^[A-Z]:\\/.test(options.targetPath) ||
      options.targetPath.length > 240 ||
      options.backupRoot.length > 180 ||
      !/^[A-Z]:\\/.test(options.backupRoot) ||
      !bounded(options.requestMs, 100, 10000) ||
      !bounded(options.sessionMs, options.requestMs, 180000) ||
      !bounded(options.cleanupMs, 100, 5000)
    )
      throw failure();
    const assets = qualifyAssets(options.assets);
    // Recheck after hashing, before spawn: private data is never supplied in argv/env.
    privateMode();
    const child = spawn(assets.executable, assets.args, {
      cwd: assets.cwd,
      env: assets.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    pipe = createPipe(child, options);
    const opened = await pipe.request({
      op: 'open',
      target: options.targetPath,
      backupRoot: options.backupRoot,
    });
    if (!exact(opened, ['id', 'ok', 'protocol']) || opened.protocol !== 1) throw failure();
    const references = new WeakMap();
    let busy = false;
    const operation = async (body, validate) => {
      if (busy) throw failure();
      busy = true;
      try {
        privateMode();
        const response = await pipe.request(body);
        return validate(response);
      } catch {
        await pipe.close();
        throw failure();
      } finally {
        busy = false;
      }
    };
    const io = {
      contract: IO_CONTRACT,
      async readTarget() {
        return operation({ op: 'read' }, (value) => {
          if (
            !exact(value, ['id', 'ok', 'identity', 'bytes']) ||
            typeof value.identity !== 'string' ||
            !/^[a-f0-9]{16}:[a-f0-9]{32}$/.test(value.identity)
          )
            throw failure();
          return { identity: value.identity, bytes: decoded(value.bytes, 262144) };
        });
      },
      async retainPrivate(record) {
        if (
          !exact(record, ['bytes', 'manifest']) ||
          typeof record.manifest !== 'string' ||
          Buffer.byteLength(record.manifest) > 16384 ||
          new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(record.manifest)) !==
            record.manifest
        )
          throw failure();
        return operation(
          {
            op: 'retain',
            bytes: encoded(record.bytes, 262144),
            manifest: Buffer.from(record.manifest).toString('base64'),
          },
          (value) => {
            if (!exact(value, ['id', 'ok', 'reference']) || !bounded(value.reference, 1, 8))
              throw failure();
            const ref = Object.freeze({});
            references.set(ref, value.reference);
            return ref;
          },
        );
      },
      async readPrivate(ref) {
        if (!ref || typeof ref !== 'object' || !references.has(ref)) throw failure();
        return operation({ op: 'backup', reference: references.get(ref) }, (value) => {
          if (!exact(value, ['id', 'ok', 'bytes', 'manifest'])) throw failure();
          const bytes = decoded(value.bytes, 262144),
            manifest = decoded(value.manifest, 16384);
          try {
            return { bytes, manifest: new TextDecoder('utf-8', { fatal: true }).decode(manifest) };
          } catch {
            bytes.fill(0);
            throw failure();
          } finally {
            manifest.fill(0);
          }
        });
      },
      async compareAndWrite(value) {
        if (
          !exact(value, ['identity', 'beforeBytes', 'afterBytes']) ||
          typeof value.identity !== 'string' ||
          value.identity.length > 256
        )
          throw failure();
        return operation(
          {
            op: 'commit',
            identity: value.identity,
            before: encoded(value.beforeBytes, 262144),
            after: encoded(value.afterBytes, 262144),
          },
          (result) => {
            if (
              !exact(result, ['id', 'ok', 'outcome']) ||
              !['written', 'stale'].includes(result.outcome)
            )
              throw failure();
            return result.outcome;
          },
        );
      },
      close: () => pipe.close(),
      status: () => pipe.status(),
    };
    return Object.freeze(io);
  } catch {
    if (pipe) await pipe.close();
    throw failure();
  }
}

module.exports = { createWindowsHookIO };
