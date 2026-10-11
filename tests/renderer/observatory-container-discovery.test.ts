import { expect, it } from 'vitest';
import {
  containerDiscovery,
  configurationStale,
  containerDiscoveryCopy,
  containerDiscoveryLabel,
  containerDiscoveryReason,
  CONTAINER_DISCOVERY_FRESHNESS_MS,
  type ContainerRuntime,
} from '../../frontend/observatory/runtime/container-discovery';
import { translator } from '../../frontend/observatory/runtime/i18n';

const now = 1_000_000;
const containerId = 'a'.repeat(64);
const runtimes: ContainerRuntime[] = ['docker', 'podman'];
function candidate(runtime: ContainerRuntime) {
  return {
    id: `${runtime}:${containerId}`,
    containerId,
    name: 'agent-container',
    image: 'example/claude-agent:latest',
    agent: 'Claude Code',
    match: 'image',
    runtime,
  };
}
function ready(runtime: ContainerRuntime) {
  return {
    status: 'ready',
    reason: null,
    observedAt: now,
    attemptedAt: now,
    stale: false,
    candidates: [candidate(runtime)],
  };
}

it.each(runtimes)('distinguishes successful empty %s discovery from no observation', (runtime) => {
  expect(containerDiscovery({ ...ready(runtime), candidates: [] }, runtime, now)).toMatchObject({
    status: 'ready',
    stale: false,
    candidates: [],
    observedAt: now,
  });
  expect(containerDiscovery(undefined, runtime, now)).toMatchObject({
    status: 'unavailable',
    stale: true,
    candidates: [],
    observedAt: null,
  });
});

it.each(runtimes)('expires %s metadata independently and retains last candidates', (runtime) => {
  const snapshot = ready(runtime);
  expect(
    containerDiscovery(snapshot, runtime, now + CONTAINER_DISCOVERY_FRESHNESS_MS - 1).stale,
  ).toBe(false);
  const expired = containerDiscovery(snapshot, runtime, now + CONTAINER_DISCOVERY_FRESHNESS_MS);
  expect(expired.stale).toBe(true);
  expect(expired.candidates).toEqual([candidate(runtime)]);
});

it.each(runtimes)(
  'keeps pending/unavailable %s discovery and retained metadata explicit',
  (runtime) => {
    for (const status of ['pending', 'unavailable']) {
      expect(
        containerDiscovery({ ...ready(runtime), status, reason: 'timeout' }, runtime, now),
      ).toMatchObject({ status, reason: 'timeout', stale: true, candidates: [candidate(runtime)] });
    }
  },
);

it.each(runtimes)('honors %s stale state and missing/future observation timestamps', (runtime) => {
  expect(containerDiscovery({ ...ready(runtime), stale: true }, runtime, now).stale).toBe(true);
  expect(containerDiscovery({ ...ready(runtime), observedAt: null }, runtime, now).stale).toBe(
    true,
  );
  expect(containerDiscovery({ ...ready(runtime), observedAt: now + 1 }, runtime, now).stale).toBe(
    true,
  );
});

it.each(runtimes)(
  'rejects extra %s candidate fields including process identities and secrets',
  (runtime) => {
    const result = containerDiscovery(
      {
        ...ready(runtime),
        candidates: [
          {
            ...candidate(runtime),
            pid: 123,
            instanceId: '123:1',
            env: ['SECRET=fixture'],
            command: 'fixture-command',
          },
        ],
      },
      runtime,
      now,
    );
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      candidates: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|fixture-command|instanceId|pid/);
  },
);

it.each(runtimes)('rejects extra snapshot fields and foreign reason codes for %s', (runtime) => {
  const extra = containerDiscovery({ ...ready(runtime), env: ['SECRET=fixture'] }, runtime, now);
  const foreign = containerDiscovery(
    { ...ready(runtime), reason: runtime === 'docker' ? 'remote-config' : 'remote-endpoint' },
    runtime,
    now,
  );
  for (const result of [extra, foreign]) {
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-output', stale: true });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  }
});

it.each(runtimes)('rejects other-runtime identities and metadata in %s rows', (runtime) => {
  const other = runtime === 'docker' ? 'podman' : 'docker';
  for (const row of [
    candidate(other),
    { ...candidate(runtime), id: `${other}:${containerId}` },
    { ...candidate(runtime), runtime: other },
  ]) {
    expect(
      containerDiscovery({ ...ready(runtime), candidates: [row] }, runtime, now),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      candidates: [],
      stale: true,
    });
  }
});

it.each(runtimes)('localizes all %s discovery copy and fixed reasons', (runtime) => {
  const pt = translator('pt');
  const copy = containerDiscoveryCopy[runtime];
  for (const source of [
    ...Object.values(copy).filter((value) => typeof value === 'string'),
    ...Object.values(copy.reasons),
  ]) {
    expect(pt(source), source).not.toBe(source);
  }
  for (const status of ['pending', 'unavailable', 'ready']) {
    for (const stale of [false, true]) {
      const state = containerDiscovery({ ...ready(runtime), status, stale }, runtime, now);
      const source = containerDiscoveryLabel(state, runtime);
      expect(pt(source), source).not.toBe(source);
    }
  }
  for (const reason of Object.keys(copy.reasons)) {
    const snapshot = containerDiscovery(
      { ...ready(runtime), status: 'unavailable', reason },
      runtime,
      now,
    );
    expect(snapshot.reason).toBe(reason);
    const source = containerDiscoveryReason(snapshot.reason, runtime);
    expect(source).not.toBe('');
    expect(pt(source), source).not.toBe(source);
  }
});

it.each(runtimes)(
  'drops invalid/duplicate %s rows without crashing keyed presentation',
  (runtime) => {
    const row = candidate(runtime);
    const result = containerDiscovery(
      {
        ...ready(runtime),
        candidates: [
          row,
          row,
          { ...row, id: '123:1' },
          { ...row, containerId: 'short' },
          { ...row, runtime: 'host' },
          null,
        ],
      },
      runtime,
      now,
    );
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-output', stale: true });
    expect(result.candidates).toEqual([row]);
  },
);

it('preserves boolean false and exposes only allowlisted Docker configuration facts', () => {
  const configuration = {
    status: 'observed' as const,
    observedAt: now,
    running: false,
    privileged: false,
    readOnlyRootFilesystem: true,
    networkMode: 'none' as const,
    pidMode: 'private' as const,
  };
  const result = containerDiscovery(
    { ...ready('docker'), candidates: [{ ...candidate('docker'), configuration }] },
    'docker',
    now,
  );
  expect(result).toMatchObject({ status: 'ready', candidates: [{ configuration }] });
  expect(configurationStale(configuration, false, now)).toBe(false);
  expect(configurationStale(configuration, false, now + CONTAINER_DISCOVERY_FRESHNESS_MS)).toBe(
    true,
  );
  expect(configurationStale(configuration, true, now)).toBe(true);
});

it.each([
  null,
  { status: 'observed', observedAt: now, privileged: 'false' },
  { status: 'observed', observedAt: null, running: true },
  { status: 'observed', observedAt: now, networkMode: 'secret/path' },
  { status: 'observed', observedAt: now, running: true, env: ['SECRET=fixture'] },
  { status: 'unavailable', observedAt: now, privileged: false },
])(
  'degrades malformed or unavailable optional evidence without losing the Docker candidate (%j)',
  (configuration) => {
    const result = containerDiscovery(
      { ...ready('docker'), candidates: [{ ...candidate('docker'), configuration }] },
      'docker',
      now,
    );
    expect(result).toMatchObject({
      status: 'ready',
      candidates: [
        { agent: 'Claude Code', configuration: { status: 'unavailable', observedAt: null } },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|secret\/path/);
  },
);

it('does not accept Docker configuration in Podman metadata', () => {
  const result = containerDiscovery(
    {
      ...ready('podman'),
      candidates: [
        {
          ...candidate('podman'),
          configuration: { status: 'observed', observedAt: now, running: true },
        },
      ],
    },
    'podman',
    now,
  );
  expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-output', candidates: [] });
});
