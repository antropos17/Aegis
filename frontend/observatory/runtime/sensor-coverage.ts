import { record, type Telemetry } from './host';

type Labels = Readonly<Record<string, string>>;
export interface SensorCoverage {
  agents: Telemetry['agents'];
  reported: boolean;
  unsupported: boolean;
  platform: string;
  mode: string;
  phase: string;
  reason: string;
  modeReason: string;
  provider: string;
  watch: string;
  paths: string;
  admission: string;
  accepted: number | null;
  rejected: number | null;
  loss: number | null;
  restarts: number | null;
  remaining: number | null;
  lastRestartAt: number | null;
  paused: boolean;
  surfaces: { key: string; label: string; state: string }[];
  sensors: {
    id: string;
    title: string;
    state: string;
    loss: number | null;
    failures: number | null;
    lastSuccessAt: number | null;
    detail: string;
  }[];
}
export const coverageStates: Labels = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  FAILED: 'Failed',
  STARTING: 'Starting',
  DISABLED: 'Off',
  UNSUPPORTED: 'Unsupported',
};
export const coverageModes: Labels = {
  ebpf: 'Linux eBPF',
  fanotify: 'Linux fanotify',
  procfs: 'Linux process polling',
  'endpoint-security': 'macOS Endpoint Security',
  libproc: 'macOS process polling',
};
export const coverageSensors: Labels = {
  process: 'Agent processes',
  'proc-snapshot': 'Process snapshot',
  'fs-chokidar': 'File changes',
  'fs-handle': 'Open files',
  'fs-rm': 'Windows file owners',
  'etw-file': 'Windows file events',
  network: 'Network connections',
  'ide-extension': 'IDE extensions',
  wsl: 'WSL guest processes',
  'llm-lmstudio': 'LM Studio',
  'llm-ollama': 'Ollama',
  'native-sensor': 'Native sensor delivery',
};
export const coverageScopes: Labels = {
  current: 'Current process watch set',
  'identity-unavailable': 'Native process identity unavailable',
  'process-observation-unavailable': 'Current process observation unavailable',
  'awaiting-process-observation': 'Waiting for a process observation',
  'watch-update-rejected': 'Process watch update rejected',
  paused: 'Paused',
  'awaiting-start': 'Waiting for sensor startup',
  'explicit-directories': 'Explicit directory prefixes only',
  'paths-update-rejected': 'Directory scope update rejected',
};
export const coverageReasons: Labels = {
  ready: 'Provider ready',
  disabled: 'Off',
  'unsupported-admission': 'Native event delivery is not qualified',
  'permission-denied': 'Permission denied',
  'startup-fallback': 'Fallback selected at startup',
  'attach-failed': 'Sensor attachment failed',
  'read-failed': 'Sensor read failed',
  recovery: 'Recovery mode selected',
  requested: 'Requested mode selected',
  starting: 'Starting',
  'ring-full': 'Sensor ring buffer full',
  'queue-full': 'Sensor queue full',
  'verifier-limit': 'Sensor verifier limit reached',
  'loss-observed': 'Observation loss reported',
  'identity-context-unavailable': 'Process birth context unavailable',
  'health-timeout': 'Provider health timed out',
  'hello-timeout': 'Provider startup timed out',
  'child-closed': 'Provider exited',
  'sensor-failed': 'Provider failed',
  'sink-rejected': 'Event delivery rejected',
  'custody-unconfirmed': 'Event custody unconfirmed',
  'binary-missing': 'Sensor executable is missing',
  'launch-failed': 'Sensor could not start',
  'restart-pending': 'Restart scheduled',
  'restart-exhausted': 'Restart limit reached',
  'stream-failed': 'Sensor communication failed',
  'protocol-failed': 'Invalid sensor communication',
  'stream-ended': 'Sensor communication ended',
  'request-encoding-failed': 'Sensor request could not be encoded',
  'write-failed': 'Sensor request could not be sent',
  'request-timeout': 'Sensor request timed out',
  'session-invalid': 'Invalid sensor session',
  'snapshot-rejected': 'Process snapshot request rejected',
  'stop-rejected': 'Sensor stop request rejected',
  'update-rejected': 'Sensor scope update rejected',
  'snapshot-consumer-failed': 'Process snapshot could not be handled',
  'request-id-exhausted': 'Sensor request limit reached',
  unsupported: 'Unsupported',
  'diagnostic-opt-in-required': 'Optional diagnostic capture is off.',
  'deployment-gates-pending': 'Diagnostic capture is unavailable in this build.',
  'rm-owns-observation': 'Resource Manager is handling this observation.',
  class5: 'Windows process snapshot provider is active.',
  'cim-fallback': 'Using a fallback process snapshot provider.',
  'windows-only': 'Available on Windows only.',
  'wsl-process-coverage-unavailable': 'Guest-process observation is unavailable',
};
export const coveragePhases: Labels = {
  idle: 'Idle',
  starting: 'Starting',
  running: 'Running',
  closing: 'Closing',
  stopping: 'Stopping',
  stopped: 'Stopped',
  unavailable: 'Unavailable',
  waiting: 'Waiting for restart',
  failed: 'Failed',
};
export const coverageSurfaces: Labels = {
  exec: 'Process execution',
  exit: 'Process exits',
  fork: 'Child process creation',
  fileOpen: 'File opens',
  tcpConnect: 'TCP connection attempts',
};

/** Select a fixed display label without exposing arbitrary diagnostic strings.
 * @param labels Closed display vocabulary @param value Host value
 * @returns Localizable label @since 0.19.2-beta
 */
export function coverageLabel(labels: Labels, value: unknown): string {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : 'Not reported';
}

/** Read an actual cumulative counter; absence and invalid input remain unknown.
 * @param value Host measurement @returns Counter or null @since 0.19.2-beta
 */
export function coverageCount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
    ? value
    : null;
}

/** Format a reported epoch, without substituting the current time.
 * @param value Host timestamp @param locale UI locale
 * @returns Timestamp or localizable absence @since 0.19.2-beta
 */
export function coverageTime(value: unknown, locale: string): string {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 8640000000000000
    ? new Date(value).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US')
    : 'Not reported';
}

function reportedTime(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 8640000000000000
    ? value
    : null;
}

/** Project only the closed R4 native status and existing health leaves.
 * Provider health never establishes delivery or blocking; R4 admission is unqualified.
 * @param telemetry Current delivered snapshot @returns Bounded presentation model @since 0.19.2-beta
 */
export function sensorCoverage(telemetry: Telemetry): SensorCoverage {
  const native = record(telemetry.stats.nativeSensor);
  const admission = record(native.admission);
  const restart = record(native.restart);
  const platform =
    native.platform === 'linux' ? 'Linux' : native.platform === 'darwin' ? 'macOS' : 'Not reported';
  const seen = new Set<string>();
  const agents = telemetry.agents.filter((agent) => {
    if (agent.category !== 'ai') return false;
    if (!agent.instanceId) return true;
    if (seen.has(agent.instanceId)) return false;
    seen.add(agent.instanceId);
    return true;
  });
  const sensors = Object.entries(
    record(record(record(telemetry.stats.appHealth).sensors).byId),
  ).map(([id, value], index) => {
    const leaf = record(value);
    return {
      id: Object.hasOwn(coverageSensors, id) ? id : 'other-' + index,
      title:
        coverageLabel(coverageSensors, id) === 'Not reported'
          ? 'Other sensor'
          : coverageLabel(coverageSensors, id),
      state: coverageLabel(coverageStates, leaf.state),
      loss: coverageCount(leaf.lossCount),
      failures: coverageCount(leaf.consecutiveFailures),
      lastSuccessAt: reportedTime(leaf.lastSuccessAt),
      detail: coverageLabel(coverageReasons, leaf.detail ?? leaf.lastError),
    };
  });
  return {
    agents,
    reported: Object.keys(native).length > 0,
    unsupported: telemetry.stats.nativeSensor === null,
    platform,
    mode: coverageLabel(coverageModes, native.mode),
    phase: coverageLabel(coveragePhases, native.phase),
    reason: coverageLabel(coverageReasons, native.reason),
    modeReason: coverageLabel(coverageReasons, native.modeReason),
    provider: coverageLabel(coverageStates, native.providerState),
    watch: coverageLabel(coverageScopes, native.watchScope),
    paths: coverageLabel(coverageScopes, native.pathScope),
    admission:
      admission.state === 'unsupported-admission'
        ? 'Native event delivery is not qualified'
        : 'Not reported',
    accepted: coverageCount(admission.accepted),
    rejected: coverageCount(admission.rejected),
    loss: coverageCount(native.lossCount),
    restarts: coverageCount(restart.used),
    remaining: coverageCount(restart.remaining),
    lastRestartAt: reportedTime(restart.lastAt),
    paused: native.paused === true,
    surfaces: Object.entries(coverageSurfaces).map(([key, label]) => ({
      key,
      label,
      // R4 has no admitted native event path, even when a provider reports HEALTHY.
      state:
        record(native.coverage)[key] === 'coverage-lost' ||
        admission.state === 'unsupported-admission'
          ? 'Coverage lost'
          : 'Not reported',
    })),
    sensors,
  };
}
