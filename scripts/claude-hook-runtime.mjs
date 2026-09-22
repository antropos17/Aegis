import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** @param {string[]} args Explicit CLI options. @returns {object} Validated local paths. @since v0.15.1 */
export function options(args) {
  if (process.platform !== 'win32' || args.length !== 6) throw Error('usage');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    const value = args[i + 1];
    if (
      !args[i].startsWith('--') ||
      !['claude', 'bash', 'scratch'].includes(key) ||
      Object.hasOwn(result, key) ||
      !path.isAbsolute(value) ||
      /^[\\/]{2}/.test(value) ||
      /[\r\n]/.test(value)
    )
      throw Error('usage');
    const stat = fs.lstatSync(value);
    if (stat.isSymbolicLink() || (key === 'scratch' ? !stat.isDirectory() : !stat.isFile()))
      throw Error('usage');
    result[key] = fs.realpathSync(value);
  }
  if (!result.claude || !result.bash || !result.scratch) throw Error('usage');
  const space = fs.statfsSync(result.scratch);
  if (space.bavail * space.bsize < 1024 ** 3) throw Error('space');
  return result;
}

/** @param {string} dir Owned directory. @returns {number} Regular file bytes. @since v0.15.1 */
export function treeBytes(dir) {
  if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== path.resolve(dir)) return 0;
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    size += entry.isDirectory() ? treeBytes(full) : fs.lstatSync(full).size;
  }
  return size;
}

/** @param {string} dir Owned path. @param {string} owned Canonical cleanup boundary.
 * @returns {void} @since v0.15.1 */
export function removeOwned(dir, owned) {
  const resolved = path.resolve(dir);
  if (resolved !== owned && !resolved.startsWith(owned + path.sep)) throw Error('cleanup');
  if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== resolved) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    try {
      if (entry.isDirectory()) removeOwned(full, owned);
      else fs.unlinkSync(full);
    } catch {
      /* Preserve locked files. */
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* Report incomplete cleanup. */
  }
}

/** @param {object} context Isolated process context. @returns {Function} Bounded CLI runner. @since v0.15.1 */
export function createRunner({ selected, owned, env, system32, receipt, spawnProcess = spawn }) {
  return (argv, { signal, timeoutMs = 20000, interact } = {}) =>
    new Promise((resolve) => {
      let timedOut = false;
      let cancelled = false;
      let exceeded = false;
      let stdout = '';
      let stderrBytes = 0;
      let child;
      let killer;
      let killing = false;
      let settled = false;
      let parentClosed = false;
      let exitCode = 1;
      let killResult;
      let killerTimedOut = false;
      let timer;
      let monitor;
      let killDeadline;
      let killerTimeout;
      const bestEffort = (target, method) => {
        try {
          target?.[method]?.();
        } catch {
          /* A failed fallback never establishes cleanup. */
        }
      };
      const finish = (code, treeCleanupConfirmed, error) => {
        if (settled) return;
        settled = true;
        for (const t of [timer, killDeadline, killerTimeout]) clearTimeout(t);
        clearInterval(monitor);
        signal?.removeEventListener('abort', abort);
        if (killing && !treeCleanupConfirmed) {
          receipt.unreapedProcess = true;
          receipt.cleanupUnconfirmed = true;
        }
        resolve({
          code,
          timedOut,
          cancelled,
          exceeded,
          stdout,
          stderrBytes,
          treeCleanupConfirmed,
          ...(error ? { error } : {}),
        });
      };
      const complete = () => {
        if (!parentClosed) return;
        if (!killing) finish(exitCode, false);
        else if (!child?.pid) finish(1, true);
        else if (killResult !== undefined) finish(1, killResult === 0 && !killerTimedOut);
      };
      const reap = () => {
        if (settled || killer || killResult !== undefined || !child?.pid) return;
        try {
          killer = spawnProcess(
            path.join(system32, 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore', env },
          );
          killer.on('error', () => {
            killResult = -1;
            bestEffort(child, 'kill');
            complete();
          });
          killer.on('close', (code) => {
            clearTimeout(killerTimeout);
            if (killResult === undefined) killResult = code === 0 ? 0 : -1;
            if (killResult !== 0) bestEffort(child, 'kill');
            complete();
          });
          killerTimeout = setTimeout(() => {
            killerTimedOut = true;
            bestEffort(killer, 'kill');
            bestEffort(child, 'kill');
          }, 2000);
        } catch {
          killResult = -1;
          bestEffort(child, 'kill');
          complete();
        }
      };
      const kill = () => {
        if (settled || killing) return;
        killing = true;
        clearTimeout(timer);
        clearInterval(monitor);
        killDeadline = setTimeout(() => {
          killerTimedOut = true;
          bestEffort(killer, 'kill');
          bestEffort(killer, 'unref');
          bestEffort(child, 'kill');
          bestEffort(child?.stdout, 'destroy');
          bestEffort(child?.stderr, 'destroy');
          bestEffort(child, 'unref');
          finish(1, false);
        }, 3000);
        reap();
      };
      function abort() {
        if (settled) return;
        cancelled = true;
        kill();
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) {
        finish(1, true, 'invalid-timeout');
        return;
      }
      if (signal?.aborted) {
        cancelled = true;
        finish(1, true);
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      monitor = setInterval(() => {
        try {
          if (treeBytes(owned) > 16 * 1024 ** 2) {
            exceeded = true;
            kill();
          }
        } catch {
          exceeded = true;
          kill();
        }
      }, 1000);
      try {
        child = spawnProcess(selected.claude, argv, {
          cwd: path.join(owned, 'work'),
          env,
          windowsHide: true,
          stdio: [interact ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        });
      } catch {
        finish(1, true, 'spawn-failed');
        return;
      }
      child.stdout.on('data', (b) => {
        if (settled || killing) return;
        const text = b.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(text) > 32768) {
          exceeded = true;
          kill();
        } else stdout += text;
      });
      child.stderr.on('data', (b) => {
        if (settled || killing) return;
        stderrBytes += b.length;
        if (stderrBytes > 32768) {
          exceeded = true;
          kill();
        }
      });
      child.stdout.on('error', kill);
      child.stderr.on('error', kill);
      child.stdin?.on('error', kill);
      child.on('spawn', () => {
        if (killing) reap();
      });
      child.on('error', () => {
        if (!child.pid) finish(1, true, 'spawn-failed');
        else kill();
      });
      child.on('close', (code) => {
        parentClosed = true;
        exitCode = code;
        complete();
      });
      if (killing) reap();
      else if (signal?.aborted) abort();
      else if (interact) {
        try {
          Promise.resolve(interact(child)).catch(kill);
        } catch {
          kill();
        }
      }
    });
}
