'use strict';
const fs = require('node:fs');
const path = require('node:path');

function resolveExe() {
  // Packaged resources are authoritative; never search PATH or a development
  // checkout when running a package.
  const root =
    process.resourcesPath && !process.defaultApp
      ? process.resourcesPath
      : path.join(__dirname, '../../..', 'build');
  const file = path.join(root, 'sidecar', 'aegis-resources.exe');
  return fs.existsSync(file) ? file : null;
}

/** Create the Windows formatted-counter transport. No readings are cached here.
 * @param {{exec: Function, resolveExe?: Function, now?: Function, mode?: string}} deps
 * @returns {{fetch: (pids: number[]) => Promise<string>}} Existing perf JSON rows.
 * @since 0.15.0
 */
function createWindowsResources(deps) {
  const locate = deps.resolveExe || resolveExe;
  const now = deps.now || (() => performance.now());
  const mode = deps.mode ?? process.env.AEGIS_RESOURCE_PROVIDER;
  let retryAt = 0;
  return {
    async fetch(pids) {
      if (!pids.length) return '[]';
      if (pids.some((pid) => !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff))
        throw new Error('Invalid resource target');
      if (mode !== 'powershell' && pids.length <= 2048 && now() >= retryAt) {
        try {
          const exe = locate();
          if (!exe) throw new Error('Resource helper unavailable');
          const text = await deps.exec(exe, [pids.join(',')], {
            timeout: 5000,
            maxBuffer: 1048576,
          });
          const data = JSON.parse(text);
          if (data?.version !== 1 || !Array.isArray(data.rows) || data.rows.length > pids.length)
            throw new Error('Invalid resource response');
          const wanted = new Set(pids),
            seen = new Set();
          for (const row of data.rows) {
            if (!row || !wanted.has(row.IDProcess) || seen.has(row.IDProcess))
              throw new Error('Invalid resource row');
            seen.add(row.IDProcess);
            for (const key of ['PercentProcessorTime', 'WorkingSet']) {
              if (
                !(key in row) ||
                (row[key] !== null &&
                  (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0))
              )
                throw new Error('Invalid resource measurement');
            }
          }
          return JSON.stringify(data.rows);
        } catch {
          // Cool down failed/missing helpers; fallback still samples on every call.
          retryAt = now() + 60000;
        }
      }
      const filter = pids.map((pid) => `IDProcess=${pid}`).join(' OR ');
      const script =
        '$ErrorActionPreference="SilentlyContinue";' +
        `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter '${filter}' ` +
        '| Select-Object IDProcess,PercentProcessorTime,WorkingSet | ConvertTo-Json -Compress';
      return deps.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    },
  };
}

module.exports = { createWindowsResources };
