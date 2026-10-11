import { expect, it } from 'vitest';
import { emptyTelemetry, instances } from '../../frontend/observatory/runtime/host';
import { radarGroups } from '../../frontend/observatory/runtime/radar';
import { radarConnections } from '../../frontend/observatory/runtime/radar-connections';

const agent = (pid, name) => ({
  agent: name,
  process: 'agent.exe',
  pid,
  instanceId: `${pid}:now`,
  instanceIdSource: 'os',
});
const file = (pid, name, path = 'X:/shared') => ({
  agent: name,
  pid,
  instanceId: `${pid}:now`,
  file: path,
  attribution: { status: 'confirmed' },
});
const state = (events, agents = [agent(1, 'Codex'), agent(2, 'Cursor')]) => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents,
  events,
});
const links = (telemetry, plotted = radarGroups(instances(telemetry))) =>
  radarConnections(telemetry, plotted);

it('connects two visible products sharing confirmed recorded file observations', () => {
  expect(links(state([file(1, 'Codex'), file(2, 'Cursor')]))).toEqual([
    { key: '["Codex","Cursor"]', from: 'Codex', to: 'Cursor', files: 1 },
  ]);
});

it('rejects a recorded PID that conflicts with the exact instance', () => {
  expect(links(state([file(1, 'Codex'), { ...file(2, 'Cursor'), pid: 99 }]))).toEqual([]);
});

it('counts canonical Windows files once per pair and keeps POSIX case distinct', () => {
  const events = [
    file(1, 'Codex', 'X:/A/config'),
    file(2, 'Cursor', 'x:\\a\\config'),
    file(2, 'Cursor', 'X:/A/config'),
    file(1, 'Codex', '/a/Config'),
    file(2, 'Cursor', '/a/config'),
    file(1, 'Codex', '/b/config'),
    file(2, 'Cursor', '/b/config'),
  ];
  expect(links(state(events))[0].files).toBe(2);
});

it.each([
  { instanceId: '2:old' },
  { instanceId: null },
  { agent: 'Other' },
  { agent: '' },
  { attribution: { status: 'ambiguous' } },
  { attribution: { status: 'unattributed' } },
  { attribution: { status: 'inferred' } },
  { attribution: undefined },
  { file: '' },
])('excludes invalid ownership: %j', (change) => {
  expect(links(state([file(1, 'Codex'), { ...file(2, 'Cursor'), ...change }]))).toEqual([]);
});

it.each(['unknown', 'synthetic'])('excludes an unusable stamp source: %s', (instanceIdSource) => {
  expect(
    links(
      state(
        [file(1, 'Codex'), file(2, 'Cursor')],
        [agent(1, 'Codex'), { ...agent(2, 'Cursor'), instanceIdSource }],
      ),
    ),
  ).toEqual([]);
});

it('excludes duplicate current instance identities and same-product sharing', () => {
  expect(
    links(
      state(
        [file(1, 'Codex'), file(2, 'Cursor')],
        [agent(1, 'Codex'), agent(2, 'Cursor'), agent(2, 'Other')],
      ),
    ),
  ).toEqual([]);
  expect(
    links(state([file(1, 'Codex'), file(2, 'Codex')], [agent(1, 'Codex'), agent(2, 'Codex')])),
  ).toEqual([]);
});

it('produces all three undirected pairs for three owners and at most six for four plotted groups', () => {
  const agents = ['A', 'B', 'C', 'D', 'E'].map((name, i) => agent(i + 1, name));
  const telemetry = state(
    agents.map((a) => file(a.pid, a.agent)),
    agents,
  );
  const groups = radarGroups(instances(telemetry));
  expect(links(telemetry, groups.slice(0, 3))).toHaveLength(3);
  expect(links(telemetry, groups)).toHaveLength(6);
  expect(links(telemetry, groups.slice(4))).toEqual([]);
});

it('retains the displayed stale snapshot but never invents links before a reliable scan', () => {
  const telemetry = state([file(1, 'Codex'), file(2, 'Cursor')]);
  expect(links({ ...telemetry, stale: true })).toEqual(links(telemetry));
  expect(links({ ...telemetry, ready: false })).toEqual([]);
});
