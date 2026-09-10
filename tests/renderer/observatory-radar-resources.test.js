import { expect, it } from 'vitest';
import { emptyTelemetry, instances } from '../../frontend/observatory/runtime/host';
import { radarGroups } from '../../frontend/observatory/runtime/radar';
import { radarResources } from '../../frontend/observatory/runtime/radar-resources';

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

it('deduplicates files across grouped processes, retains newest evidence and distinct paths', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1), agent(2)],
    events: [
      file('X:/a/config.ts', 2),
      file('X:\\a\\config.ts', 9, 2),
      file('X:/b/config.ts', 3),
      { ...file('X:/self', 5), selfAccess: true },
    ],
  };
  const rows = radarResources(state, 'files', radarGroups(instances(state)));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ label: 'config.ts', count: 2, group: 'Codex' });
  expect(rows[0].row).toBe(state.events[1]);
  expect(rows.map((r) => r.key)).toHaveLength(new Set(rows.map((r) => r.key)).size);
});

it('renders empty DNS as IP and port, distinguishing ports and IPv6 without duplicate sockets', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1), agent(2)],
    network: [
      connection(),
      connection({ instanceId: '2:now' }),
      connection({ remotePort: 80 }),
      connection({ remoteIp: '2001:db8::1' }),
      connection({ remoteIp: '', domain: '' }),
    ],
  };
  const rows = radarResources(state, 'network', radarGroups(instances(state)));
  expect(rows.map((r) => r.label)).toEqual(
    expect.arrayContaining(['192.0.2.8:443', '192.0.2.8:80', '[2001:db8::1]:443']),
  );
  expect(rows).toHaveLength(3);
  expect(rows.find((r) => r.label === '192.0.2.8:443').count).toBe(2);
});

it('only links exact current instances and scopes resources to the visible radar page', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1), agent(2, 'Cursor')],
    events: [
      file('X:/current', 1),
      file('X:/other-page', 2, 2),
      { ...file('X:/old', 3), instanceId: '1:old', agent: 'Codex', pid: 1 },
      { ...file('X:/unknown', 4), instanceId: null, agent: 'Codex', pid: 1 },
    ],
  };
  const groups = radarGroups(instances(state));
  const rows = radarResources(state, 'files', [groups[0]]);
  expect(rows).toHaveLength(3);
  expect(rows.filter((r) => r.group)).toHaveLength(1);
  expect(rows.filter((r) => !r.group).every((r) => r.attribution === 'No current agent link')).toBe(
    true,
  );
  expect(radarResources(state, 'files', [groups[0]], groups[0]).map((r) => r.label)).toEqual([
    'current',
  ]);
});

it('does not turn inferred file ownership into confirmed attribution', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1)],
    events: [{ ...file('X:/config', 1), attribution: { status: 'inferred' } }],
  };
  expect(radarResources(state, 'files', radarGroups(instances(state)))[0].attribution).toBe(
    'Indirect attribution',
  );
});

it('retains source rows while unique resource identity excludes agent ownership', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1), agent(2, 'Cursor')],
    events: [
      file('X:/Project/Config.ts', 1),
      file('x:\\project\\config.ts', 2),
      file('X:/Project/Config.ts', 3, 2),
    ],
  };
  const rows = radarResources(state, 'files', radarGroups(instances(state)));
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((entry) => entry.resourceKey)).size).toBe(1);
  const codex = rows.find((entry) => entry.group === 'Codex');
  expect(codex.rows).toEqual(state.events.slice(0, 2));
  expect(codex.count).toBe(2);
  expect(codex.row).toBe(state.events[1]);
});

it('keeps differently cased POSIX paths separate', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [agent(1)],
    events: [file('/project/Config.ts', 1), file('/project/config.ts', 2)],
  };
  expect(radarResources(state, 'files', radarGroups(instances(state)))).toHaveLength(2);
});
