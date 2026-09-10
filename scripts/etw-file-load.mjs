import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { LOAD_PROFILE, runReadPhase } from './etw-file-workload.mjs';

/** Run the fixed workload off the supervisor's event loop, retaining partial results.
 * @param {string} file - Disposable fixture path, never included in returned metrics.
 * @param {Function} observe - Synchronous supervisor/observation contract check.
 * @param {Object} report - Mutable aggregate to retain even when a worker fails.
 * @returns {Promise<void>} Resolves only after all phases and a clean worker exit.
 * @since v0.14.2
 */
export async function runFileLoad(file, observe, report) {
  Object.assign(report, {
    profile: LOAD_PROFILE,
    monitorIntervalMs: 25,
    phases: [],
    completed: false,
  });
  const worker = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: { mode: 'fixed-file-load', file },
  });
  const started = performance.now();
  let monitor, timeout;
  try {
    await new Promise((resolve, reject) => {
      let complete = false;
      worker.on('message', (message) => {
        if (message.type === 'phase' && report.phases.length < LOAD_PROFILE.phases.length)
          report.phases.push(message.result);
        else if (message.type === 'complete') complete = true;
        else reject(new Error('workload-invalid-result'));
      });
      worker.on('error', () => reject(new Error('workload-worker-failed')));
      worker.on('exit', (code) => {
        if (code === 0 && complete && report.phases.length === LOAD_PROFILE.phases.length)
          resolve();
        else reject(new Error('workload-incomplete'));
      });
      monitor = setInterval(() => {
        try {
          observe();
        } catch {
          reject(new Error('workload-sensor-failed'));
        }
      }, report.monitorIntervalMs);
      timeout = setTimeout(() => reject(new Error('workload-deadline')), LOAD_PROFILE.timeoutMs);
    });
    observe();
    report.completed = true;
  } finally {
    clearInterval(monitor);
    clearTimeout(timeout);
    await worker.terminate();
    report.durationMs = performance.now() - started;
  }
}

if (!isMainThread) {
  if (workerData?.mode !== 'fixed-file-load') throw new Error('workload-invalid-mode');
  for (const phase of LOAD_PROFILE.phases) {
    parentPort.postMessage({ type: 'phase', result: await runReadPhase(workerData.file, phase) });
    await delay(LOAD_PROFILE.settleMs);
  }
  parentPort.postMessage({ type: 'complete' });
}
