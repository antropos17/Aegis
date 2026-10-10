import type {
  DockerContainerCandidate,
  DockerDiscoverySnapshot,
} from '../../../src/shared/types/process';

export const DOCKER_DISCOVERY_FRESHNESS_MS = 90_000;
const reasons = new Set<DockerDiscoverySnapshot['reason']>([
  null,
  'cli-missing',
  'daemon-unavailable',
  'timeout',
  'invalid-output',
  'remote-endpoint',
]);

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

function candidate(value: unknown): DockerContainerCandidate | null {
  const row = record(value);
  if (
    typeof row.containerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.containerId) ||
    row.id !== `docker:${row.containerId}` ||
    row.runtime !== 'docker' ||
    row.match !== 'image' ||
    typeof row.name !== 'string' ||
    !row.name ||
    typeof row.image !== 'string' ||
    !row.image ||
    typeof row.agent !== 'string' ||
    !row.agent
  )
    return null;
  return {
    id: `docker:${row.containerId}`,
    containerId: row.containerId,
    name: row.name,
    image: row.image,
    agent: row.agent,
    match: 'image',
    runtime: 'docker',
  };
}

/** Normalize read-only Docker metadata without introducing a host process identity.
 * @param value Docker snapshot carried by the existing stats payload
 * @param now Current time for independent freshness expiry
 * @returns Validated candidate metadata and explicit observation state
 * @since 0.17.0
 */
export function dockerDiscovery(value: unknown, now = Date.now()): DockerDiscoverySnapshot {
  const source = record(value);
  let status: DockerDiscoverySnapshot['status'] =
    source.status === 'pending' || source.status === 'ready' || source.status === 'unavailable'
      ? source.status
      : 'unavailable';
  let reason: DockerDiscoverySnapshot['reason'] = reasons.has(
    source.reason as DockerDiscoverySnapshot['reason'],
  )
    ? (source.reason as DockerDiscoverySnapshot['reason'])
    : null;
  const observedAt = timestamp(source.observedAt);
  const candidates: DockerContainerCandidate[] = [];
  const ids = new Set<string>();
  let invalid = source.status !== undefined && source.status !== status;
  if (Array.isArray(source.candidates)) {
    for (const raw of source.candidates) {
      const row = candidate(raw);
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
      now - observedAt >= DOCKER_DISCOVERY_FRESHNESS_MS,
  };
}

/** Describe Docker observation independently of host population health.
 * @param snapshot Validated discovery snapshot
 * @returns English localization key for the current observation state
 * @since 0.17.0
 */
export function dockerDiscoveryLabel(snapshot: DockerDiscoverySnapshot): string {
  if (snapshot.status === 'pending') return 'Docker discovery pending';
  if (snapshot.status === 'unavailable') return 'Docker discovery unavailable';
  return snapshot.stale ? 'Docker metadata is stale' : 'Docker metadata observed';
}

/** Explain only the sanitized provider reason, without exposing command output.
 * @param reason Fixed discovery reason code
 * @returns English localization key, or empty text when no reason was supplied
 * @since 0.17.0
 */
export function dockerDiscoveryReason(reason: DockerDiscoverySnapshot['reason']): string {
  switch (reason) {
    case 'cli-missing':
      return 'Docker CLI is unavailable.';
    case 'daemon-unavailable':
      return 'The local Docker daemon is unavailable.';
    case 'timeout':
      return 'The Docker metadata request timed out.';
    case 'invalid-output':
      return 'Docker metadata could not be validated.';
    case 'remote-endpoint':
      return 'The Docker endpoint is remote; local discovery is unavailable.';
    default:
      return '';
  }
}
