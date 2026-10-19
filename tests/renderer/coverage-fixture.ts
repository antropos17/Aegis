import { emptyTelemetry, type Telemetry } from '../../frontend/observatory/runtime/host';

/** Synthetic values matching the closed R4 public status, never native capture evidence.
 * @param platform Fixture platform @returns Reported-shape snapshot @since 0.19.2-beta
 */
export function coverageFixture(platform: 'linux' | 'darwin' | 'windows' = 'linux'): Telemetry {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      {
        agent: 'Synthetic Codex',
        process: 'codex',
        pid: 42,
        status: 'running',
        category: 'ai',
        instanceId: platform === 'darwin' ? 'unknown:42' : '42:12347',
        instanceIdSource: platform === 'darwin' ? 'unknown' : 'os',
      },
    ],
    stats: {
      appHealth: {
        state: 'DEGRADED',
        populationReliable: true,
        identityDegraded: false,
        sensors: {
          byId: {
            process: {
              state: 'HEALTHY',
              lossCount: 0,
              consecutiveFailures: 0,
              lastSuccessAt: 1792396800000,
            },
            'etw-file':
              platform === 'windows'
                ? { state: 'DISABLED', detail: 'diagnostic-opt-in-required', lossCount: 0 }
                : { state: 'UNSUPPORTED', detail: 'windows-only', lossCount: 0 },
            ...(platform === 'windows'
              ? {}
              : {
                  'native-sensor': {
                    state: 'DEGRADED',
                    detail: 'unsupported-admission',
                    lossCount: 3,
                  },
                }),
          },
        },
      },
      nativeSensor:
        platform === 'windows'
          ? null
          : {
              platform,
              phase: 'running',
              reason: 'ready',
              generation: 2,
              mode: platform === 'darwin' ? 'libproc' : 'procfs',
              modeReason: 'startup-fallback',
              providerState: 'HEALTHY',
              watchScope: platform === 'darwin' ? 'identity-unavailable' : 'current',
              pathScope: 'explicit-directories',
              paused: false,
              qualification: 'unverified',
              polling: 'unchanged',
              capabilities: {
                exec: true,
                exit: true,
                fork: false,
                fileOpen: false,
                tcpConnect: false,
              },
              coverage: {
                exec: 'coverage-lost',
                exit: 'coverage-lost',
                fork: 'coverage-lost',
                fileOpen: 'coverage-lost',
                tcpConnect: 'coverage-lost',
              },
              admission: { state: 'unsupported-admission', accepted: 0, rejected: 7 },
              lossCount: 3,
              restart: { used: 1, remaining: 2, lastAt: null },
              updates: { watchPending: false, pathsPending: false },
            },
    },
  };
}
