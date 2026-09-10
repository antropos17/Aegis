import { expect, it } from 'vitest';
import { isScopedProcess, scopeEvidence } from '../../frontend/observatory/runtime/agent-scope';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
const scope = { agent: 'Codex', instanceId: '' };
const telemetry = {
  ...emptyTelemetry(),
  agents: [{ agent: 'Codex', pid: 42, instanceId: '42:new' }],
};
it('retains exact process history after exit without attaching a recycled PID', () => {
  const old = Object.freeze({ agent: 'Codex', pid: 42, instanceId: '42:old', file: 'old.txt' });
  const rows = Object.freeze([
    old,
    { agent: 'Codex', pid: 42, instanceId: '42:new' },
    { agent: 'Codex', pid: 42 },
  ]);
  expect(scopeEvidence(rows, telemetry, { ...scope, instanceId: '42:old' })).toEqual([old]);
  expect(scopeEvidence(rows, emptyTelemetry(), { ...scope, instanceId: '42:old' })).toEqual([old]);
});
it('matches recorded owners or current exact stamps without using path context or a PID', () => {
  const owner = { agent: 'Codex', instanceId: '42:old' };
  const exact = { instanceId: '42:new' };
  const rows = [
    owner,
    exact,
    { pid: 42 },
    { file: 'C:/Users/test/.codex/config.toml' },
    { agent: 'Claude', instanceId: '42:new' },
  ];
  expect(scopeEvidence(rows, telemetry, scope)).toEqual([owner, exact]);
});
it('excludes self access and explicitly unattributed evidence from selected scopes', () => {
  const rows = [
    { agent: 'Codex', instanceId: '42:new', selfAccess: true },
    { agent: 'Codex', instanceId: '42:new', attribution: { status: 'unattributed' } },
    { agent: 'Codex', instanceId: '42:new', attribution: 'unattributed' },
  ];
  expect(scopeEvidence(rows, telemetry, scope)).toEqual([]);
  expect(scopeEvidence(rows, telemetry, { ...scope, instanceId: '42:new' })).toEqual([]);
  const all = scopeEvidence(rows, telemetry, { agent: '', instanceId: '' });
  expect(all).toEqual(rows);
  expect(all).not.toBe(rows);
});
it('preserves indirect ownership evidence without upgrading attribution', () => {
  const row = Object.freeze({
    agent: 'Codex',
    instanceId: '42:old',
    attribution: Object.freeze({ status: 'inferred', evidence: ['working-directory'] }),
  });
  expect(scopeEvidence([row], telemetry, scope)[0]).toBe(row);
  expect(row.attribution.status).toBe('inferred');
});

it('accepts real recorded process stamps and rejects degraded or synthetic identities', () => {
  expect(isScopedProcess({ pid: 42, instanceId: '42:1000', instanceIdSource: 'os' })).toBe(true);
  expect(isScopedProcess({ pid: 42, instanceId: '42:old' })).toBe(true);
  for (const row of [
    { pid: 42, instanceId: '42:u' },
    { pid: 42, instanceId: '42:1000', instanceIdSource: 'unknown' },
    { pid: 0, instanceId: '0:codex', instanceIdSource: 'synthetic' },
    { pid: 42, instanceId: '0:codex' },
    { pid: 42, instanceId: '' },
    { pid: 42, instanceId: '  ' },
    { pid: 0, instanceId: 'a' },
    { pid: NaN, instanceId: 'a' },
  ])
    expect(isScopedProcess(row)).toBe(false);
});

it('does not join a recycled degraded PID to unnamed retained evidence', () => {
  const previous = Object.freeze({ pid: 42, instanceId: '42:u', file: 'earlier.txt' });
  const recorded = Object.freeze({ ...previous, agent: 'Codex' });
  const state = {
    ...emptyTelemetry(),
    agents: [{ agent: 'Codex', pid: 42, instanceId: '42:u', instanceIdSource: 'unknown' }],
  };
  expect(scopeEvidence([previous, recorded], state, scope)).toEqual([recorded]);
  expect(scopeEvidence([previous, recorded], state, { ...scope, instanceId: '42:u' })).toEqual([]);
  expect(
    scopeEvidence([previous, recorded], emptyTelemetry(), { ...scope, instanceId: '42:u' }),
  ).toEqual([]);
});

it('retains named synthetic product evidence without presenting a synthetic identity as one process', () => {
  const unnamed = { pid: 0, instanceId: '0:codex', file: 'config.txt' };
  const recorded = { ...unnamed, agent: 'Codex' };
  const state = {
    ...emptyTelemetry(),
    agents: [{ agent: 'Codex', pid: 0, instanceId: '0:codex', instanceIdSource: 'synthetic' }],
  };
  expect(scopeEvidence([unnamed, recorded], state, scope)).toEqual([recorded]);
  expect(scopeEvidence([unnamed, recorded], state, { ...scope, instanceId: '0:codex' })).toEqual(
    [],
  );
});

it('rejects explicitly degraded provenance even if a malformed stamp resembles an OS identity', () => {
  const state = {
    ...emptyTelemetry(),
    agents: [{ agent: 'Codex', pid: 42, instanceId: '42:1000', instanceIdSource: 'unknown' }],
  };
  const row = { agent: 'Codex', pid: 42, instanceId: '42:1000' };
  expect(scopeEvidence([row], state, { ...scope, instanceId: '42:1000' })).toEqual([]);
  expect(
    scopeEvidence([{ ...row, instanceIdSource: 'synthetic' }], emptyTelemetry(), {
      ...scope,
      instanceId: '42:1000',
    }),
  ).toEqual([]);
});
