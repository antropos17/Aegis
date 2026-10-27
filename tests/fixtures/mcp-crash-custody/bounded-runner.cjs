'use strict';
const { spawn } = require('node:child_process');
const { TextDecoder } = require('node:util');

// Private synthetic preflight only. An unknown result never implies job cleanup.
function runGuardian({
  command,
  args,
  cwd,
  env,
  onReady,
  signal,
  deadlineMs = 10000,
  waitMs = 2000,
}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ status: 'cleanup-unknown', code: null, reason: 'cancelled', output: '' });
      return;
    }
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ status: 'cleanup-unknown', code: null, reason: 'spawn-error', output: '' });
      return;
    }
    const stdout = [],
      stderr = [];
    let bytes = 0,
      settled = false,
      revoked = false,
      ready = false,
      released = false,
      reason = null;
    let deadline, afterKill;
    function settle(status, code, output = '') {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(afterKill);
      signal?.removeEventListener('abort', cancel);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ status, code, reason, output });
    }
    function revoke(cause) {
      if (revoked || settled) return;
      revoked = true;
      reason = cause;
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        /* The result stays unknown. */
      }
      afterKill = setTimeout(() => settle('cleanup-unknown', null), waitMs);
    }
    function cancel() {
      revoke('cancelled');
    }
    function capture(target, chunk) {
      if (settled || revoked) return;
      bytes += chunk.length;
      if (bytes > 8192) return revoke('output-overflow');
      target.push(chunk);
      if (
        target === stdout &&
        !ready &&
        /(?:^|\n)READY\r?\n/.test(Buffer.concat(stdout).toString('latin1'))
      ) {
        ready = true;
        Promise.resolve()
          .then(() => onReady())
          .then(
            () => {
              if (!settled && !revoked)
                child.stdin.write('CRASH\n', (error) => {
                  if (error) revoke('input-error');
                  else released = true;
                });
            },
            () => revoke('ready-check-failed'),
          )
          .catch(() => revoke('input-error'));
      }
    }
    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.stdout.on('error', () => revoke('stdout-error'));
    child.stderr.on('error', () => revoke('stderr-error'));
    child.stdin.on('error', () => revoke('input-error'));
    child.on('error', () => revoke('spawn-error'));
    child.on('close', (code) => {
      if (revoked) return settle('cleanup-unknown', code);
      let out, err;
      try {
        out = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout));
        err = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stderr));
      } catch {
        reason = 'decode-failed';
        return settle('cleanup-unknown', code);
      }
      const gate =
        'GATE expectedParentChain=true exactSystemHosts=true finalMembershipStable=true heldRootIdentity=true';
      const passed = 'PASS held-root terminated, outer Job empty, all held members signaled';
      const lines = out.endsWith('\n')
        ? out
            .slice(0, -1)
            .split('\n')
            .map((line) => line.replace(/\r$/, ''))
        : [];
      const suffix = lines.slice(-3);
      const complete =
        code === 0 &&
        ready &&
        released &&
        err === '' &&
        suffix[0] === gate &&
        suffix[1] === passed &&
        /^CLEANUP jobEmpty=True heldCount=[1-6] heldExited=True$/.test(suffix[2] || '') &&
        lines.filter((line) => line.startsWith('GATE ')).length === 1 &&
        lines.filter((line) => line.startsWith('PASS ')).length === 1 &&
        lines.filter((line) => line === 'READY').length === 1 &&
        lines.filter((line) => line.startsWith('CLEANUP ')).length === 1 &&
        !lines.some((line) => line.startsWith('FAIL ') || line.includes('CLEANUP_UNCONFIRMED'));
      if (!complete) reason = 'protocol-invalid';
      settle(complete ? 'confirmed' : 'cleanup-unknown', code, out + err);
    });
    deadline = setTimeout(() => revoke('deadline'), deadlineMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
module.exports = { runGuardian };
