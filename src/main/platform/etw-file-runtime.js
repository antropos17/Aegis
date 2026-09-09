/** @file Explicit development-only ETW startup. Diagnostic paths stay in main memory. */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createSupervisor } = require('./etw-file-supervisor');

/** Attach the optional backend to application lifetime without adding renderer IPC.
 * Packaged enablement awaits provenance, crash-recovery and live admission gates.
 * @param {Object} options - app, powerMonitor, argv and optional process test seams.
 * @returns {Object} Sensor runtime; no filesystem activity is routed downstream.
 * @since v0.14.2
 */
function createRuntime({
  app,
  powerMonitor,
  argv = process.argv,
  platform = process.platform,
  spawnProcess = spawn,
  exists = fs.existsSync,
}) {
  const prefix = '--etw-file-diagnostic-root=';
  const roots = argv.filter((value) => value.startsWith(prefix));
  const root = roots[0]?.slice(prefix.length);
  const executable = path.resolve(
    __dirname,
    '../../../sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe',
  );
  const sensor = createSupervisor({
    spawnBroker: (launchId, sessionId) =>
      spawnProcess(executable, ['broker', launchId, sessionId, root], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
      }),
  });
  const validRoot =
    typeof root === 'string' &&
    /^[A-Za-z]:\\[^\\]/.test(root) &&
    root.length <= 1024 &&
    !/[\p{Cc}/]/u.test(root) &&
    !root.slice(3).includes(':') &&
    root
      .split('\\')
      .slice(1)
      .every((part) => part !== '.' && part !== '..' && !/[. ]$/.test(part));
  let permitted = false;
  if (platform !== 'win32') sensor.setUnavailable('UNSUPPORTED', 'windows-only');
  else if (roots.length === 0) sensor.setUnavailable('DISABLED', 'diagnostic-opt-in-required');
  else if (app.isPackaged) sensor.setUnavailable('DISABLED', 'deployment-gates-pending');
  else if (roots.length !== 1 || !validRoot)
    sensor.setUnavailable('FAILED', 'invalid-diagnostic-root');
  else if (!exists(executable)) sensor.setUnavailable('FAILED', 'diagnostic-broker-missing');
  else permitted = true;
  let paused = false,
    suspended = false;
  const onSuspend = () => {
    suspended = true;
    sensor.stop('suspend');
  };
  const onResume = () => {
    suspended = false;
  }; // Explicit restart only; never another surprise UAC.
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  return {
    start: () => permitted && !paused && !suspended && sensor.start(),
    restart: () => permitted && !paused && !suspended && sensor.restart(),
    setPaused(value) {
      paused = value;
      if (paused) sensor.stop('pause');
    },
    getHealth: sensor.getHealth,
    getDiagnostics: sensor.getDiagnostics,
    dispose() {
      powerMonitor.removeListener('suspend', onSuspend);
      powerMonitor.removeListener('resume', onResume);
      sensor.dispose();
    },
  };
}
module.exports = { createRuntime };
