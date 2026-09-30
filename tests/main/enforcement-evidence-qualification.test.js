import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { auditChild, cleanup } from '../../scripts/qualification/enforcement-evidence-fixtures.mjs';
import { qualifyEnforcementEvidence } from '../../scripts/qualification/qualify-enforcement-evidence.mjs';
it('executes actual policy/gateway/receiver and fresh-process audit failure, eviction, recovery and valid-prefix cases', async () => {
  const result = await qualifyEnforcementEvidence();
  expect(result.passed).toBe(true);
  expect(result.rows.length).toBeGreaterThanOrEqual(13);
  expect(result.rows.find((r) => r.mode === 'deny')).toMatchObject({ receiverCalls: 0 });
  expect(result.rows.find((r) => r.mode === 'ask')).toMatchObject({ receiverCalls: 0 });
  expect(result.rows.find((r) => r.mode === 'lost-response')).toMatchObject({ receiverCalls: 1 });
  expect(result.rows.find((r) => r.mode === 'audit-eviction')).toMatchObject({
    dropped: 1,
    chainValid: true,
    completeness: 'incomplete',
  });
  expect(result.launchAllowed).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/Bearer|bearerToken|AEGIS_DUMMY_LABEL/);
}, 15000);

it('runs the actual audit child without Windows TEMP using the same OS-selected disposable parent', async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-evidence-'));
  const operationId = randomUUID();
  const records = ['consumed', 'dispatch', 'completed'].map((code, seq) => ({
    schemaVersion: 1,
    seq,
    operationId,
    code,
  }));
  try {
    vi.stubEnv('TMP', parent);
    vi.stubEnv('TMPDIR', parent);
    vi.stubEnv('TEMP', undefined);
    expect(process.env.TEMP).toBeUndefined();
    expect(await fs.realpath(os.tmpdir())).toBe(parent);
    const result = await auditChild(root, records, 'normal');
    expect(result).toMatchObject({ chainValid: true, copied: true, records });
    expect(result.status).toMatchObject({ droppedEntries: 0, bufferDepth: 0, writeFailed: false });
  } finally {
    vi.unstubAllEnvs();
    await cleanup(root, parent);
  }
});
