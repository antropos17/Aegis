import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { logGatewayEvidence } = require('../../src/main/enforcement-evidence-audit');
it('copies/freeze finite details before buffering and refuses arbitrary secret fields', () => {
  let retained;
  const audit = {
    log(type, details) {
      expect(type).toBe('gateway-evidence');
      retained = details.extra;
    },
  };
  const event = { schemaVersion: 1, seq: 0, operationId: randomUUID(), code: 'consumed' };
  logGatewayEvidence(audit, event);
  event.code = 'MUTATED';
  expect(retained.code).toBe('consumed');
  expect(Object.isFrozen(retained)).toBe(true);
  expect(() => logGatewayEvidence(audit, { ...event, prompt: 'PRIVATE' })).toThrow(
    'evidence-event-invalid',
  );
});
