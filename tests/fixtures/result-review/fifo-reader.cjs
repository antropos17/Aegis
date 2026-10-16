'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readResultReviewBundle } = require('../../../src/main/result-review-bundle');

// Isolate a genuinely blocking open from the test runner's libuv pool. No writer
// is ever opened. The parent owns kill/reap and exact directory cleanup.
let setupCode = null;
function setupFailure(code) {
  setupCode = code;
  throw Error('fifo-fixture-setup');
}
function finish(message, exitCode) {
  process.exitCode = exitCode;
  if (!process.connected) return;
  process.send(message, () => process.disconnect());
}

async function main() {
  if (process.platform === 'win32') setupFailure('unsupported-platform');
  const directory = process.argv[2];
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    !/^fifo-reader-[a-zA-Z0-9]+$/.test(path.basename(directory))
  )
    setupFailure('directory-invalid');
  const heldDirectory = fs.lstatSync(directory);
  if (
    !heldDirectory.isDirectory() ||
    heldDirectory.isSymbolicLink() ||
    fs.realpathSync(directory) !== directory ||
    fs.readdirSync(directory).length !== 0
  )
    setupFailure('directory-invalid');
  const selected = path.join(directory, 'selected.json');
  fs.writeFileSync(
    selected,
    JSON.stringify({
      schemaVersion: 1,
      captureSource: 'external-result',
      before: { complete: true, files: [] },
      after: { complete: true, files: [] },
      claims: { accepted: false, stopped: false, boundaryPassed: false },
    }),
    { flag: 'wx' },
  );
  const original = fs.lstatSync(selected);
  if (!original.isFile() || original.isSymbolicLink()) setupFailure('regular-file-missing');
  let checks = 0;
  try {
    await readResultReviewBundle(selected, () => {
      if (++checks !== 2) return;
      // This existing ownership checkpoint follows the reader's real lstat.
      // Independently verify our exact original before replacing only that leaf.
      const current = fs.lstatSync(selected);
      const parent = fs.lstatSync(directory);
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.dev !== original.dev ||
        current.ino !== original.ino ||
        parent.dev !== heldDirectory.dev ||
        parent.ino !== heldDirectory.ino ||
        parent.isSymbolicLink()
      )
        setupFailure('original-changed');
      fs.unlinkSync(selected);
      const made = spawnSync('mkfifo', [selected], {
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024,
        stdio: 'ignore',
      });
      if (made.error?.code === 'ENOENT') setupFailure('mkfifo-unavailable');
      if (made.error || made.status !== 0) setupFailure('mkfifo-failed');
      const fifo = fs.lstatSync(selected);
      if (!fifo.isFIFO() || fifo.isSymbolicLink()) setupFailure('fifo-not-observed');
      process.send({ kind: 'ready', regularBefore: true, fifoVerified: true, checkpoint: 2 });
    });
    finish({ kind: 'result', error: 'unexpected-review', review: true }, 0);
  } catch (error) {
    if (setupCode) finish({ kind: 'setup-error', code: setupCode }, 1);
    else
      finish(
        {
          kind: 'result',
          error:
            error.message === 'result-bundle-unavailable'
              ? 'result-bundle-unavailable'
              : 'unexpected-reader-error',
          review: false,
        },
        0,
      );
  }
}
main().catch(() => finish({ kind: 'setup-error', code: setupCode || 'setup-unavailable' }, 1));
