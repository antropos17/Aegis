import { expect, it } from 'vitest';
import {
  collectMcpWorkflowQualification,
  MODES,
} from '../../scripts/qualification/qualify-mcp-workflows.mjs';

it('observes zero receiver deliveries and byte effects for a substituted account', async () => {
  const result = await collectMcpWorkflowQualification('account-substitution');
  expect(result.forbiddenDeliveries).toBe(0);
  expect(result.deliveries).toBe(0);
  expect(result.effects).toBe(0);
  expect(result.approvedBytesMatch).toBe(true);
  expect(result.passed).toBe(true);
});

it.each(MODES)(
  'qualifies %s through the actual gateway and independent byte receiver',
  async (mode) => {
    const result = await collectMcpWorkflowQualification(mode);
    expect(result).toMatchObject({
      passed: true,
      developerOnly: true,
      launchAllowed: false,
      forbiddenDeliveries: 0,
      forbiddenBytesAbsent: true,
      alternateRequests: 0,
      approvedBytesMatch: true,
      receiverErrors: 0,
      realIdentityQualified: false,
      serverContainmentQualified: false,
    });
    expect(result.requests).toBeLessThanOrEqual(96);
    if (
      [
        'replay',
        'reconnect',
        'lost-response',
        'cancel-after-dispatch',
        'known-secret-response',
      ].includes(mode)
    )
      expect(result.replayRefused).toBe(true);
    if (
      [
        'allow-filesystem',
        'allow-api',
        'replay',
        'reconnect',
        'lost-response',
        'cancel-after-dispatch',
        'known-secret-response',
      ].includes(mode)
    )
      expect(result.durableConsumed).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /DUMMY_KNOWN_SECRET|dummy-byte-effect|bearerToken|Bearer /,
    );
  },
);
