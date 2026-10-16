import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('protected guest startup', () => {
  function invoke(mode) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        'tests/fixtures/protected-installation/guest-fixture.ps1',
        mode,
      ],
      {
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 16384,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr.toString()).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.toString());
  }
  it('flushes a consumed start intent before releasing the offline disk and refuses a second start', () => {
    expect(invoke('positive')).toEqual({
      refused: false,
      unknown: false,
      priorClosed: true,
      replayRefused: true,
      events: [
        'configuration-Off',
        'pending-start.json',
        'configuration-Running',
        'settled-start.json',
      ],
    });
  });
  it.each(['state-lag', 'state-off-lag'])(
    'waits for cmdlet agreement with the original native owner after a settled transition: %s',
    (mode) => {
      expect(invoke(mode)).toEqual({ refused: false, samples: 2, observations: 2 });
    },
  );
  it('refuses native loss of running state even when the cmdlet subsequently reports Running', () => {
    expect(invoke('state-changed')).toEqual({ refused: true, samples: 2, observations: 2 });
  });
  it('refuses an already stopped native VM without another provider start', () => {
    expect(invoke('state-stopped')).toEqual({ refused: true, samples: 1, observations: 1 });
  });
  it('never re-observes unresolved provider work as a settled transition', () => {
    expect(invoke('state-pending')).toEqual({ refused: true, samples: 0, observations: 0 });
  });
  it('bounds disagreement with a cmdlet that never observes the native running state', () => {
    expect(invoke('state-never')).toMatchObject({ refused: true });
  });
  it('compiles native retained-owner state observation without constructing a VM owner', () => {
    expect(invoke('vm-native-compile')).toEqual({ stateType: 'System.UInt16' });
  });
  it('derives the Windows worker capability and refuses it outside the original VM configuration or for another capability', () => {
    expect(invoke('worker-capability')).toEqual({
      sid: 'S-1-15-3-1024-2268835264-3721307629-241982045-173645152-1490879176-104643441-2915960892-1612460704',
      ownConfig: true,
      directory: false,
      disk: false,
      foreignVm: false,
      unknownCapability: false,
      genericAll: false,
    });
  });
  it('exports only scoped event IDs and finite numeric codes, excluding event content and other VMs', () => {
    expect(invoke('failure-events')).toEqual({
      rows: [
        { log: 'Microsoft-Windows-Hyper-V-VMMS-Admin', id: 12345, codes: ['0x80070005'] },
        { log: 'Microsoft-Windows-Hyper-V-Worker-Admin', id: 12345, codes: ['0x80070005'] },
      ],
    });
  });
  it('bounds startup event evidence to sixteen records', () => {
    const { rows } = invoke('failure-events-many');
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.id === 12345 && row.codes.length === 1)).toBe(true);
  });
  it('refuses changed configuration before consuming start or releasing media', () => {
    expect(invoke('configuration')).toMatchObject({
      refused: true,
      unknown: false,
      priorClosed: false,
      events: ['configuration-Off'],
    });
  });
  it('refuses insufficient host capacity before consuming start or releasing media', () => {
    expect(invoke('capacity')).toMatchObject({
      refused: true,
      unknown: false,
      priorClosed: false,
      events: [],
    });
  });
  it('measures only owned preflight output and skips retained junction targets', () => {
    expect(invoke('preflight-storage')).toEqual({
      entries: 2,
      bytes: 3,
      skipped: 1,
      externalPreserved: true,
    });
  });
  it('preserves the offline pin if durable intent cannot be written', () => {
    expect(invoke('journal')).toMatchObject({
      refused: true,
      unknown: true,
      priorClosed: false,
      events: ['configuration-Off', 'pending-start.json'],
    });
  });
  it('retains an unresolved provider transition without publishing a running result', () => {
    expect(invoke('provider')).toMatchObject({
      refused: true,
      unknown: true,
      priorClosed: true,
      events: ['configuration-Off', 'pending-start.json'],
    });
  });
  it('preserves empty, spaced, quoted and trailing slash arguments and refuses embedded NUL', () => {
    expect(invoke('quote')).toEqual({
      quotes: ['""', '"a b"', '"c\\"d\\\\"', '"back\\slash"', '"\\""'],
      nulRefused: true,
    });
  });
  it('permits hydration writes while preserving the original file ID and delete sharing exclusion', () => {
    expect(invoke('pin')).toEqual({
      offlineWriteBlocked: true,
      liveWriteSucceeded: true,
      liveDeleteBlocked: true,
      originalId: true,
    });
  });
  it('refuses an altered executable before consuming the agent operation', () => {
    expect(invoke('agent-digest')).toMatchObject({
      refused: true,
      consumed: false,
      workerRemoved: false,
      events: ['configuration-Running'],
    });
  });
  it('refuses a repeated agent operation before accessing its package', () => {
    expect(invoke('agent-replay')).toMatchObject({
      refused: true,
      consumed: true,
      workerRemoved: false,
      events: [],
    });
  });
  it.each(['agent-nonce', 'agent-open-job', 'agent-admin'])(
    'refuses an unauthenticated or unclosed guest result without publishing success: %s',
    (mode) => {
      expect(invoke(mode)).toMatchObject({
        refused: true,
        consumed: true,
        workerRemoved: true,
        events: ['configuration-Running', 'pending-agent.json'],
      });
    },
  );
  it('publishes agent settlement only after exact channel result and fresh VM configuration checks', () => {
    expect(invoke('agent-positive')).toMatchObject({
      refused: false,
      consumed: true,
      workerRemoved: true,
      events: [
        'configuration-Running',
        'pending-agent.json',
        'configuration-Running',
        'settled-agent.json',
      ],
    });
  });
  it.each([
    'agent-extra-key',
    'agent-shadow-members',
    'agent-schema-string',
    'agent-id-array',
    'agent-nonce-array',
    'agent-digest-array',
    'agent-key-case',
    'agent-exit-negative',
    'agent-exit-overflow',
    'agent-quota-string',
    'agent-job-string',
    'agent-object',
    'agent-multiple',
  ])('refuses malformed guest result before publishing settlement: %s', (mode) => {
    expect(invoke(mode)).toMatchObject({
      refused: true,
      consumed: true,
      workerRemoved: true,
      events: ['configuration-Running', 'pending-agent.json'],
    });
  });
  it('copies only canonical result fields and excludes remoting note properties', () => {
    expect(invoke('agent-metadata')).toEqual({
      refused: false,
      metadataLeaked: false,
      keys: [
        'diskQuotaBytes',
        'executableSha256',
        'exitCode',
        'jobClosed',
        'nonce',
        'schemaVersion',
        'standardToken',
        'vmId',
      ],
    });
  });
  it('accepts typed nonzero exits through a real Windows PowerShell job and nested serialization', () => {
    expect(invoke('result-serialization')).toEqual({
      count: 8,
      exitCode: 17,
      versionType: 'System.Int32',
      quotaType: 'System.Int64',
      noteProperties: 0,
    });
  });
  it.each([
    'tree-foreign',
    'tree-foreign-config',
    'tree-disk-replaced',
    'tree-parent-replaced',
    'tree-missing',
  ])('retains unexpected files, replaced storage and missing original inventory: %s', (mode) => {
    expect(invoke(mode)).toEqual({ refused: true });
  });
  it.each(['tree-journal', 'tree-config-renewal'])(
    'permits only named administrative journals and exact-VM configuration renewal: %s',
    (mode) => {
      expect(invoke(mode)).toEqual({ refused: false });
    },
  );
});
