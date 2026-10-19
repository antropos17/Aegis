'use strict';
const { resolveSystemExecutable } = require('../system-executable-admission');

// Default driver installation paths; custom/user-writable CLI installations are
// outside this observer. Windows admission assumes the default system-tree ACLs.
const EXECUTABLES = {
  win32: [
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ],
  linux: ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'],
};
const OPTIONS = { timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true };

/** Resolve NVIDIA's CLI without searching PATH or the application's directory.
 * @param {string} [platform] Host platform.
 * @param {object} [fs] Filesystem seam.
 * @returns {{file: string, cwd: string}|null} Admitted driver executable.
 * @since 0.19.2
 */
function resolveNvidiaExecutable(platform = process.platform, fs) {
  return resolveSystemExecutable(platform, EXECUTABLES[platform] || [], fs);
}

/** Sum complete per-PID VRAM measurements across reported GPU rows.
 * @param {string} stdout NVIDIA compute-apps CSV.
 * @returns {Map<number, number>} MiB totals; partial/unavailable totals are omitted.
 * @since 0.19.2
 */
function parseGpuCsv(stdout) {
  const totals = new Map();
  const unavailable = new Set();
  for (const line of (stdout || '').split('\n')) {
    const fields = line.trim().match(/^(\d+)\s*,\s*(.*)$/);
    if (!fields) continue;
    const pid = Number(fields[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || unavailable.has(pid)) continue;
    const memory = /^\d+$/.test(fields[2]) ? Number(fields[2]) : NaN;
    const total = (totals.get(pid) ?? 0) + memory;
    if (!Number.isSafeInteger(memory) || !Number.isSafeInteger(total)) {
      totals.delete(pid);
      unavailable.add(pid);
    } else totals.set(pid, total);
  }
  return totals;
}

/** Create a bounded NVIDIA sampler; failures preserve unknown measurements.
 * @param {{exec: Function, resolveExe?: Function, warn: Function}} deps Command seams.
 * @returns {{probe: Function, isAvailable: Function, sample: Function, reset: Function}} Sampler.
 * @since 0.19.2
 */
function createNvidiaGpu(deps) {
  const resolveExe = deps.resolveExe || resolveNvidiaExecutable;
  let executable = null;
  let available = false;
  let warned = false;
  let probePromise = null;
  return {
    probe() {
      if (probePromise) return probePromise;
      probePromise = Promise.resolve()
        .then(() => {
          executable = resolveExe();
          if (!executable) throw new Error('NVIDIA CLI unavailable');
          return deps.exec(executable.file, ['--query-gpu=name', '--format=csv,noheader'], {
            ...OPTIONS,
            cwd: executable.cwd,
          });
        })
        .then((out) => {
          available = typeof out === 'string' && out.trim().length > 0;
        })
        .catch(() => {
          available = false;
        })
        .then(() => {
          if (!available && !warned) {
            warned = true;
            deps.warn(
              'GPU metrics degraded: admitted NVIDIA CLI unavailable — per-PID GPU memory disabled (gpu:null)',
            );
          }
          return { available };
        });
      return probePromise;
    },
    isAvailable() {
      return available;
    },
    async sample() {
      if (!available || !executable) return new Map();
      try {
        const text = await deps.exec(
          executable.file,
          ['--query-compute-apps=pid,used_gpu_memory', '--format=csv,noheader,nounits'],
          { ...OPTIONS, cwd: executable.cwd },
        );
        return parseGpuCsv(text);
      } catch {
        return new Map();
      }
    },
    reset() {
      executable = null;
      available = false;
      warned = false;
      probePromise = null;
    },
  };
}

module.exports = { resolveNvidiaExecutable, parseGpuCsv, createNvidiaGpu };
