import { expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  radarResources,
  resourceProcess,
} from '../../frontend/observatory/runtime/radar-resources';

const agent = (pid, name = 'Codex') => ({
  agent: name,
  pid,
  process: 'agent.exe',
  instanceId: `${pid}:now`,
  instanceIdSource: 'os',
});
const file = (path, timestamp, pid = 1) => ({
  instanceId: `${pid}:now`,
  file: path,
  timestamp,
  attribution: { status: 'confirmed' },
});
const connection = (overrides = {}) => ({
  instanceId: '1:now',
  domain: '',
  remoteIp: '192.0.2.8',
  remotePort: 443,
  state: 'Established',
  ...overrides,
});
const state = (overrides = {}) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent(1), agent(2, 'Cursor')],
  ...overrides,
});

it('includes self access, groups canonical paths, and retains distinct process relationships and all evidence', () => {
  const events = [
    file('X:/a/config.ts', 2),
    file('X:\\a\\config.ts', 9, 2),
    file('X:/b/config.ts', 3),
    { ...file('X:/self', 5), selfAccess: true },
  ];
  const rows = radarResources(state({ events }), 'files');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ label: 'config.ts', time: 9, rows: events.slice(0, 2) });
  expect(rows[0].relations.map((r) => r.actor)).toEqual(['Codex', 'Cursor']);
  expect(rows[0].relations.map((r) => r.instanceId)).toEqual(['1:now', '2:now']);
  expect(rows.some((r) => r.rows[0].selfAccess)).toBe(true);
});
it('distinguishes ports, IPv6 and IPs sharing DNS while retaining every socket', () => {
  const rows = radarResources(
    state({
      network: [
        connection(),
        connection({ instanceId: '2:now' }),
        connection({ remotePort: 80 }),
        connection({ remoteIp: '2001:db8::1' }),
        connection({ remoteIp: '', domain: '' }),
        connection({ domain: 'api.example.com' }),
        connection({ remoteIp: '192.0.2.9', domain: 'api.example.com' }),
      ],
    }),
    'network',
  );
  expect(rows.map((r) => r.label)).toEqual(
    expect.arrayContaining([
      '192.0.2.8:443',
      '192.0.2.8:80',
      '[2001:db8::1]:443',
      'api.example.com:443',
    ]),
  );
  expect(rows).toHaveLength(4);
  expect(rows.find((r) => r.label === '192.0.2.8:443').rows).toHaveLength(3);
});
it('includes all radar pages, historical owners and unknown resources without guessing from path context', () => {
  const telemetry = state({
    agents: Array.from({ length: 8 }, (_, i) => agent(i + 1, `Agent ${i + 1}`)),
    events: [
      file('X:/current', 1),
      file('X:/other-page', 2, 8),
      { ...file('X:/old', 3), instanceId: '1:old', agent: 'Codex', pid: 1 },
      {
        ...file('X:/.codex/config.toml', 4),
        instanceId: null,
        attribution: { status: 'unattributed' },
      },
    ],
  });
  const rows = radarResources(telemetry, 'files');
  expect(rows).toHaveLength(4);
  expect(rows.find((r) => r.label === 'other-page').relations[0].actor).toBe('Agent 8');
  const old = rows.find((r) => r.label === 'old').relations[0];
  expect(old.actor).toBe('Codex');
  expect(resourceProcess(old, telemetry)).toBeNull();
  expect(rows.find((r) => r.label === 'config.toml').relations[0].actor).toBe('');
});
it('preserves mixed attribution and actions in separate relationships for one process', () => {
  const events = [
    { ...file('X:/config', 1), action: 'holding', attribution: { status: 'inferred' } },
    { ...file('X:/config', 2), action: 'modified' },
    { ...file('X:/config', 3), action: 'accessed' },
    { ...file('X:/config', 4), attribution: 'ambiguous', agent: 'Codex' },
  ];
  const row = radarResources(state({ events }), 'files')[0];
  expect(row.relations.map((r) => r.attribution)).toEqual([
    'Indirect match',
    'PID confirmed',
    'Ambiguous ownership',
  ]);
  expect(row.relations[1].actions).toEqual(['Changed a file', 'Had an open file handle']);
  expect(row.rows).toEqual(events);
  expect(resourceProcess(row.relations[2], state())).toBeNull();
});
it('resolves only a unique reliable current lifetime, never a recycled PID or duplicate identity', () => {
  const telemetry = state({ events: [{ ...file('X:/config', 1), agent: 'Codex', pid: 1 }] });
  const relation = radarResources(telemetry, 'files')[0].relations[0];
  expect(resourceProcess(relation, telemetry)).toBe(telemetry.agents[0]);
  for (const change of [
    { stale: true },
    { ready: false },
    { agents: [{ ...agent(1), instanceId: '1:new' }] },
    { agents: [agent(1), agent(1, 'Other')] },
    { agents: [agent(1, 'Other')] },
    { agents: [{ ...agent(1), instanceIdSource: 'synthetic' }] },
    { agents: [{ ...agent(1), instanceIdSource: 'unknown' }] },
  ])
    expect(resourceProcess(relation, { ...telemetry, ...change })).toBeNull();
});
it('retains strongest classification without claiming unknown destinations are malicious', () => {
  const files = radarResources(
    state({ events: [{ ...file('X:/config', 1), sensitive: true }, file('X:/config', 2)] }),
    'files',
  );
  expect(files[0]).toMatchObject({ level: 'review', sensitive: true });
  const network = radarResources(
    state({
      network: [
        connection({ verdict: 'flagged' }),
        connection({ verdict: 'allowlisted' }),
        connection({ remotePort: 80, verdict: 'unknown' }),
      ],
    }),
    'network',
  );
  expect(network[0].level).toBe('review');
  expect(network[1]).toMatchObject({
    level: 'unverified',
    reason: expect.stringContaining('Unknown does not mean dangerous'),
  });
});
it('keeps differently cased POSIX paths separate', () => {
  expect(
    radarResources(
      state({ events: [file('/project/Config.ts', 1), file('/project/config.ts', 2)] }),
      'files',
    ),
  ).toHaveLength(2);
});
