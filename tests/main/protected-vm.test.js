import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('protected VM provisioning', () => {
  function invoke(mode, scratch = '') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        'tests/fixtures/protected-installation/vm-fixture.ps1',
        mode,
        scratch,
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
  it('copies the exact image with the supplied ACL and refuses source writes, existing output and bad hashes', () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'aegis-vm-image-'));
    try {
      expect(invoke('image', path.join(parent, 'owned'))).toEqual({
        equal: true,
        sourceWriteBlocked: true,
        existingRefused: true,
        badDigestNoEffects: true,
        descriptorRetained: true,
      });
    } finally {
      if (readdirSync(parent).length === 0) rmdirSync(parent);
    }
  });
  it('durably records intent before create and retains only the returned identity', () => {
    expect(invoke('positive')).toEqual({
      refused: false,
      unknown: false,
      vmId: '11111111-2222-3333-4444-555555555555',
      events: ['pending-create.json', 'provider-create', 'settled-create.json'],
    });
  });
  it.each([
    'timeout',
    'wrong-id',
    'wrong-name',
    'running',
    'journal-failed',
    'disk-failed',
    'remove-present',
  ])('retains uncertain state without recovery, adoption or compensating mutations: %s', (mode) => {
    const result = invoke(mode);
    expect(result.refused).toBe(true);
    expect(result.unknown).toBe(true);
    expect(result.events).not.toContain('provider-observe');
    if (mode === 'journal-failed') expect(result.events).toEqual(['pending-create.json']);
    if (mode !== 'remove-present') expect(result.events).not.toContain('provider-remove');
  });
  it('requires confirmed absence before publishing a removal settlement', () => {
    expect(invoke('remove')).toMatchObject({
      refused: false,
      unknown: false,
      events: [
        'pending-create.json',
        'provider-create',
        'settled-create.json',
        'pending-remove.json',
        'provider-remove',
        'settled-remove.json',
      ],
    });
  });
});
