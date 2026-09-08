/**
 * @file linux-process-map.js
 * @description Fresh Linux process generations from procfs, with a named outage.
 * @since 0.15.0
 */
'use strict';

const sensor = require('../sensor-health');
const { parseParentProcessMapFromPs } = require('./posix-shared');

/**
 * Parse one complete stat record. comm may contain spaces, parentheses or newlines;
 * the last ')' terminates it because the remaining fields are numeric/state data.
 * @param {string} text
 * @param {number} expectedPid
 * @returns {{name: string, ppid: number, ticks: bigint}|null}
 */
function parseStat(text, expectedPid) {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 1 || close <= open || Number(text.slice(0, open).trim()) !== expectedPid) return null;
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const name = text.slice(open + 1, close);
  if (!name || fields.length < 20 || !/^[A-Za-z]$/.test(fields[0])) return null;
  if (!/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[19])) return null;
  const ppid = Number(fields[1]);
  if (!Number.isSafeInteger(ppid)) return null;
  return { name, ppid, ticks: BigInt(fields[19]) };
}

/**
 * Own the Linux process-map observation. No per-PID observation is cached. Only
 * CLK_TCK and a boot-ID-bound epoch reference survive passes. Pinning that global
 * reference prevents a wall-clock correction from changing every live identity.
 * Epoch values are therefore estimates in the first observed boot reference;
 * fresh kernel start ticks, not the wall clock, prove each process generation.
 * @param {{fs: typeof import('fs'), execFile: Function}} deps
 * @returns {{getParentProcessMap: Function, getSnapshotHealth: Function}}
 * @since 0.15.0
 */
function createProcessMapReader({ fs, execFile }) {
  let clockTicks = null;
  let clockProbe = null;
  let bootReference = null;
  let health = sensor.createSensorHealth('proc-snapshot');

  function run(command, args) {
    return new Promise((resolve) => {
      execFile(
        command,
        args,
        { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        (err, stdout) => {
          resolve(err ? null : String(stdout || ''));
        },
      );
    });
  }

  async function getClockTicks() {
    if (clockTicks !== null) return clockTicks;
    if (!clockProbe) {
      clockProbe = run('getconf', ['CLK_TCK'])
        .then((text) => {
          const value = text !== null && /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
          if (Number.isSafeInteger(value) && value > 0) clockTicks = value;
          return clockTicks;
        })
        .finally(() => {
          clockProbe = null;
        });
    }
    return clockProbe;
  }

  function readBootId() {
    const id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error('boot-id');
    return id.toLowerCase();
  }

  /**
   * Read this pass or return a population-only ps fallback with no birth claims.
   * A vanished PID is normal during enumeration. Other unread or malformed stat
   * records invalidate identity for the pass, so session reconciliation freezes.
   * @returns {Promise<Map<number, object>>}
   * @since 0.15.0
   */
  async function getParentProcessMap() {
    try {
      const hz = await getClockTicks();
      if (hz === null) throw Error('clock-ticks');
      const bootId = readBootId();
      const match = fs.readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0)
        throw Error('boot-time');
      if (!bootReference || bootReference.id !== bootId)
        bootReference = { id: bootId, seconds: BigInt(match[1]) };
      const entries = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry));
      const map = new Map();
      for (const entry of entries) {
        const pid = Number(entry);
        if (!Number.isSafeInteger(pid) || pid <= 0) continue;
        let text;
        try {
          text = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT' || err.code === 'ESRCH') continue;
          throw err;
        }
        const parsed = parseStat(text, pid);
        if (!parsed) throw Error('process-stat');
        const millis = bootReference.seconds * 1000n + (parsed.ticks * 1000n) / BigInt(hz);
        if (millis <= 0n || millis > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('process-time');
        map.set(pid, {
          name: parsed.name,
          ppid: parsed.ppid,
          startTime: Number(millis),
          witness: `${bootId}:${parsed.ticks}`,
          witnessSource: 'linuxStartTicks',
        });
      }
      if (map.size === 0 || readBootId() !== bootId) throw Error('process-table');
      health = sensor.markHealthy(health, Date.now());
      return map;
    } catch (_) {
      health = sensor.markFailed(health, Date.now(), {
        error: 'linux-proc-identity-unavailable',
        detail: 'linux-proc-identity-unavailable',
      });
      const text = await run('ps', ['-axo', 'pid=,ppid=,comm=']);
      const map = text === null ? new Map() : parseParentProcessMapFromPs(text);
      for (const entry of map.values()) entry.startTime = null;
      return map;
    }
  }

  /** @returns {object} @since 0.15.0 */
  function getSnapshotHealth() {
    return sensor.toPlain(health);
  }

  return { getParentProcessMap, getSnapshotHealth };
}

module.exports = { createProcessMapReader };
