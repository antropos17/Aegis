import { expect, it } from 'vitest';
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
