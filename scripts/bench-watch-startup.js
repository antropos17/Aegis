/**
 * @file bench-watch-startup.js
 * @description Compare main-thread and worker-thread chokidar registration using
 *   disposable synthetic files. Diagnostic only; no timing threshold or product
 *   watcher replacement. Run: node scripts/bench-watch-startup.js [file-count].
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

/** @param {number} ms @returns {Promise<void>} @since v0.14.0 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} root @returns {Promise<object>} @since v0.14.0 */
async function register(root) {
  const start = performance.now();
  const watcher = require('chokidar').watch(root, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    followSymlinks: false,
    depth: 2,
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Watcher did not become ready in 30s')),
        30000,
      );
      watcher.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      watcher.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return {
      readyMs: performance.now() - start,
      watchedEntries: Object.values(watcher.getWatched()).reduce((n, names) => n + names.length, 0),
      close: () => watcher.close(),
    };
  } catch (error) {
    await watcher.close();
    throw error;
  }
}

/** @param {string} root @returns {Promise<object>} @since v0.14.0 */
function registerInWorker(root) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { root } });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Worker exited before ready: ${code}`)));
    worker.once('message', (result) =>
      resolve({
        ...result,
        close: () => worker.terminate(),
      }),
    );
  });
}

/** @param {string} root @param {boolean} inWorker @returns {Promise<object>} @since v0.14.0 */
async function measure(root, inWorker) {
  let last = performance.now();
  let maxHeartbeatGapMs = 0;
  let ticks = 0;
  let registration;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last);
    last = now;
    ticks++;
  }, 10);
  try {
    await sleep(30);
    const start = performance.now();
    registration = await (inWorker ? registerInWorker(root) : register(root));
    const wallReadyMs = performance.now() - start;
    // Include the heartbeat delayed by the final registration turn; exclude close.
    await sleep(20);
    return {
      mode: inWorker ? 'worker' : 'main',
      wallReadyMs,
      registrationMs: registration.readyMs,
      maxHeartbeatGapMs,
      ticks,
      watchedEntries: registration.watchedEntries,
    };
  } finally {
    clearInterval(heartbeat);
    if (registration) await registration.close();
  }
}

/** @returns {Promise<void>} @since v0.14.0 */
async function main() {
  const count = Number(process.argv[2] || 3000);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) {
    throw new Error('file-count must be an integer from 1 to 10000');
  }
  const temp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, 'aegis-watch-startup-'));
  let failure;
  try {
    for (let i = 0; i < count; i++) {
      const dir = path.join(root, `fixture-${Math.floor(i / 100)}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `config-${i}.json`), '{}');
    }
    const direct = await measure(root, false);
    const worker = await measure(root, true);
    const expected = count + Math.ceil(count / 100) + 1;
    if (direct.watchedEntries !== expected || worker.watchedEntries !== expected) {
      throw new Error('A registration missed fixture entries; timing comparison is invalid');
    }
    process.stdout.write(
      JSON.stringify({ node: process.version, platform: process.platform, count, direct, worker }) +
        '\n',
    );
  } catch (error) {
    failure = error;
  }
  try {
    const resolved = fs.realpathSync(root);
    if (
      path.dirname(resolved) !== temp ||
      !path.basename(resolved).startsWith('aegis-watch-startup-')
    ) {
      throw new Error('Refusing cleanup outside the generated temporary fixture');
    }
    fs.rmSync(resolved, { recursive: true });
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], 'Probe and cleanup failed') : error;
  }
  if (failure) throw failure;
}

if (isMainThread) {
  main().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
} else {
  register(workerData.root).then(({ readyMs, watchedEntries }) => {
    parentPort.postMessage({ readyMs, watchedEntries });
  });
}
