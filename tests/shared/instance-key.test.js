/**
 * Durable instanceKey contract (IDENTITY-RECON §6 step 6).
 * Separates instanceId (runtime), instanceKey (permissions), watchlist (name).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  acknowledgementInstanceId,
  watchlistSignature,
} from '../../src/renderer/lib/utils/agent-action-keys';

// The two subjects below are CommonJS main/shared modules — createRequire is the
// right loader for them. The renderer helper above is TypeScript and must come in
// through an ESM import, which Vite transforms; a require() of a .ts path is parsed
// by Node itself and only survives where type stripping is on.
const require = createRequire(import.meta.url);
const { buildInstanceKey } = require('../../src/shared/instance-key.js');
const { buildInstanceId } = require('../../src/main/process-identity.js');

describe('buildInstanceKey — durable permissions key', () => {
  it('prefers cwd over parentEditor over bare name', () => {
    expect(buildInstanceKey('Claude Code', 'VS Code', '/proj/a')).toBe('Claude Code::/proj/a');
    expect(buildInstanceKey('Claude Code', 'VS Code', null)).toBe('Claude Code::VS Code');
    expect(buildInstanceKey('Claude Code', null, null)).toBe('Claude Code');
  });

  it('treats empty string like absent for cwd and parentEditor (historical truthiness)', () => {
    expect(buildInstanceKey('Claude Code', 'VS Code', '')).toBe('Claude Code::VS Code');
    expect(buildInstanceKey('Claude Code', '', null)).toBe('Claude Code');
  });

  it('same display name + different cwd => distinct durable keys', () => {
    const a = buildInstanceKey('Claude Code', null, '/home/user/project-a');
    const b = buildInstanceKey('Claude Code', null, '/home/user/project-b');
    expect(a).not.toBe(b);
  });

  it('same name + null cwd across restarts is stable (no pid/startTime)', () => {
    // Restart: pid and startTime change; durable key must not.
    const before = buildInstanceKey('Claude Code', 'VS Code', null);
    const after = buildInstanceKey('Claude Code', 'VS Code', null);
    expect(before).toBe(after);
    expect(before).toBe('Claude Code::VS Code');
  });

  it('PID is never part of the durable key', () => {
    // Callers must not pass pid; the helper has no pid parameter.
    expect(buildInstanceKey('Claude Code', null, null)).toBe('Claude Code');
    expect(buildInstanceKey.length).toBe(3);
  });

  it('missing path (cwd) falls back to editor then name — never fabricates path', () => {
    expect(buildInstanceKey('opencode', 'Cursor', null)).toBe('opencode::Cursor');
    expect(buildInstanceKey('opencode', null, null)).toBe('opencode');
  });

  it('same-name concurrent runtimes intentionally share durable key when cwd absent', () => {
    // Two live instanceIds, one permissions bucket — honest by design.
    const durable = buildInstanceKey('Claude Code', null, null);
    const idA = buildInstanceId({ pid: 100, startTime: 1_000 });
    const idB = buildInstanceId({ pid: 200, startTime: 2_000 });
    expect(idA).not.toBe(idB);
    expect(durable).toBe('Claude Code');
    expect(durable).not.toBe(idA);
    expect(durable).not.toBe(idB);
  });
});

describe('identity domain separation', () => {
  it('instanceKey is not instanceId and not watchlist alone when cwd present', () => {
    const name = 'Claude Code';
    const cwd = '/work/repo';
    const instanceKey = buildInstanceKey(name, null, cwd);
    const instanceId = buildInstanceId({ pid: 5511, startTime: 1_700_000_000_000 });
    const watch = watchlistSignature({ name, agent: name });
    const ack = acknowledgementInstanceId({ instanceId, name });

    expect(instanceKey).toBe('Claude Code::/work/repo');
    expect(instanceId).toBe('5511:1700000000000');
    expect(watch).toBe('Claude Code');
    expect(ack).toBe(instanceId);

    expect(instanceKey).not.toBe(instanceId);
    expect(instanceKey).not.toBe(watch);
    expect(ack).not.toBe(instanceKey);
    expect(ack).not.toBe(watch);
  });

  it('acknowledgement never uses durable instanceKey or display name', () => {
    const agent = {
      name: 'Claude Code',
      instanceId: '100:start-A',
      cwd: '/proj',
    };
    expect(acknowledgementInstanceId(agent)).toBe('100:start-A');
    expect(acknowledgementInstanceId(agent)).not.toBe(
      buildInstanceKey(agent.name, null, agent.cwd),
    );
    expect(acknowledgementInstanceId({ name: 'Claude Code', instanceId: null })).toBeNull();
  });

  it('watchlist stays name-based and ignores instanceId / durable key', () => {
    expect(
      watchlistSignature({
        name: 'Claude Code',
        instanceId: '999:start-Z',
        cwd: '/secret',
      }),
    ).toBe('Claude Code');
    expect(watchlistSignature({ instanceId: '999:start-Z', pid: 1 })).toBeNull();
  });

  it('PID reuse changes instanceId but not durable instanceKey', () => {
    const durable = buildInstanceKey('Claude Code', null, '/proj');
    const firstLife = buildInstanceId({ pid: 1234, startTime: 100 });
    const secondLife = buildInstanceId({ pid: 1234, startTime: 200 });
    expect(firstLife).not.toBe(secondLife);
    expect(buildInstanceKey('Claude Code', null, '/proj')).toBe(durable);
  });
});
