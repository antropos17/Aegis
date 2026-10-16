import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

/** Run one owned child with capped diagnostics and a deadline, without retries.
 * @param {string} executable Executable path; no shell interpolation.
 * @param {string[]} args Arguments.
 * @param {object} options cwd, env, log, timeoutMs and optional maxBytes.
 * @returns {Promise<object>} Exit, truncation and termination evidence. @since v0.19.2
 */
export async function boundedCommand(executable, args, options) {
  const limit = options.maxBytes ?? 2 * 1024 * 1024;
  const fd = fs.openSync(options.log, 'wx');
  const started = Date.now();
  let bytes = 0;
  let reason = null;
  let termination = null;
  let timer;
  let deadline;
  let settled = false;
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const finish = (code, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      fs.closeSync(fd);
      resolve({
        code,
        error,
        reason,
        termination,
        logBytes: bytes,
        elapsedMs: Date.now() - started,
      });
    };
    const stop = (why) => {
      if (reason) return;
      reason = why;
      if (child.pid) {
        if (process.platform === 'win32') {
          const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 5000,
            stdio: 'ignore',
            env: options.env,
          });
          termination = { attempted: true, code: result.status };
        } else termination = { attempted: true, signaled: child.kill('SIGKILL') };
      }
      deadline = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, 'Child did not close after termination; inspect owned processes');
      }, 6000);
    };
    const append = (chunk) => {
      if (settled) return;
      const allowed = Math.max(0, limit - bytes);
      const part = chunk.subarray(0, allowed);
      try {
        if (part.length) fs.writeSync(fd, part);
      } catch {
        stop('log-write-error');
        return;
      }
      bytes += part.length;
      if (chunk.length > allowed) stop('output-limit');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => finish(null, error.code ?? error.message));
    child.on('close', (code) => finish(code));
    timer = setTimeout(() => stop('timeout'), options.timeoutMs);
  });
}
