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
export function createRunner({ selected, owned, env, system32, receipt }) {
  return (argv) =>
    new Promise((resolve) => {
      let timedOut = false;
      let exceeded = false;
      let stdout = '';
      let stderrBytes = 0;
      const child = spawn(selected.claude, argv, {
        cwd: path.join(owned, 'work'),
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let killing = false;
      let killDeadline;
      const kill = () => {
        if (killing) return;
        killing = true;
        killDeadline = setTimeout(() => {
          child.kill();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          clearTimeout(timer);
          clearInterval(monitor);
          receipt.unreapedProcess = true;
          resolve({ code: 1, timedOut: true, exceeded, stdout, stderrBytes });
        }, 3000);
        if (child.pid) {
          const killer = spawn(
            path.join(system32, 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore', env },
          );
          killer.on('error', () => child.kill());
          killer.on('close', (code) => {
            if (code !== 0) child.kill();
          });
          const killerTimeout = setTimeout(() => {
            killer.kill();
            child.kill();
          }, 2000);
          killer.on('close', () => clearTimeout(killerTimeout));
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, 20000);
      const monitor = setInterval(() => {
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
      child.stdout.on('data', (b) => {
        if (Buffer.byteLength(stdout) + b.length > 32768) {
          exceeded = true;
          kill();
        } else stdout += b;
      });
      child.stderr.on('data', (b) => {
        stderrBytes += b.length;
        if (stderrBytes > 32768) {
          exceeded = true;
          kill();
        }
      });
      child.on('error', () => {
        clearTimeout(killDeadline);
        clearTimeout(timer);
        clearInterval(monitor);
        resolve({ code: 1, error: 'spawn-failed', stdout: '' });
      });
      child.on('close', (code) => {
        clearTimeout(killDeadline);
        clearTimeout(timer);
        clearInterval(monitor);
        resolve({ code, timedOut, exceeded, stdout, stderrBytes });
      });
    });
}
