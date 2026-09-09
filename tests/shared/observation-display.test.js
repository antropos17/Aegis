import { describe, it, expect } from 'vitest';
import {
  describeObservation,
  groupObservations,
  endpointLabel,
} from '../../src/shared/observation-display.js';

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
  it('keeps different ports, verdicts, actions, sensitivities and owners separate', () => {
    const base = { agent: 'Codex', remoteIp: '192.0.2.1', remotePort: 443 };
    expect(
      groupObservations([
        base,
        { ...base, remotePort: 80 },
        { ...base, verdict: 'flagged' },
        { ...base, agent: 'Cursor' },
      ]),
    ).toHaveLength(4);
    const file = { agent: 'Codex', file: '/tmp/a', action: 'modified' };
    expect(
      groupObservations([file, { ...file, action: 'deleted' }, { ...file, sensitive: true }]),
    ).toHaveLength(3);
    const audit = { path: '/tmp/a', type: 'file-access', action: 'modified' };
    expect(
      groupObservations([
        { ...audit, severity: 'normal' },
        { ...audit, severity: 'sensitive' },
      ]),
    ).toHaveLength(2);
  });
});
