import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { delay } from './etw-support.mjs';

/** Start a normal-token, read-only native receipt witness; no capture/control API.
 * @param {string} helper @param {string} out @param {object} env
 * @param {boolean} total Retain all original objects for the six-process-loss witness.
 * @returns {object} Bounded messages and waits. @since v0.19.2
 */
export function observeCustodian(helper, out, env, total = false) {
  const child = spawn(helper, [total ? 'observe-total' : 'observe-custodian'], {
    cwd: out,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const messages = [];
  let bytes = 0,
    pending = '',
    error = null,
    stderr = '';
  child.on('error', (value) => {
    error = value;
  });
  child.stdout.on('data', (chunk) => {
    try {
      bytes += chunk.length;
      assert(bytes <= 16384, 'Observer output budget');
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        assert(line.length <= 2048 && messages.length < 10, 'Observer message budget');
        const value = JSON.parse(line);
        assert(['endpoint', 'reserved', 'phase', 'terminal', 'peer-exit'].includes(value.type));
        messages.push(value);
      }
    } catch (value) {
      error = value;
    }
  });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 2048) stderr += chunk.toString('utf8').slice(0, 2048 - stderr.length);
    error = Error('Unexpected native observer stderr');
  });
  async function until(predicate, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (error) throw error;
      const value = messages.find(predicate);
      if (value) return value;
      if (child.exitCode !== null)
        throw Error(
          'Observer ended before expected observation: exit ' +
            child.exitCode +
            '; events ' +
            messages
              .filter((m) => m.type !== 'endpoint')
              .map((m) => m.type + (m.custodianExit === undefined ? '' : ':' + m.custodianExit))
              .join(','),
        );
      await delay(100);
    }
    throw Error('Observer observation deadline');
  }
  return {
    child,
    until,
    events: () => structuredClone(messages.filter((m) => m.type !== 'endpoint')),
    async settled() {
      const end = Date.now() + 10000;
      while (child.exitCode === null && Date.now() < end) await delay(50);
      assert.equal(child.exitCode, 0, 'Native observer did not exit successfully');
      assert.equal(stderr, '');
      if (error) throw error;
    },
    stop() {
      // Only this owned normal-token observer is stopped on test abort.
      // It cannot control ETW; the elevated custodian ignores sink loss.
      if (child.exitCode === null) child.kill();
    },
  };
}
