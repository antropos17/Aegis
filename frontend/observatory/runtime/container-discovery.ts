import type {
  DockerContainerCandidate,
  DockerDiscoverySnapshot,
  PodmanContainerCandidate,
  PodmanDiscoverySnapshot,
} from '../../../src/shared/types/process';

export type ContainerRuntime = 'docker' | 'podman';
export type ContainerDiscoverySnapshot = Omit<DockerDiscoverySnapshot, 'reason' | 'candidates'> & {
  readonly reason: DockerDiscoverySnapshot['reason'] | PodmanDiscoverySnapshot['reason'];
  readonly candidates: readonly (DockerContainerCandidate | PodmanContainerCandidate)[];
};
export const CONTAINER_DISCOVERY_FRESHNESS_MS = 90_000;
export const containerDiscoveryCopy = {
  docker: {
    title: 'Docker container candidates',
    pending: 'Docker discovery pending',
    unavailable: 'Docker discovery unavailable',
    stale: 'Docker metadata is stale',
    observed: 'Docker metadata observed',
    empty: 'No Docker container candidates matched the observed image metadata.',
    missing: 'A current Docker candidate population is unavailable.',
    reasons: {
      'cli-missing': 'Docker CLI is unavailable.',
      'daemon-unavailable': 'The local Docker daemon is unavailable.',
      timeout: 'The Docker metadata request timed out.',
      'invalid-output': 'Docker metadata could not be validated.',
      'remote-endpoint': 'The Docker endpoint is remote; local discovery is unavailable.',
    },
  },
  podman: {
    title: 'Podman container candidates',
    pending: 'Podman discovery pending',
    unavailable: 'Podman discovery unavailable',
    stale: 'Podman metadata is stale',
    observed: 'Podman metadata observed',
    empty: 'No Podman container candidates matched the observed image metadata.',
    missing: 'A current Podman candidate population is unavailable.',
    reasons: {
      'cli-missing': 'Podman CLI is unavailable.',
      'runtime-unavailable': 'The local Podman runtime is unavailable.',
      timeout: 'The Podman metadata request timed out.',
      'invalid-output': 'Podman metadata could not be validated.',
      'unsupported-platform': 'Local Podman discovery is unavailable on this platform.',
      'remote-config': 'Podman uses a remote configuration; local discovery is unavailable.',
    },
  },
} as const;
const snapshotKeys = new Set([
  'status',
  'reason',
  'observedAt',
  'attemptedAt',
  'stale',
  'candidates',
]);
const candidateKeys = new Set(['id', 'containerId', 'name', 'image', 'agent', 'match', 'runtime']);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? value
    : null;
}

function candidate(
  value: unknown,
  runtime: ContainerRuntime,
): DockerContainerCandidate | PodmanContainerCandidate | null {
  const row = record(value);
  if (
    Object.keys(row).some((key) => !candidateKeys.has(key)) ||
    typeof row.containerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.containerId) ||
    row.id !== `${runtime}:${row.containerId}` ||
    row.runtime !== runtime ||
    row.match !== 'image' ||
    typeof row.name !== 'string' ||
    !row.name ||
    typeof row.image !== 'string' ||
    !row.image ||
    typeof row.agent !== 'string' ||
    !row.agent
  )
    return null;
  const metadata = {
    containerId: row.containerId,
    name: row.name,
    image: row.image,
    agent: row.agent,
    match: 'image' as const,
  };
  return runtime === 'docker'
    ? { ...metadata, id: `docker:${row.containerId}`, runtime: 'docker' }
    : { ...metadata, id: `podman:${row.containerId}`, runtime: 'podman' };
}

/** Normalize one runtime's read-only metadata without introducing host process identity.
 * @param value Snapshot carried by the existing stats payload
 * @param runtime Runtime whose namespaced metadata is accepted
 * @param now Current time for independent freshness expiry
 * @returns Validated candidate metadata and explicit observation state
 * @since 0.17.0
 */
export function containerDiscovery(
  value: unknown,
  runtime: ContainerRuntime,
  now = Date.now(),
): ContainerDiscoverySnapshot {
  const source = record(value);
  let status: ContainerDiscoverySnapshot['status'] =
    source.status === 'pending' || source.status === 'ready' || source.status === 'unavailable'
      ? source.status
      : 'unavailable';
  const knownReason =
    source.reason === null ||
    (typeof source.reason === 'string' &&
      Object.hasOwn(containerDiscoveryCopy[runtime].reasons, source.reason));
  let reason: ContainerDiscoverySnapshot['reason'] = knownReason
    ? (source.reason as ContainerDiscoverySnapshot['reason'])
    : null;
  const observedAt = timestamp(source.observedAt);
  const candidates: (DockerContainerCandidate | PodmanContainerCandidate)[] = [];
  const ids = new Set<string>();
  let invalid =
    Object.keys(source).some((key) => !snapshotKeys.has(key)) ||
    (source.status !== undefined && source.status !== status) ||
    (source.reason !== undefined && !knownReason);
  if (Array.isArray(source.candidates)) {
    for (const raw of source.candidates) {
      const row = candidate(raw, runtime);
      if (!row || ids.has(row.id)) {
        invalid = true;
        continue;
      }
      ids.add(row.id);
      candidates.push(row);
    }
  } else if (source.status !== undefined) invalid = true;
  if (invalid) {
    status = 'unavailable';
    reason = 'invalid-output';
  }
  return {
    status,
    reason,
    observedAt,
    attemptedAt: timestamp(source.attemptedAt),
    candidates,
    stale:
      status !== 'ready' ||
      source.stale !== false ||
      observedAt === null ||
      !Number.isFinite(now) ||
      observedAt > now ||
      now - observedAt >= CONTAINER_DISCOVERY_FRESHNESS_MS,
  };
}

/** Describe runtime observation independently of host population health.
 * @param snapshot Validated discovery snapshot
 * @param runtime Runtime whose observation is described
 * @returns English localization key for the current observation state
 * @since 0.17.0
 */
export function containerDiscoveryLabel(
  snapshot: ContainerDiscoverySnapshot,
  runtime: ContainerRuntime,
): string {
  const copy = containerDiscoveryCopy[runtime];
  if (snapshot.status === 'pending') return copy.pending;
  if (snapshot.status === 'unavailable') return copy.unavailable;
  return snapshot.stale ? copy.stale : copy.observed;
}

/** Explain only the sanitized provider reason, without exposing command output.
 * @param reason Fixed discovery reason code
 * @param runtime Runtime that produced the reason
 * @returns English localization key, or empty text when no reason was supplied
 * @since 0.17.0
 */
export function containerDiscoveryReason(
  reason: ContainerDiscoverySnapshot['reason'],
  runtime: ContainerRuntime,
): string {
  const reasons: Readonly<Record<string, string>> = containerDiscoveryCopy[runtime].reasons;
  return reason !== null && Object.hasOwn(reasons, reason) ? reasons[reason] : '';
}
