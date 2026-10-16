import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

/** Observe actual preload deliveries; retain only owned fixture metadata.
 * @param {object} scope Owned fixture scope. @returns {void} @since v0.19.2
 */
export function observeSensors({ pid, home, canary }) {
  const probe = { files: [], network: [], batches: [], leaked: false, overflow: false };
  window.__sensorProbe = probe;
  const check = (value) => {
    if (JSON.stringify(value).includes(canary)) probe.leaked = true;
  };
  const push = (target, value) => {
    if (target.length >= 256) probe.overflow = true;
    else target.push(value);
  };
  window.aegis.onFileAccess((value) => {
    check(value);
    for (const row of Array.isArray(value) ? value : [value])
      if (row.file?.toLowerCase().startsWith(home.toLowerCase() + '\\')) push(probe.files, row);
  });
  window.aegis.onNetworkUpdate((rows) => {
    check(rows);
    push(probe.network, { at: Date.now(), rows: rows.filter((row) => row.pid === pid) });
  });
  window.aegis.onScanBatch((batch) => {
    check(batch);
    const own = batch.agents.find((row) => row.pid === pid);
    const health = batch.stats?.appHealth;
    push(probe.batches, {
      at: Date.now(),
      instanceId: own?.instanceId ?? null,
      witness: own?.createTime100ns ?? null,
      reliable: health?.populationReliable === true && health?.identityDegraded === false,
      sensors: Object.fromEntries(
        ['fs-chokidar', 'fs-rm', 'network'].map((id) => [id, health?.sensors?.byId?.[id]?.state]),
      ),
    });
  });
}

/** Wait for the original owned child handle, without leaked timeout timers.
 * @param {object} child @param {number} ms @returns {Promise<number>} @since v0.19.2
 */
export async function exitWithin(child, ms = 10000) {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(ms) });
  return code;
}

/** Check only an observed PID's existence; never intervene against it.
 * @param {number} pid @returns {boolean} @since v0.19.2
 */
export function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/** Capture owned app/helper PIDs before quitting, without dumping unrelated commands.
 * @param {object} app @param {number} rootPid @param {object} env @returns {Promise<number[]>} @since v0.19.2
 */
export async function ownedPids(app, rootPid, env) {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((row) => row.pid));
  const raw = execFileSync(
    path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${rootPid}' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`,
    ],
    { env, windowsHide: true, timeout: 10000, maxBuffer: 65536 },
  )
    .toString()
    .trim();
  return [...new Set([rootPid, ...metrics, ...[JSON.parse(raw || '[]')].flat()])];
}

/** Check retained private audit metadata and content-canary exclusion after app closure.
 * @param {string} profile @param {string} home @param {number} pid @param {string} canary
 * @returns {object[]} Owned audit entries only. @since v0.19.2
 */
export function inspectProfile(profile, home, pid, canary) {
  let bytes = 0;
  const audit = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert(!entry.isSymbolicLink(), 'Unexpected linked profile entry');
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      assert(entry.isFile(), 'Unexpected profile entry');
      const size = fs.statSync(file).size;
      bytes += size;
      assert(
        size <= 16 * 1024 ** 2 && bytes <= 64 * 1024 ** 2,
        'Profile inspection budget exceeded',
      );
      const data = fs.readFileSync(file);
      assert(
        !data.includes(Buffer.from(canary)) && !data.includes(Buffer.from(canary, 'utf16le')),
        'Synthetic content leaked to profile',
      );
      if (path.basename(dir) === 'audit-logs' && entry.name.endsWith('.json')) {
        for (const line of data.toString('utf8').split(/\r?\n/).filter(Boolean)) {
          const row = JSON.parse(line);
          if (row.pid === pid || row.path?.startsWith(home + path.sep)) audit.push(row);
        }
      }
    }
  };
  walk(profile);
  return audit;
}
