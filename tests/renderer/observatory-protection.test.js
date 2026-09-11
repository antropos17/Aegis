import { describe, expect, it } from 'vitest';
import {
  createProtectionActivityReader,
  protectionPolicy,
} from '../../frontend/observatory/runtime/protection';

const file = (patch = {}) => ({
  agent: 'Codex',
  instanceId: '7:first',
  pid: 7,
  action: 'holding',
  file: 'C:/Users/test/.env',
  sensitive: true,
  timestamp: 10,
  attribution: { status: 'confirmed', evidence: ['rm-holder-pid'] },
  ...patch,
});
const agents = [{ name: 'Codex', instanceId: '7:first', instanceKey: 'Codex::C:/work' }];
const policy = { Codex: { sensitive: 'monitor' }, 'Codex::C:/work': { sensitive: 'block' } };

describe('protection activity', () => {
  it('prioritizes review without promoting unknown endpoints or file handles to proven danger or reads', () => {
    const read = createProtectionActivityReader();
    const result = read(
      [file(), file({ sensitive: false, file: '/normal.txt', timestamp: 100 })],
      [
        { agent: 'Codex', remoteIp: '192.0.2.1', verdict: 'unknown', flagged: true },
        { agent: 'Codex', remoteIp: '192.0.2.2', verdict: 'allowlisted' },
        { agent: 'Codex', remoteIp: '192.0.2.3', verdict: 'flagged' },
      ],
    );
    expect(result.map((row) => row.level)).toEqual([
      'review',
      'review',
      'unverified',
      'observed',
      'observed',
    ]);
    expect(result[0].action).toBe('Held a file open');
    expect(result[1].reason).toContain('does not establish malicious');
    expect(result[2].reason).toContain('Unknown does not mean dangerous');
    expect(result[4].reason).toContain('not an access permission');
  });

  it('groups repeated Windows paths, preserving different process lifetimes, actions, ownership and sources', () => {
    const result = createProtectionActivityReader()(
      [
        file(),
        file({ file: 'c:\\users\\test\\.env', timestamp: 20 }),
        file({ instanceId: '7:second' }),
        file({ action: 'modified' }),
        file({ attribution: { status: 'inferred', evidence: ['cwd-containment'] } }),
        file({ source: 'another sensor' }),
      ],
      [],
    );
    expect(result).toHaveLength(5);
    expect(result[0].rows).toHaveLength(2);
    expect(result[0].latest.timestamp).toBe(20);
  });

  it('reuses immutable deliveries but incorporates new file or network deliveries', () => {
    const read = createProtectionActivityReader();
    const files = [file()];
    const network = [];
    const first = read(files, network);
    expect(read(files, network)).toBe(first);
    const next = read([...files, file({ file: '/other' })], network);
    expect(next).not.toBe(first);
    expect(next).toHaveLength(2);
    expect(first[0].rows).toHaveLength(1);
    expect(read(files, [{ remoteIp: '192.0.2.1' }])).toHaveLength(2);
  });

  it('never uses an agent directory as evidence of the actor', () => {
    const [entry] = createProtectionActivityReader()(
      [
        file({
          agent: '',
          instanceId: null,
          file: '/home/test/.codex/config.toml',
          attribution: { status: 'unattributed' },
        }),
      ],
      [],
    );
    expect(entry.actor).toBe('Agent not identified');
    expect(protectionPolicy(entry, agents, policy).agent).toBeNull();
  });

  it('only resolves a saved preference for a unique matching lifetime, and never calls it enforced', () => {
    const [entry] = createProtectionActivityReader()([file()], []);
    expect(protectionPolicy(entry, agents, policy)).toEqual({
      agent: agents[0],
      label: 'Block requested · not enforced',
    });
    expect(
      protectionPolicy(entry, [{ ...agents[0], instanceId: '7:second' }], policy).agent,
    ).toBeNull();
    expect(protectionPolicy(entry, [agents[0], agents[0]], policy).agent).toBeNull();
    expect(protectionPolicy(entry, [{ ...agents[0], name: 'Other' }], policy).agent).toBeNull();
    expect(protectionPolicy(entry, agents, null).label).toBe('Preferences unavailable');
    expect(protectionPolicy(entry, agents, {}).label).toBe('No saved preference for this category');
  });
});
