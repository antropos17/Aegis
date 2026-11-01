'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { debuglog } = require('node:util');
const inspector = require('node:inspector');
const { loadProfileAssets } = require('./claude-hook-app-profile');
const { exact, failure, qualifyAssets, createPipe } = require('./claude-hook-windows-io-wire');

function privateMode() {
  if (
    process.execArgv.length ||
    inspector.url() ||
    process.report?.reportOnFatalError ||
    process.report?.reportOnSignal ||
    process.report?.reportOnUncaughtException ||
    ['child_process', 'stream', 'net', 'worker'].some((name) => debuglog(name).enabled) ||
    Object.entries(process.env).some(
      ([key, value]) =>
        value &&
        /^(NODE_OPTIONS|NODE_DEBUG|NODE_DEBUG_NATIVE|DOTNET_STARTUP_HOOKS|COREHOST_TRACE|DOTNET_HOST_TRACE)$/i.test(
          key,
        ),
    )
  )
    throw failure();
}

function assetsRoot() {
  if (process.resourcesPath) return path.join(process.resourcesPath, 'hook-review');
  const archive = __dirname.toLowerCase().indexOf('.asar' + path.sep);
  if (archive >= 0) return path.join(path.dirname(__dirname.slice(0, archive + 5)), 'hook-review');
  return path.resolve(__dirname, '..', '..', 'build', 'hook-review');
}

/** Open the prepared Windows native deletion capability before owner confirmation.
 * @param {string} target Selected absolute target. @returns {Promise<object>} One-shot private session.
 * @since v0.21.0 */
async function openWindowsDelete(target) {
  let pipe;
  try {
    privateMode();
    const selected = await loadProfileAssets(assetsRoot());
    if (!selected) throw failure();
    const assets = qualifyAssets(selected);
    privateMode();
    const child = spawn(assets.executable, assets.args, {
      cwd: assets.cwd,
      env: assets.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    pipe = createPipe(child, { requestMs: 10000, sessionMs: 90000, cleanupMs: 5000 });
    const opened = await pipe.request({
      op: 'open-delete',
      target: target.replace(/^[a-z](?=:)/, (c) => c.toUpperCase()),
    });
    if (!exact(opened, ['id', 'ok', 'protocol']) || opened.protocol !== 1) throw failure();
    let used = false;
    return {
      async commit() {
        if (used) throw failure();
        used = true;
        privateMode();
        const response = await pipe.request({ op: 'delete' });
        if (
          !exact(response, ['id', 'ok', 'outcome']) ||
          !['deleted', 'refused', 'unknown'].includes(response.outcome)
        )
          throw failure();
        return response.outcome;
      },
      async close() {
        const status = await pipe.close();
        return status.exit === 'confirmed' && status.streams === 'confirmed';
      },
    };
  } catch {
    if (pipe) await pipe.close();
    throw failure();
  }
}
module.exports = { openWindowsDelete };
