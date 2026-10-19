import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFile, readdir, lstat, unlink, rmdir, statfs } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';

/** Enumerate only ordinary files; fail closed on links in owned artifacts.
 * @param {string} root Directory @returns {Promise<string[]>} Paths @since 0.19.2-beta
 */
export async function files(root) {
  assert(!(await lstat(root)).isSymbolicLink(), 'Reparse/link directory refused: ' + root);
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = join(root, item.name);
    assert(!item.isSymbolicLink(), 'Reparse/link entry refused: ' + file);
    if (item.isDirectory()) result.push(...(await files(file)));
    else if (item.isFile()) result.push(file);
    else assert.fail('Non-ordinary entry: ' + file);
  }
  return result.sort();
}

/** Freeze repository source and installed runtime identities without reading home.
 * @param {string} repo Checkout @returns {Promise<object>} SHA256 map @since 0.19.2-beta
 */
export async function sourceBinding(repo) {
  const paths = [];
  for (const directory of ['src/main', 'src/shared', 'frontend/observatory']) {
    paths.push(...(await files(join(repo, directory))));
  }
  paths.push(
    join(repo, 'vite.frontend.config.ts'),
    join(repo, 'package.json'),
    join(repo, 'package-lock.json'),
  );
  const hashes = {};
  for (const file of paths) hashes[relative(repo, file).replaceAll('\\', '/')] = await hash(file);
  return hashes;
}

/** Hash one source/artifact file. @param {string} file Path @returns {Promise<string>} SHA256 @since 0.19.2-beta */
export async function hash(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

/** Arm the absolute batch deadline before invoking any operation.
 * @param {number} totalMs Absolute budget @returns {object} Deadline guard @since 0.19.2-beta
 */
export function armDeadline(totalMs) {
  assert(Number.isSafeInteger(totalMs) && totalMs > 0);
  const startedAt = performance.now(),
    endsAt = startedAt + totalMs;
  let absoluteTimer;
  const expired = new Promise((_, reject) => {
    absoluteTimer = setTimeout(
      () => reject(new Error('Absolute Electron deadline exceeded')),
      totalMs,
    );
  });
  // The deadline can expire while the caller is recording an explicit cleanup uncertainty.
  expired.catch(() => {});
  return {
    startedAt,
    endsAt,
    remaining: () => Math.max(0, endsAt - performance.now()),
    async run(operation, label, maximumMs = totalMs, reserveMs = 0) {
      const remaining = Math.min(maximumMs, endsAt - performance.now() - reserveMs);
      if (remaining <= 0) throw new Error(label + ': deadline exhausted');
      let timer;
      const phaseExpired = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ': deadline exceeded')), remaining);
      });
      try {
        return await Promise.race([expired, phaseExpired, Promise.resolve().then(operation)]);
      } finally {
        clearTimeout(timer);
      }
    },
    dispose: () => clearTimeout(absoluteTimer),
  };
}

const terminations = new WeakMap();
const exited = (child) => child.exitCode !== null || child.signalCode !== null;
const waitExit = (child, ms) =>
  new Promise((done) => {
    if (exited(child)) return done(true);
    const finish = () => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      done(true);
    };
    const timer = setTimeout(
      () => {
        child.removeListener('exit', finish);
        done(false);
      },
      Math.max(0, ms),
    );
    child.once('exit', finish);
  });

/** Request tree termination at most once per owned ChildProcess, then verify exit.
 * @param {import('node:child_process').ChildProcess} child Owned process handle
 * @param {object} options Bounded command/exit waits @returns {Promise<object>} Confirmation @since 0.19.2-beta
 */
export function terminateOwned(child, { commandMs = 5000, exitMs = 3000 } = {}) {
  if (terminations.has(child)) return terminations.get(child);
  const result = (async () => {
    if (exited(child)) return { requests: 0, confirmed: true, childExitConfirmed: true };
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0)
      return { requests: 0, confirmed: false, reason: 'owned-pid-unavailable' };
    const taskkill = await new Promise((done) => {
      const command = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done(value);
      };
      const timer = setTimeout(() => {
        command.kill();
        finish({ timeout: true });
      }, commandMs);
      command.once('error', (error) => finish({ error: error.message }));
      command.once('exit', (code) => finish({ code }));
    });
    const childExitConfirmed = await waitExit(child, exitMs);
    return {
      requests: 1,
      taskkill,
      childExitConfirmed,
      confirmed: taskkill.code === 0 && childExitConfirmed,
    };
  })();
  terminations.set(child, result);
  return result;
}

/** Run an owned build child, latch its first failure, and await termination before returning.
 * @param {object} options Executable/args, budgets, bounded log and optional termination seam
 * @returns {Promise<object>} Exit and termination evidence @since 0.19.2-beta
 */
export async function runOwnedBuild({
  executable,
  args,
  cwd,
  env,
  log,
  timeoutMs = 90000,
  maxBytes = 1048576,
  terminate = terminateOwned,
  spawnProcess = spawn,
  drainMs = 1000,
}) {
  const child = spawnProcess(executable, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure = null,
    termination = null,
    terminationCalls = 0,
    code = null,
    signal = null,
    closed = false;
  let onClose;
  const close = new Promise((done) => {
    onClose = done;
  });
  let finish;
  const completed = new Promise((done) => {
    finish = done;
  });
  const fail = (reason) => {
    if (failure !== null) return;
    failure = reason;
    clearTimeout(timer);
    terminationCalls++;
    Promise.resolve()
      .then(() => terminate(child))
      .then(
        (value) => {
          termination = value;
          finish();
        },
        (error) => {
          termination = { confirmed: false, error: error.message };
          finish();
        },
      );
  };
  const timer = setTimeout(() => fail('build-timeout'), timeoutMs);
  const capture = (chunk) => {
    if (log.add(chunk) > maxBytes) fail('build-output-limit');
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => fail('build-spawn-error:' + error.message));
  child.once('exit', (value, cause) => {
    code = value;
    signal = cause;
    clearTimeout(timer);
    // Root exit must enter bounded drain handling even when inherited pipes stay open.
    if (failure === null) finish();
  });
  child.once('close', () => {
    closed = true;
    onClose();
    if (failure === null) finish();
  });
  await completed;
  clearTimeout(timer);
  let drainTimer;
  await Promise.race([
    close,
    new Promise((done) => {
      drainTimer = setTimeout(done, drainMs);
    }),
  ]);
  clearTimeout(drainTimer);
  const childExitConfirmed = exited(child);
  // Snapshot before local stream destruction: closing parent pipes is not evidence
  // that the inherited streams drained or any descendant stopped.
  const outputDrainConfirmed = closed;
  if (!outputDrainConfirmed) {
    child.unref();
    child.stdout.destroy();
    child.stderr.destroy();
  }
  return {
    pid: child.pid,
    code,
    signal,
    failure,
    termination,
    terminationCalls,
    childExitConfirmed,
    outputDrainConfirmed,
    descendantLifecycle: 'not-observed',
    uncertainty: !childExitConfirmed
      ? 'root-exit-unconfirmed'
      : !outputDrainConfirmed
        ? 'pipe-drain-unconfirmed'
        : null,
    cleanupAllowed:
      childExitConfirmed &&
      outputDrainConfirmed &&
      (failure === null || termination?.confirmed === true),
    emittedBytes: log.bytes(),
    retainedBytes: log.content().length,
  };
}

/** Keep at most limit bytes even while shutdown drains a noisy child.
 * @param {number} limit Byte cap @returns {object} Bounded capture @since 0.19.2-beta
 */
export function boundedLog(limit) {
  const chunks = [];
  let total = 0,
    retained = 0;
  return {
    add(chunk) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (retained < limit) {
        const part = bytes.subarray(0, limit - retained);
        chunks.push(Buffer.from(part));
        retained += part.length;
      }
      return total;
    },
    content: () => Buffer.concat(chunks),
    bytes: () => total,
  };
}

/** Build production once, or verify a retained successful build against unchanged production inputs.
 * @param {object} options Checkout, receipt, child environment, log and optional receipt path
 * @returns {Promise<void>} Source/artifact binding @since 0.19.2-beta
 */
export async function prepareBuild({ repo, receipt, env, log, reuseReceipt }) {
  const production = (source) =>
    Object.fromEntries(Object.entries(source).filter(([name]) => !name.includes('/tests/')));
  if (reuseReceipt) {
    const previous = JSON.parse(await readFile(reuseReceipt, 'utf8'));
    assert.equal(previous.pass, true, 'Only a successful retained build receipt can be reused');
    assert.deepEqual(previous.sourceBefore, previous.sourceAfterBuild);
    assert.deepEqual(
      production(previous.sourceBefore),
      production(receipt.sourceBefore),
      'Production build inputs changed',
    );
    assert.deepEqual(previous.node, receipt.node, 'Build Node binary changed');
    receipt.buildCommand = previous.buildCommand;
    receipt.reusedBuild = {
      receipt: reuseReceipt,
      sha256: await hash(reuseReceipt),
      source: previous.sourceAfterBuild,
    };
    receipt.renderer = previous.renderer;
    const current = {};
    for (const file of await files(join(repo, 'dist/renderer'))) current[file] = await hash(file);
    assert.deepEqual(current, previous.renderer, 'Retained build artifacts changed');
  } else {
    receipt.buildCommand = [
      process.execPath,
      'node_modules/vite/bin/vite.js',
      'build',
      '--config',
      'vite.frontend.config.ts',
    ];
    receipt.buildProcess = await runOwnedBuild({
      executable: process.execPath,
      args: receipt.buildCommand.slice(1),
      cwd: repo,
      env,
      log,
    });
    assert(
      receipt.buildProcess.cleanupAllowed &&
        receipt.buildProcess.code === 0 &&
        receipt.buildProcess.failure === null,
      'Production build failed: ' + JSON.stringify(receipt.buildProcess),
    );
    receipt.renderer = {};
    for (const file of await files(join(repo, 'dist/renderer')))
      receipt.renderer[file] = await hash(file);
  }
  receipt.sourceAfterBuild = await sourceBinding(repo);
  assert.deepEqual(
    receipt.sourceAfterBuild,
    receipt.sourceBefore,
    'Source changed during build/binding',
  );
}

/** Measure owned disk artifacts and both drive free-space snapshots.
 * @param {string} directory Owned directory @returns {Promise<object>} Measurements @since 0.19.2-beta
 */
export async function storage(directory) {
  let bytes = 0;
  for (const file of await files(directory)) bytes += (await lstat(file)).size;
  const drives = {};
  for (const root of [resolve(directory).slice(0, 3), 'C:/']) {
    const info = await statfs(root);
    drives[root] = info.bavail * info.bsize;
  }
  return { bytes, freeBytes: drives };
}

/** Remove only closed ordinary disposable entries under the exact owned root.
 * @param {string} root Exact scratch @param {string} output Exact output parent @returns {Promise<void>} Completion @since 0.19.2-beta
 */
export async function removeScratch(root, output) {
  assert.equal(dirname(resolve(root)), resolve(output));
  assert.equal(relative(output, root), 'disposable');
  const remove = async (directory) => {
    assert(!(await lstat(directory)).isSymbolicLink(), 'Reparse cleanup refused');
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      assert(!item.isSymbolicLink(), 'Reparse cleanup refused');
      if (item.isDirectory()) await remove(file);
      else {
        assert(item.isFile());
        await unlink(file);
      }
    }
    await rmdir(directory);
  };
  await remove(root);
}

/** Assert that rendered leaf evidence agrees with the actual IPC payload.
 * @param {import('playwright').Page} page Page @param {object} raw Actual snapshot @returns {Promise<void>} Assertions @since 0.19.2-beta
 */
export async function assertDormant(page, raw) {
  assert.equal(raw.nativeSensor, null);
  const leaf = raw.appHealth.sensors.byId['etw-file'];
  assert.equal(leaf.state, 'DISABLED');
  assert.equal(leaf.detail, 'diagnostic-opt-in-required');
  assert.equal(leaf.lastSuccessAt, null);
  const workspace = page.locator('.coverage-workspace');
  const article = workspace
    .locator('.sensor-list article')
    .filter({ hasText: 'Windows file events' });
  await article.waitFor({ state: 'visible' });
  assert.equal(await article.locator('strong').innerText(), 'Off');
  assert(
    await article.getByText('Optional diagnostic capture is off.', { exact: true }).isVisible(),
  );
  for (const [label, value] of [
    ['Observed loss', leaf.lossCount],
    ['Failures', leaf.consecutiveFailures],
  ]) {
    assert.equal(
      await article
        .getByText(label, { exact: true })
        .evaluate((node) => node.nextElementSibling.textContent),
      String(value),
    );
  }
  assert.equal(
    await article
      .getByText('Last success', { exact: true })
      .evaluate((node) => node.nextElementSibling.textContent),
    'Not reported',
  );
  assert(
    await workspace
      .getByText(
        'The native platform sensor is unavailable on this host. Windows polling and optional Windows file capture are reported separately below.',
        { exact: true },
      )
      .isVisible(),
  );
  assert.equal(await workspace.locator('.surfaces').count(), 0);
  assert.equal(await workspace.locator('.sensor-list article').count(), 1);
}
