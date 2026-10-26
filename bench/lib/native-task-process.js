'use strict';
const { spawn, execFileSync } = require('node:child_process');
const readline = require('node:readline');

/** Start the fixed task-owned C# worker and keep bounded request/response evidence.
 * @param {string} executable Owned compiled binary. @param {string[]} args Fixed paths.
 * @returns {object} Ready, request, stop and retained execution records. @since 0.21.0 */
function startWorker(executable, args) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const queue = [],
    waiters = [];
  let bytes = 0,
    stderrBytes = 0,
    exited = false;
  const exit = new Promise((resolve) => {
    child.once('error', () => {
      exited = true;
      resolve({ code: null, signal: null, reason: 'spawn-failed' });
    });
    child.once('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const lines = readline.createInterface({ input: child.stdout });
  const kill = () => {
    if (exited) return;
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5000,
      });
    } catch {
      /* Owned process may have exited. */
    }
  };
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 65536) kill();
  });
  child.stdin.on('error', () => {});
  lines.on('line', (line) => {
    bytes += Buffer.byteLength(line);
    if (bytes > 65536) {
      kill();
      return;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      value = { kind: 'failed', code: 'invalid-worker-response' };
    }
    if (waiters.length) waiters.shift()(value);
    else queue.push(value);
  });
  async function next(timeoutMs) {
    if (queue.length) return queue.shift();
    let timer, accept;
    try {
      return await Promise.race([
        new Promise((resolve) => {
          accept = resolve;
          waiters.push(accept);
        }),
        exit.then(() => ({ kind: 'failed', code: 'worker-exited' })),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            kill();
            resolve({ kind: 'failed', code: 'worker-timeout' });
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      const i = waiters.indexOf(accept);
      if (i >= 0) waiters.splice(i, 1);
    }
  }
  return {
    pid: child.pid,
    ready: () => next(5000),
    async request(task) {
      child.stdin.write(task + '\n');
      return next(30000);
    },
    async stop() {
      if (!exited) child.stdin.end('stop\n');
      let timer;
      try {
        const result = await Promise.race([
          exit,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              kill();
              resolve({ code: null, signal: null, reason: 'exit-unconfirmed' });
            }, 3000);
          }),
        ]);
        return { ...result, stdoutBytes: bytes, stderrBytes };
      } finally {
        clearTimeout(timer);
        lines.close();
      }
    },
  };
}
module.exports = { startWorker };
