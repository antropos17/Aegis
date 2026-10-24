import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ERROR_CODES } = require('../../../src/main/platform/etw-file-protocol');
const REASONS = new Set([
  ...ERROR_CODES,
  'mapping-uncertain',
  'identity-uncertain',
  'population-unavailable',
  'schema-gap',
  'recovery-consent-pending',
  'stage-loss-unmeasured',
  'recovery-verified',
  'collector-and-guard-exited',
  'all-three-helpers-exited',
  'broker-and-all-helpers-exited',
  'transport-gap',
  'experimental-correlation',
  'counter-time-regressed',
  'counter-regressed',
  'unmeasured-interval',
  'eventsLost',
  'realTimeBuffersLost',
  'logBuffersLost',
  'dropped',
  'ingressDropped',
  'outputDropped',
  'outputOverflowDropped',
  'outputInvalidatedDropped',
  'decoderErrors',
  'mapResets',
  'mapConflicts',
]);
const PHASES = new Set([
  'disabled',
  'starting',
  'running',
  'stopping',
  'stopped',
  'recovering',
  'recovered',
  'failed',
]);
const STAGES = new Set([
  'observer-endpoint',
  'app-launch',
  'window',
  'monitoring-heading',
  'journal-reservation',
  'reserved-observation',
  'process-inventory',
]);
const OBSERVER_PHASES = new Set([
  'before-start',
  'before-arm',
  'running',
  'triple-exited',
  'journal-recovered',
  'journal-denied',
]);
const OBSERVER_ERRORS = new Set([
  'none',
  'spawn-failed',
  'frame-refused',
  'malformed-json',
  'native-stderr',
  'native-failure',
  'observer-failed',
]);
const FAILURE_STAGES = new Set([
  'EndpointSetup',
  'NoticeRead',
  'NoticeParse',
  'NoticeIdentity',
  'PeerVerification',
  'OriginalHandleObservation',
  'ReservedOutput',
  'ObservationRead',
  'TerminalObservation',
  'PeerExitObservation',
]);
const RECOVERY_CAUSES = new Set([
  'collector-exited',
  'collector-and-guard-exited',
  'all-three-helpers-exited',
  'broker-and-all-helpers-exited',
]);
const STOP_REASONS = new Set([
  'operator-stop',
  'pause',
  'suspend',
  'restart',
  'shutdown',
  'duration-limit',
]);
const TOTALS = [
  'delivered',
  'filtered',
  'dropped',
  'ingressDropped',
  'outputDropped',
  'outputOverflowDropped',
  'outputInvalidatedDropped',
  'decoderErrors',
  'mapEpoch',
  'mapResets',
  'mapConflicts',
];
const COUNTERS = ['eventsLost', 'realTimeBuffersLost', 'logBuffersLost', 'queryStatus', 'asOfQpc'];
const integer = (v) => (Number.isSafeInteger(v) ? v : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);
const decimal = (v) => (typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v) ? v : null);
const numberMap = (v, keys) =>
  v && typeof v === 'object'
    ? Object.fromEntries(
        keys.map((k) => [k, typeof v[k] === 'number' ? integer(v[k]) : decimal(v[k])]),
      )
    : null;
const ids = (v, maximum) =>
  Array.isArray(v)
    ? v.filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff).slice(0, maximum)
    : [];
const exits = (v) => (Array.isArray(v) ? v.slice(0, 5).map(integer) : null);
const performance = (v) =>
  v && typeof v === 'object'
    ? Object.fromEntries(
        ['decodeChunk', 'acceptFrame', 'retainBatch', 'snapshot'].map((key) => [
          key,
          numberMap(v[key], ['calls', 'totalTicks', 'maxTicks', 'failed']),
        ]),
      )
    : null;

function capture(v) {
  return v && typeof v === 'object'
    ? {
        buffers: numberMap(v.buffers, ['count', 'sizeKiB']),
        frequency: decimal(v.frequency),
        clock: numberMap(v.clock, ['qpc', 'unixMs', 'uncertaintyQpc']),
        objectBridge:
          v.objectBridge === 'win11-x64-26300.9457-experimental' ? v.objectBridge : null,
      }
    : null;
}

/** Project actual runtime diagnostics without records, paths, private leases or endpoints.
 * @param {object|null} value Actual marked-main snapshot.
 * @returns {object|null} Detached bounded startup report. @since v0.20.1
 */
export function projectStartupDiagnostics(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    phase: PHASES.has(value.phase) ? value.phase : null,
    ...Object.fromEntries(
      ['restartBlocked', 'recoveryPending', 'cleanupConsentPending', 'custodyObserved'].map(
        (key) => [key, bool(value[key])],
      ),
    ),
    ...Object.fromEntries(
      ['ringBytes', 'ringDropped', 'omittedSummaries', 'pendingBytes'].map((key) => [
        key,
        integer(value[key]),
      ]),
    ),
    nativeProcessIds: ids(value.nativeProcessIds, 4),
    mainPerformance: performance(value.mainPerformance),
    summaries: (Array.isArray(value.summaries) ? value.summaries : [])
      .filter((row) => row && typeof row === 'object')
      .slice(-2)
      .map((row) => ({
        phase: PHASES.has(row.phase) ? row.phase : null,
        reasons: (Array.isArray(row.reasons) ? row.reasons : [])
          .filter((v) => REASONS.has(v))
          .slice(0, 32),
        transportExitCode: integer(row.exitCode),
        collectorExit: integer(row.collectorExit),
        brokerExit: integer(row.brokerExit),
        stopReason: STOP_REASONS.has(row.stopReason) ? row.stopReason : null,
        recoveryCause: RECOVERY_CAUSES.has(row.recoveryCause) ? row.recoveryCause : null,
        recoveryPeers:
          row.recoveryPeers && typeof row.recoveryPeers === 'object'
            ? {
                guardExit: integer(row.recoveryPeers.guardExit),
                fallbackExit: integer(row.recoveryPeers.fallbackExit),
                brokerElevated: bool(row.recoveryPeers.brokerElevated),
                cleanupElevated: bool(row.recoveryPeers.cleanupElevated),
                accessDenied: bool(row.recoveryPeers.accessDenied),
              }
            : null,
        ...Object.fromEntries(
          ['stopVerified', 'recoveryVerified', 'observationGap'].map((key) => [
            key,
            bool(row[key]),
          ]),
        ),
        capture: capture(row.capture),
        maxima: numberMap(row.maxima, [...COUNTERS, ...TOTALS]),
        finalCounters: numberMap(row.finalCounters, COUNTERS),
        finalTotals: numberMap(row.finalTotals, TOTALS),
        mainPerformance: performance(row.mainPerformance),
      })),
  };
}

function observerProjection(observer) {
  let status, events;
  try {
    status = observer.getDiagnostics?.();
    events = observer.events();
  } catch {
    /* Unknown remains unknown. */
  }
  return {
    exitCode: integer(status?.exitCode ?? observer.child?.exitCode),
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(status?.signal ?? observer.child?.signalCode)
      ? (status?.signal ?? observer.child.signalCode)
      : null,
    errorCode: OBSERVER_ERRORS.has(status?.errorCode) ? status.errorCode : null,
    failureStage: FAILURE_STAGES.has(status?.failureStage) ? status.failureStage : null,
    stderrBytes: integer(status?.stderrBytes),
    stdoutBytes: integer(status?.stdoutBytes),
    pendingBytes: integer(status?.pendingBytes),
    stdoutClosed: bool(status?.stdoutClosed),
    events: (Array.isArray(events) ? events : [])
      .filter(
        (v) => v && ['reserved', 'phase', 'terminal', 'peer-exit', 'failure'].includes(v.type),
      )
      .slice(-10)
      .map((v) => ({
        type: v.type,
        kind: OBSERVER_PHASES.has(v.kind) ? v.kind : null,
        stage: FAILURE_STAGES.has(v.stage) ? v.stage : null,
        custodianPid: ids([v.custodianPid], 1)[0] ?? null,
        originalPids: ids(v.originalPids, 5),
        originalObjectsObserved: bool(v.originalObjectsObserved),
        custodianExit: integer(v.custodianExit),
        originalExits: exits(v.originalExits),
      })),
  };
}

/** Observe reservation without hiding observer failure or racing a concurrent notice.
 * @param {object} options Actual observer, main diagnostics and finite wait policy.
 * @returns {Promise<object>} The independently observed reservation. @since v0.20.1
 */
export async function waitForJournalReservation({
  observer,
  readDiagnostics,
  onSnapshot,
  now = Date.now,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 135000,
}) {
  const reserved = () => observer.events().some((message) => message.type === 'reserved');
  const until = now() + timeoutMs;
  while (!reserved() && now() < until) {
    observer.assertAvailable();
    const data = await readDiagnostics();
    onSnapshot(data);
    if (reserved()) break;
    observer.assertAvailable();
    if (data.summaries.length)
      throw Error('Capture ended before journal reservation: ' + data.summaries.at(-1).exitCode);
    await pause(100);
  }
  return observer.until((message) => message.type === 'reserved', 1000);
}

/** Persist pre-cleanup evidence before ending the owned main and observer.
 * @param {object} options Owned output, actual snapshots and finite cleanup callbacks.
 * @returns {Promise<void>} Evidence is written before either cleanup action. @since v0.20.1
 */
export async function retainStartupFailure({
  out,
  stage,
  lastObserved,
  observer,
  readDiagnostics,
  closeMain,
}) {
  try {
    let latest = null,
      timer;
    try {
      latest = await Promise.race([
        Promise.resolve().then(readDiagnostics),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        }),
      ]);
    } catch {
      /* Preserve the already observed failed summary if a fresh read is unavailable. */
    } finally {
      clearTimeout(timer);
    }
    await observer.drainExited?.();
    const receipt = {
      schema: 'aegis-etw-startup-failure/1',
      status: 'FAIL',
      productionAdmission: false,
      stage: STAGES.has(stage) ? stage : 'unknown',
      capturedBeforeCleanup: true,
      lastObserved: projectStartupDiagnostics(lastObserved),
      beforeCleanup: projectStartupDiagnostics(latest),
      observer: observerProjection(observer),
      streams: {
        brokerStdout: 'framed-protocol-consumed-by-runtime',
        brokerStderr: 'discarded-by-runtime',
        collectorOutput: 'not-exposed-by-qualification-host',
        observerStderr: 'metadata-only',
      },
    };
    const bytes = JSON.stringify(receipt, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > 16384) throw new Error('startup-evidence-budget');
    fs.writeFileSync(path.join(out, 'startup-failure.json'), bytes, { flag: 'wx', mode: 0o600 });
  } finally {
    try {
      await closeMain();
    } finally {
      observer.stop();
    }
  }
}
