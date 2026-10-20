/** @file watch-worker-thread.js @description Native chokidar ownership outside Electron's main thread. */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const chokidar = require('chokidar');
const path = require('node:path');
const { createQueue } = require('./watch-event-queue');

if (parentPort) {
  const queue = createQueue((batch) => parentPort.postMessage(batch));
  const { ignoredDirectories, ignorePackageLock, basenamePrefix, startupProgress, ...options } =
    workerData.options;
  let scanned = 0;
  let reported = 0;
  // Only actual initial traversal activity renews the parent's idle deadline.
  // Counts are coalesced through the same bounded, acknowledged control channel.
  const progressTimer = startupProgress
    ? setInterval(() => {
        if (scanned === reported) return;
        reported = scanned;
        queue.progress(scanned);
      }, 1000)
    : null;
  const roots =
    ignoredDirectories || basenamePrefix
      ? [workerData.paths].flat().map((root) => path.resolve(root))
      : [];
  if (ignoredDirectories || ignorePackageLock || basenamePrefix || startupProgress) {
    options.ignored = (filePath, stats) => {
      if (startupProgress) scanned++;
      if (basenamePrefix) {
        const resolved = path.resolve(filePath);
        // Chokidar probes with and without stats; never exclude the watched root.
        if (!roots.includes(resolved)) {
          const directFile = roots.some((root) => path.dirname(resolved) === root);
          const basename = filePath.split(/[/\\]/).pop();
          if (!directFile || !basename.startsWith(basenamePrefix) || stats?.isDirectory()) {
            return true;
          }
        }
      }
      // Directory descriptors apply below a watched root, never to its name or
      // ancestors. An explicitly watched nested root can admit its own children.
      const relativePaths = roots
        .map((root) => path.relative(root, path.resolve(filePath)))
        .filter(
          (relative) =>
            relative !== '..' &&
            !relative.startsWith('..' + path.sep) &&
            !path.isAbsolute(relative),
        );
      return (
        (ignorePackageLock && /package-lock\.json$/.test(filePath)) ||
        (relativePaths.length > 0 &&
          relativePaths.every((relative) => {
            const childPath = relative ? path.sep + relative : '';
            return (ignoredDirectories || []).some(
              (dir) =>
                childPath.includes('/' + dir + '/') ||
                childPath.includes('\\' + dir + '\\') ||
                childPath.endsWith('/' + dir) ||
                childPath.endsWith('\\' + dir),
            );
          }))
      );
    };
  }
  try {
    const watcher = chokidar.watch(workerData.paths, options);
    for (const type of ['add', 'change', 'unlink']) {
      watcher.on(type, (path) => queue.event(type, path));
    }
    watcher.on('ready', () => {
      clearInterval(progressTimer);
      queue.ready();
    });
    watcher.on('error', () => {
      clearInterval(progressTimer);
      queue.error();
    });
    parentPort.on('message', (message) => {
      if (message?.type === 'ack') queue.ack(message.seq);
    });
    // The client terminates this dedicated worker on close. Node disposes all
    // worker-owned native handles, including a registration still in progress.
  } catch (_) {
    clearInterval(progressTimer);
    queue.error();
  }
}
