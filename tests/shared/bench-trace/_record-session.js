/**
 * @file tests/shared/bench-trace/_record-session.js
 * @description One scripted recording session, runnable in two postures.
 *
 *   ```
 *   node --require bench/trace/preload.js tests/shared/bench-trace/_record-session.js \
 *     <tap|no-tap> <runDir> [traceDir]
 *   ```
 *
 *   - `tap`    — the session runs through `bench/trace/recorder.js`: providers wrapped
 *                record-and-pass-through, observations appended, and the trace derived
 *                offline into `traceDir`.
 *   - `no-tap` — the SAME session, the SAME scripted providers, wired straight through
 *                `wiring.wireGraph` with no tap anywhere. What this posture exists to
 *                prove is that the tap does not change what the sensor observes or
 *                decides: the two postures' audit bytes must be identical.
 *
 *   One session definition drives both postures through one driver interface, so the
 *   equality claim compares the tap and nothing else.
 *
 *   THE PROVIDERS ARE SCRIPTED, AND THE PATHS ARE SYNTHETIC, on purpose. A committed
 *   suite cannot depend on what this machine's handle tables and DNS answer today —
 *   determinism is the point of the whole subtree. And every staged path lives under a
 *   root that `bench/lib/paths.js` does not rewrite, so the recording's own audit
 *   bytes and the derived trace's replay verdict can be compared byte for byte
 *   (neutralization is the identity on them).
 *
 *   Not named `*.test.js`, so vitest does not collect it; it is spawned by
 *   `recorder-roundtrip.test.js` exactly the way `harness-replay.test.js` spawns the
 *   replay — the clock has to be installed before any product module is compiled.
 *   Prints one JSON line: `{auditFile, observationsPath, traceDir?}`.
 * @author AEGIS Contributors
 * @license MIT
 */

'use strict';

const path = require('path');

const harness = require('../../../bench/trace/harness');
const recorder = require('../../../bench/trace/recorder');
const wiring = require('../../../bench/trace/wiring');
const clockModule = require('../../../bench/trace/clock');

/** @type {string} A root neither the repo-root nor the `\Users\<name>\` rewrite touches. */
const BASE = process.platform === 'win32' ? 'X:\\bench-rt' : '/bench-rt';

/** @type {string} The staged agent's cwd. */
const PROJ = path.join(BASE, 'proj');

/**
 * The scripted providers — deterministic, machine-independent.
 * @returns {Object} The provider set, in the shape `recorder.setUpRecording` wraps.
 */
function scriptedProviders() {
  return {
    getFileHandles: async (pid) => (pid === 4812 ? [path.join(PROJ, 'secrets', 'id_rsa')] : []),
    getHotSensitiveHolders: async () => [
      { pid: 4812, group: path.join(PROJ, 'creds'), reason: 'scripted-credential-store' },
    ],
    getRawTcpConnections: async () => [
      { pid: 4812, ip: '203.0.113.10', port: 443, state: 'Established' },
    ],
    dnsReverse: async () => {
      throw new Error('scripted-failure');
    },
    dnsResolve: async () => {
      throw new Error('scripted-failure');
    },
  };
}

/**
 * The one agent the session stages.
 * @param {number} epochMs
 * @returns {Object}
 */
function agent(epochMs) {
  return {
    agent: 'Claude Code',
    pid: 4812,
    process: 'claude.exe',
    instanceId: `4812:${epochMs}`,
    cwd: PROJ,
    category: 'ai',
    parentEditor: null,
  };
}

/**
 * The session itself, written once and driven through either posture.
 * @param {Object} driver - `{setPopulation, fsEvent, advanceClock, handlesTick,
 *   rmHotTick, netTick, finish}`.
 * @param {number} epochMs
 * @returns {Promise<Object>} What `finish()` returned.
 */
async function runSession(driver, epochMs) {
  driver.setPopulation([agent(epochMs)]);
  // Its own config dir (self-config-path), then a secret beside it (cwd-containment).
  driver.fsEvent('created', path.join(PROJ, '.claude', 'settings.json'));
  driver.fsEvent('created', path.join(PROJ, '.env'));
  // Past the scan loop's 30 s dedup window, exactly as a real cadence would be.
  driver.advanceClock(epochMs + 31_000);
  await driver.handlesTick();
  await driver.rmHotTick();
  driver.advanceClock(epochMs + 31_010);
  await driver.netTick();
  return driver.finish();
}

/**
 * The no-tap posture: the same graph, the same scripted providers, no recorder.
 * @param {Object} providers - The scripted set, unwrapped.
 * @param {string} runDir
 * @returns {Object} A driver with the same interface `recorder.Recording` has.
 */
function noTapDriver(providers, runDir) {
  const wired = wiring.wireGraph({
    runDir,
    settings: {},
    fileWatcherDeps: {
      getFileHandles: providers.getFileHandles,
      getHotSensitiveHolders: providers.getHotSensitiveHolders,
    },
    networkMonitorDeps: {
      getRawTcpConnections: providers.getRawTcpConnections,
      dnsReverse: providers.dnsReverse,
      dnsResolve: providers.dnsResolve,
    },
  });
  const calls = {
    dedupFileEvent: wired.modules.scanLoop.dedupFileEvent,
    logAuditForFile: wired.modules.scanLoop.logAuditForFile,
    scanAllFileHandles: (agents) => wired.modules.fileWatcher.scanAllFileHandles(agents),
    scanHotFileHolders: (agents) => wired.modules.fileWatcher.scanHotFileHolders(agents),
  };
  harness.installFileEventHook(wired, calls);
  const clock = clockModule.currentClock();
  return {
    setPopulation(agents) {
      wired.ambient.agents = agents;
    },
    fsEvent(action, filePath) {
      wired.modules.fileWatcher.handleWatcherEvent(action, filePath);
    },
    advanceClock(toEpochMs) {
      clock.advanceTo(toEpochMs);
    },
    async handlesTick() {
      const events = await calls.scanAllFileHandles(wired.ambient.all());
      harness.pipeFileEvents(events, calls);
    },
    async rmHotTick() {
      const events = await calls.scanHotFileHolders(wired.ambient.all());
      harness.pipeFileEvents(events, calls);
    },
    async netTick() {
      wired.modules.scanLoop.doNetworkScan();
      await harness.drainUntil(
        () => !wired.modules.networkMonitor.isNetworkScanRunning(),
        'doNetworkScan',
      );
    },
    finish() {
      return wiring.tearDown(wired);
    },
  };
}

/**
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {Promise<number>} The process exit code.
 */
async function main(argv) {
  const [mode, runDir, traceDir] = argv;
  if ((mode !== 'tap' && mode !== 'no-tap') || !runDir || (mode === 'tap' && !traceDir)) {
    console.error('usage: _record-session.js <tap|no-tap> <runDir> [traceDir]');
    return 2;
  }
  const epochMs = clockModule.installedEpochMs();
  const providers = scriptedProviders();

  if (mode === 'tap') {
    const recording = recorder.setUpRecording({ runDir, providers, settings: {} });
    // The one-graph-per-process latch, exercised where it can actually fire: the
    // clock guard still passes here (nothing has advanced it yet), so what refuses
    // a second wiring is the latch and nothing earlier.
    try {
      recorder.setUpRecording({ runDir: path.join(runDir, 'second'), providers, settings: {} });
      console.error('a second setUpRecording in one process was NOT refused');
      return 1;
    } catch (err) {
      if (err.reason !== 'record-malformed' || !/already been wired/.test(err.message)) {
        console.error(`the second setUpRecording refused for the wrong reason: ${err.message}`);
        return 1;
      }
    }
    const finished = await runSession(recording, epochMs);
    if (finished.auditFiles.length !== 1) {
      console.error(`expected exactly one daily audit file, got ${finished.auditFiles.length}`);
      return 1;
    }
    recorder.deriveTrace({ runDir, traceDir, id: 'T1-recorded-session' });
    console.log(
      JSON.stringify({
        auditFile: path.join(finished.auditDir, finished.auditFiles[0]),
        observationsPath: finished.observationsPath,
        traceDir,
      }),
    );
    return 0;
  }

  const finished = await runSession(noTapDriver(providers, runDir), epochMs);
  if (finished.auditFiles.length !== 1) {
    console.error(`expected exactly one daily audit file, got ${finished.auditFiles.length}`);
    return 1;
  }
  console.log(JSON.stringify({ auditFile: path.join(finished.auditDir, finished.auditFiles[0]) }));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  },
);
