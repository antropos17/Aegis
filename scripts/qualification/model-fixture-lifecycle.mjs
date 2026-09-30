import fs from 'node:fs/promises';
import path from 'node:path';

/** Own cleanup from generated-directory acquisition through fixture publication.
 * @param {string} root Exact fresh generated directory.
 * @param {string} parent Canonical task temporary parent.
 * @returns {object} Private server attachment, bounded stop and idempotent cleanup. @since v0.17.0 */
export function createModelFixtureLifecycle(root, parent) {
  let server, stopping, cleaning;
  const sockets = new Set();
  const stop = () => {
    stopping ||= new Promise((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(Error('fixture-stop-unavailable')), 2000);
      try {
        server.close((error) => {
          clearTimeout(timer);
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING')
            reject(Error('fixture-stop-unavailable'));
          else resolve();
        });
        server.closeAllConnections?.();
      } catch {
        clearTimeout(timer);
        reject(Error('fixture-stop-unavailable'));
      }
    });
    for (const socket of sockets) socket.destroy();
    return stopping;
  };
  const cleanup = () => {
    cleaning ||= (async () => {
      await stop();
      if (
        path.dirname(root) !== parent ||
        !path.basename(root).startsWith('aegis-model-fixture-') ||
        (await fs.lstat(root)).isSymbolicLink() ||
        (await fs.realpath(root)) !== root
      )
        throw Error('fixture-cleanup-unsafe');
      const queue = [root];
      let inspected = 0;
      while (queue.length) {
        for (const entry of await fs.readdir(queue.pop(), { withFileTypes: true })) {
          if (++inspected > 256 || entry.isSymbolicLink()) throw Error('fixture-cleanup-unsafe');
          const filename = path.join(entry.parentPath, entry.name);
          if (entry.isDirectory()) queue.push(filename);
          else if (!entry.isFile()) throw Error('fixture-cleanup-unsafe');
        }
      }
      await fs.rm(root, { recursive: true, force: true });
    })();
    return cleaning;
  };
  return Object.freeze({
    sockets,
    attach: (selected) => {
      if (server) throw Error('fixture-server-already-owned');
      server = selected;
    },
    stop,
    cleanup,
  });
}
