import { describe, it, expect } from 'vitest';
import {
  describeObservation,
  groupObservations,
  endpointLabel,
  canonicalObservationPath,
  observationGroupEvidence,
} from '../../src/shared/observation-display.js';

const boundRead = (object = {}) => ({
  observationKind: 'bound-object-read',
  agent: 'Codex',
  action: 'accessed',
  attribution: { status: 'confirmed', evidence: ['etw-file-object'] },
  object: {
    objectKey: 'opaque-object-A',
    bindingId: 'lease-A',
    scopeGeneration: 'scope-A',
    policyGeneration: 'policy-A',
    label: 'C:/fixture/.codex/skills/review/SKILL.md',
    ...object,
  },
});

it('keeps bound object labels out of observed paths, skills and inferred resource context', () => {
  const row = boundRead();
  const original = structuredClone(row);
  const info = describeObservation({ ...row, file: row.object.label, path: row.object.label });
  expect(info).toMatchObject({
    kind: 'File',
    path: '',
    context: '',
    resource: row.object.label,
    actor: 'Codex',
  });
  expect(info.skill).toBeFalsy();
  expect(info.explanation).toContain('kernel recorded a read of a pre-bound object');
  expect(row).toEqual(original);
});

it('groups bound reads by object and policy scope rather than by labels, access paths or lease IDs', () => {
  const first = boundRead();
  const anotherLease = boundRead({ bindingId: 'lease-B', label: 'renamed label' });
  const otherObject = boundRead({ objectKey: 'opaque-object-B' });
  const otherScope = boundRead({ scopeGeneration: 'scope-B' });
  const otherPolicy = boundRead({ policyGeneration: 'policy-B' });
  const sameNamedPath = { agent: 'Codex', file: first.object.label };
  const groups = groupObservations([
    first,
    anotherLease,
    otherObject,
    otherScope,
    otherPolicy,
    sameNamedPath,
  ]);
  expect(groups).toHaveLength(5);
  expect(groups.find((group) => group.rows.includes(first)).rows).toEqual([first, anotherLease]);
  expect(
    groupObservations([
      { ...first, object: {} },
      { ...first, object: {} },
    ]),
  ).toHaveLength(2);
});

it('does not fill a missing object actor from a different birth sharing the carried instance ID', () => {
  const event = {
    ...boundRead(),
    agent: '',
    pid: 71,
    instanceId: '71:1755526400000',
    createTime100ns: '134000000000001111',
  };
  const current = {
    agent: 'Codex',
    pid: 71,
    instanceId: event.instanceId,
    instanceIdSource: 'os',
    createTime100ns: '134000000000001112',
  };
  expect(describeObservation(event, [current]).actor).toBe('');
  expect(
    describeObservation(event, [{ ...current, createTime100ns: event.createTime100ns }]).actor,
  ).toBe('Codex');
  expect(describeObservation({ ...event, createTime100ns: undefined }, [current]).actor).toBe('');
});

describe('observation presentation', () => {
  it('names Codex skills without turning the path into actor or execution proof', () => {
    const row = {
      file: 'C:/Users/test/.codex/skills/review/SKILL.md',
      agent: '',
      instanceId: null,
      attribution: { status: 'unattributed' },
    };
    expect(describeObservation(row)).toMatchObject({
      actor: '',
      label: 'Codex',
      context: 'Codex',
      resource: 'review',
      kind: 'Skill',
      attribution: 'Actor not recorded',
    });
    expect(row.agent).toBe('');
    expect(row.instanceId).toBeNull();
  });
  it('names shared skills and only resolves an actor through the exact stamped identity', () => {
    const row = {
      file: 'X:/project/.agents/skills/check/helper.js',
      agent: '',
      pid: 10,
      instanceId: '10:old',
    };
    const agents = [{ agent: 'Codex', pid: 10, instanceId: '10:new' }];
    expect(describeObservation(row, agents)).toMatchObject({
      actor: '',
      label: 'Shared skills',
      resource: 'check',
    });
    expect(describeObservation({ ...row, instanceId: '10:new' }, agents).actor).toBe('Codex');
    expect(
      describeObservation(
        { ...row, instanceId: '10:new', attribution: { status: 'unattributed' } },
        agents,
      ).actor,
    ).toBe('');
  });
  it('uses IP and IPv6 port fallback and gives unknown ownership a specific label', () => {
    expect(endpointLabel({ domain: '', remoteIp: '2001:db8::1', remotePort: 443 })).toBe(
      '[2001:db8::1]:443',
    );
    expect(describeObservation({ agent: 'Unknown source', file: '/tmp/file.txt' }).label).toBe(
      'Unattributed activity',
    );
  });
  it('groups skill members and repeated observations while preserving all original records', () => {
    const rows = [
      { agent: '', file: 'X:/skills/review/SKILL.md', action: 'modified', timestamp: 20 },
      { agent: '', file: 'X:/skills/review/helper.js', action: 'modified', timestamp: 10 },
      { agent: '', file: 'X:/skills/review/SKILL.md', action: 'modified', timestamp: 30 },
    ];
    const groups = groupObservations(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'review', first: 10, last: 30 });
    expect(groups[0].rows).toEqual(rows);
    expect(groups[0].latest).toBe(rows[2]);
    expect(groupObservations(rows, 'none')).toHaveLength(3);
  });

  it('groups one resource across actions and classifications while preserving distinct owners and ports', () => {
    const base = { agent: 'Codex', remoteIp: '192.0.2.1', remotePort: 443 };
    const rows = [
      base,
      { ...base, remotePort: 80 },
      { ...base, verdict: 'flagged' },
      { ...base, agent: 'Cursor' },
    ];
    expect(groupObservations(rows)).toHaveLength(3);
    expect(groupObservations(rows).flatMap((g) => g.rows)).toHaveLength(4);
    const file = { agent: 'Codex', file: '/tmp/a', action: 'modified' };
    const mixed = [
      file,
      { ...file, action: 'deleted', sensitive: true, attribution: { status: 'confirmed' } },
    ];
    const grouped = groupObservations(mixed);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].rows).toEqual(mixed);
    expect(observationGroupEvidence(grouped[0].rows)).toContain('Sensitive');
    expect(observationGroupEvidence(grouped[0].rows)).toContain('Mixed attribution');
  });
  it('normalizes Windows path case and slashes without merging POSIX paths', () => {
    const rows = [
      { file: 'C:/Work/LOG.txt', action: 'read' },
      { file: 'c:\\work\\log.TXT', action: 'modified' },
    ];
    expect(groupObservations(rows)).toHaveLength(1);
    expect(groupObservations(rows)[0].rows).toEqual(rows);
    expect(canonicalObservationPath('\\\\Server\\Share\\FILE')).toBe('//server/share/file');
    expect(groupObservations([{ file: '/work/Log.txt' }, { file: '/work/log.txt' }])).toHaveLength(
      2,
    );
  });
  it('preserves endpoint evidence when allowlisted and unverified observations share an address', () => {
    const rows = ['allowlisted', 'unknown', 'flagged'].map((verdict) => ({
      remoteIp: '192.0.2.1',
      remotePort: 443,
      verdict,
    }));
    expect(groupObservations(rows)).toHaveLength(1);
    expect(observationGroupEvidence(rows)).toBe(
      'Allowlisted · Endpoint unverified · Not allowlisted',
    );
  });
  it('requires a literal .config directory for application context', () => {
    for (const product of ['goose', 'opencode']) {
      expect(describeObservation({ file: '/tmp/xconfig/' + product + '/log.txt' }).context).toBe(
        '',
      );
      expect(
        describeObservation({ file: '/tmp/.config/' + product + '/log.txt' }).context,
      ).not.toBe('');
    }
  });
});

it('retains stored audit severity alongside endpoint verification', () => {
  expect(
    observationGroupEvidence([
      { type: 'network-connection', severity: 'high', extra: { verdict: 'flagged' } },
    ]),
  ).toBe('Not allowlisted · high');
  expect(
    observationGroupEvidence([{ type: 'network-connection', extra: { flagged: false } }]),
  ).toBe('Endpoint unverified');
});

it.each([
  ['no-owner-match', 'No observed agent matched this resource.'],
  ['no-ai-agents-online', 'No AI agent was observed when this event was recorded.'],
  ['population-unavailable', 'Process observation was unavailable when this event was recorded.'],
])('explains %s without replacing missing ownership with path context', (reason, explanation) => {
  const row = {
    file: 'C:/Users/test/.codex/config.toml',
    agent: '',
    instanceId: null,
    attribution: { status: 'unattributed', evidence: [reason] },
  };
  const before = structuredClone(row);
  expect(describeObservation(row)).toMatchObject({ actor: '', label: 'Codex', explanation });
  expect(row).toEqual(before);
});

it('does not promote conflicting or future evidence to a confirmed actor', () => {
  const row = {
    file: '/tmp/file.txt',
    agent: 'Codex',
    instanceId: '7:old',
    attribution: { status: 'unattributed', evidence: ['handle-scan-pid', 'future-code'] },
  };
  const info = describeObservation(row, [{ agent: 'Codex', instanceId: '7:new', pid: 7 }]);
  expect(info.actor).toBe('');
  expect(info.explanation).toBe('The observation does not identify an agent process.');
});
