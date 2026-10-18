/** @file Explicit opt-in ETW diagnostics. Candidate paths stay in main memory. */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createSupervisor } = require('./etw-file-supervisor');
const { createReadView } = require('./etw-file-attribution');

/** Attach the optional backend to application lifetime without adding renderer IPC.
 * Only a marked diagnostic build may capture in a package; production stays gated.
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
  packageMetadata = require('../../../package.json'),
  resourcesPath = process.resourcesPath,
  onHealthChange,
  getAgents = () => [],
  getPopulationHealth = () => ({}),
  classifySensitive = () => null,
}) {
  const readView = createReadView({ getAgents, getHealth: getPopulationHealth, classifySensitive });
  const prefix = '--etw-file-diagnostic-root=';
  const roots = argv.filter((value) => value.startsWith(prefix));
  const root = roots[0]?.slice(prefix.length);
  const faults = argv.filter((value) => value.startsWith('--etw-file-diagnostic-fault='));
  const observers = argv.filter((value) => value.startsWith('--etw-file-diagnostic-observer='));
  const observer = observers[0]?.slice('--etw-file-diagnostic-observer='.length);
  const observerParts = observer?.split(':') ?? [];
  const validObserver =
    typeof observer === 'string' &&
    observer.length <= 80 &&
    /^[0-9a-f]{32}:[1-9]\d{0,9}:[1-9]\d{0,18}$/.test(observer) &&
    observerParts[0] !== '0'.repeat(32) &&
    Number(observerParts[1]) <= 0x7fffffff &&
    BigInt(observerParts[2]) <= 0x7fffffffffffffffn;
  const faultModes = {
    'collector-exit': 'broker-crash-check',
    'collector-before-start': 'broker-prestart-check',
    'collector-before-arm': 'broker-prearm-check',
    'guard-exit': 'broker-guard-check',
    'broker-exit': 'broker-exit-check',
    'dual-guard-first': 'broker-dual-guard-check',
    'dual-collector-first': 'broker-dual-collector-check',
    'dual-before-arm': 'broker-dual-prearm-check',
    'dual-before-start': 'broker-dual-prestart-check',
    'triple-collector-first': 'broker-triple-collector-check',
    'triple-guard-first': 'broker-triple-guard-check',
    'triple-fallback-first': 'broker-triple-fallback-check',
    'triple-before-arm': 'broker-triple-prearm-check',
    'triple-before-start': 'broker-triple-prestart-check',
    'triple-access-denied': 'broker-triple-denial-check',
    'group-before-start': 'broker-group-prestart-check',
    'group-before-arm': 'broker-group-prearm-check',
    'group-broker-first': 'broker-group-first-check',
    'group-triple-first': 'broker-group-triple-check',
    'group-access-denied': 'broker-group-denial-check',
    'orphan-before-start': 'broker-orphan-prestart-check',
    'orphan-before-arm': 'broker-orphan-prearm-check',
    'orphan-main-first': 'broker-orphan-main-check',
    'orphan-native-first': 'broker-orphan-native-check',
    'orphan-access-denied': 'broker-orphan-denial-check',
    'custodian-exit': 'broker-custodian-exit-check',
    'orphan-total-before-start': 'broker-orphan-total-prestart-check',
    'orphan-total-before-arm': 'broker-orphan-total-prearm-check',
    'orphan-total-running': 'broker-orphan-total-running-check',
    'orphan-total-denial': 'broker-orphan-total-running-check',
    'orphan-recovery-denial': 'broker-orphan-recovery-denial-check',
  };
  const fault = faults[0]?.slice('--etw-file-diagnostic-fault='.length);
  const diagnosticPackage = packageMetadata.aegisEtwDiagnostic === true;
  const executable =
    app.isPackaged && diagnosticPackage
      ? path.join(resourcesPath, 'etw-file', 'EtwFile.exe')
      : path.resolve(
          __dirname,
          '../../../sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe',
        );
  const sensor = createSupervisor({
    maxCaptureMs: 60000,
    onHealthChange,
    onObservations: (records) => readView.accept(records),
    onSessionStart: () => readView.reset(),
    spawnBroker: (launchId, sessionId) =>
      spawnProcess(
        executable,
        [
          faults.length ? faultModes[fault] : 'broker',
          launchId,
          sessionId,
          root,
          ...(app.isPackaged && diagnosticPackage ? ['main-escrow'] : []),
          ...(observer === undefined ? [] : [observer]),
        ],
        {
          windowsHide: true,
          shell: false,
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      ),
    spawnRecovery:
      app.isPackaged && diagnosticPackage
        ? (launchId, sessionId) =>
            spawnProcess(
              executable,
              [
                fault === 'group-access-denied' ? 'rescue-denial-check' : 'rescue',
                launchId,
                sessionId,
              ],
              { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] },
            )
        : null,
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
  else if (app.isPackaged && !diagnosticPackage)
    sensor.setUnavailable('DISABLED', 'deployment-gates-pending');
  else if (roots.length !== 1 || !validRoot)
    sensor.setUnavailable('FAILED', 'invalid-diagnostic-root');
  else if (
    faults.length &&
    (!app.isPackaged ||
      !diagnosticPackage ||
      faults.length !== 1 ||
      !Object.hasOwn(faultModes, fault))
  )
    sensor.setUnavailable('FAILED', 'invalid-diagnostic-fault');
  else if (
    observers.length &&
    (!app.isPackaged ||
      !diagnosticPackage ||
      observers.length !== 1 ||
      !validObserver ||
      !(fault?.startsWith('orphan-') || fault === 'custodian-exit'))
  )
    sensor.setUnavailable('FAILED', 'invalid-diagnostic-observer');
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
    getReadView: () =>
      permitted
        ? {
            ...readView.snapshot(),
            phase: sensor.getDiagnostics().phase,
            lossCount: sensor.getHealth().lossCount,
          }
        : null,
    isActive: sensor.isActive,
    dispose() {
      powerMonitor.removeListener('suspend', onSuspend);
      powerMonitor.removeListener('resume', onResume);
      return sensor.dispose();
    },
  };
}
module.exports = { createRuntime };
