import { expect, it } from 'vitest';
import {
  dockerDiscovery,
  dockerDiscoveryLabel,
  dockerDiscoveryReason,
  DOCKER_DISCOVERY_FRESHNESS_MS,
} from '../../frontend/observatory/runtime/docker-discovery';
import { translator } from '../../frontend/observatory/runtime/i18n';

const now = 1_000_000;
const containerId = 'a'.repeat(64);
const candidate = {
  id: `docker:${containerId}`,
  containerId,
  name: 'agent-container',
  image: 'example/claude-agent:latest',
  agent: 'Claude Code',
  match: 'image',
  runtime: 'docker',
};
const ready = {
  status: 'ready',
  reason: null,
  observedAt: now,
  attemptedAt: now,
  stale: false,
  candidates: [candidate],
};

it('distinguishes a successful empty metadata discovery from no observation', () => {
  expect(dockerDiscovery({ ...ready, candidates: [] }, now)).toMatchObject({
    status: 'ready',
    stale: false,
    candidates: [],
    observedAt: now,
  });
  expect(dockerDiscovery(undefined, now)).toMatchObject({
    status: 'unavailable',
    stale: true,
    candidates: [],
    observedAt: null,
  });
});

it('expires independently of host process readiness and retains the last candidates', () => {
  expect(dockerDiscovery(ready, now + DOCKER_DISCOVERY_FRESHNESS_MS - 1).stale).toBe(false);
  const expired = dockerDiscovery(ready, now + DOCKER_DISCOVERY_FRESHNESS_MS);
  expect(expired.stale).toBe(true);
  expect(expired.candidates).toEqual([candidate]);
});

it.each(['pending', 'unavailable'])(
  'keeps provider %s and retained metadata explicit',
  (status) => {
    expect(dockerDiscovery({ ...ready, status, reason: 'timeout' }, now)).toMatchObject({
      status,
      reason: 'timeout',
      stale: true,
      candidates: [candidate],
    });
  },
);

it('honors provider stale state and rejects missing or future observation timestamps', () => {
  expect(dockerDiscovery({ ...ready, stale: true }, now).stale).toBe(true);
  expect(dockerDiscovery({ ...ready, observedAt: null }, now).stale).toBe(true);
  expect(dockerDiscovery({ ...ready, observedAt: now + 1 }, now).stale).toBe(true);
});

it('whitelists candidate metadata without introducing process identity or copied secrets', () => {
  const result = dockerDiscovery(
    {
      ...ready,
      candidates: [
        {
          ...candidate,
          pid: 123,
          instanceId: '123:1',
          env: ['SECRET=fixture'],
          command: 'fixture-command',
        },
      ],
    },
    now,
  );
  expect(result.candidates).toEqual([candidate]);
});

it('localizes Docker discovery states and fixed failure reasons without an English fallback', () => {
  const pt = translator('pt');
  const states = [
    dockerDiscovery(ready, now),
    dockerDiscovery(ready, now + DOCKER_DISCOVERY_FRESHNESS_MS),
    dockerDiscovery({ ...ready, status: 'pending' }, now),
    dockerDiscovery({ ...ready, status: 'unavailable' }, now),
  ];
  for (const state of states) {
    const source = dockerDiscoveryLabel(state);
    expect(pt(source), source).not.toBe(source);
  }
  for (const reason of [
    'cli-missing',
    'daemon-unavailable',
    'timeout',
    'invalid-output',
    'remote-endpoint',
  ] as const) {
    const source = dockerDiscoveryReason(reason);
    expect(pt(source), source).not.toBe(source);
  }
});

it('drops invalid identities and duplicate container rows without crashing keyed presentation', () => {
  const result = dockerDiscovery(
    {
      ...ready,
      candidates: [
        candidate,
        candidate,
        { ...candidate, id: '123:1' },
        { ...candidate, containerId: 'short' },
        { ...candidate, runtime: 'host' },
        null,
      ],
    },
    now,
  );
  expect(result.status).toBe('unavailable');
  expect(result.reason).toBe('invalid-output');
  expect(result.stale).toBe(true);
  expect(result.candidates).toEqual([candidate]);
});
