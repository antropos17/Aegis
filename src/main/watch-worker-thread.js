/** @file watch-worker-thread.js @description Native chokidar ownership outside Electron's main thread. */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const chokidar = require('chokidar');
const path = require('node:path');
const { createQueue } = require('./watch-event-queue');

if (parentPort) {
  const queue = createQueue((batch) => parentPort.postMessage(batch));
  const { ignoredDirectories, ignorePackageLock, basenamePrefix, ...options } = workerData.options;
  const roots = basenamePrefix ? [workerData.paths].flat().map((root) => path.resolve(root)) : [];
  if (ignoredDirectories || ignorePackageLock || basenamePrefix) {
    options.ignored = (filePath, stats) => {
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
      return (
        (ignorePackageLock && /package-lock\.json$/.test(filePath)) ||
        (ignoredDirectories || []).some(
          (dir) =>
            filePath.includes('/' + dir + '/') ||
            filePath.includes('\\' + dir + '\\') ||
            filePath.endsWith('/' + dir) ||
            filePath.endsWith('\\' + dir),
        )
      );
    };
  }
  try {
    const watcher = chokidar.watch(workerData.paths, options);
    for (const type of ['add', 'change', 'unlink']) {
      watcher.on(type, (path) => queue.event(type, path));
    }
    watcher.on('ready', () => queue.ready());
    watcher.on('error', () => queue.error());
    parentPort.on('message', (message) => {
      if (message?.type === 'ack') queue.ack(message.seq);
    });
    // The client terminates this dedicated worker on close. Node disposes all
    // worker-owned native handles, including a registration still in progress.
  } catch (_) {
    queue.error();
  }
}
