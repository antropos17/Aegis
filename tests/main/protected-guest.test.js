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
