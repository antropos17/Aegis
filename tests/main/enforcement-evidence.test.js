import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const e = require('../../src/main/enforcement-evidence');
const context = () => ({
  sessionId: randomUUID(),
  epoch: 1,
  policyRevision: 2,
  sourceDigest: 'a'.repeat(64),
  corpusDigest: 'b'.repeat(64),
});
function fixture() {
  const operationId = randomUUID();
  return {
    schemaVersion: 1,
    context: context(),
    records: ['consumed', 'dispatch', 'completed'].map((code, seq) => ({
      schemaVersion: 1,
      seq,
      operationId,
      code,
    })),
    receivers: [{ operationId, consumedRecord: 'exact', effect: 'expected' }],
    claims: { complete: true, lossCount: 0 },
  };
}
const delivery = { observerLoss: 0, auditLoss: 0, pending: 0, terminalKnown: true };
const bytes = (v) => e.encodeEnforcementEvidence(v);
const anchor = (v, d = delivery) => e.createEnforcementEvidenceAnchor(bytes(v), d);
it('never promotes a valid prefix with imported zero-loss/complete claims without owner terminal evidence', () => {
  const v = fixture();
  v.records.pop();
  expect(e.assessEnforcementEvidence(bytes(v)).completeness).toBe('unknown');
  expect(e.assessEnforcementEvidence(bytes(v)).verifiedLocalLinks).toBe(0);
});
it('proves local ordered consumption/dispatch/completion only against independently retained terminal and receiver records', () => {
  const v = fixture();
  expect(e.assessEnforcementEvidence(bytes(v), anchor(v))).toMatchObject({
    completeness: 'complete',
    verifiedLocalLinks: 1,
    externalEffects: 'unknown',
    launchAllowed: false,
  });
});
it('detects a valid trailing prefix despite forged complete/zero-loss metadata', () => {
  const v = fixture(),
    owned = anchor(v);
  v.records.pop();
  expect(e.assessEnforcementEvidence(bytes(v), owned)).toMatchObject({
    completeness: 'incomplete',
    missing: expect.arrayContaining(['owner-terminal-records', 'terminal-outcome']),
  });
});
it.each(['sessionId', 'epoch', 'policyRevision', 'sourceDigest', 'corpusDigest'])(
  'refuses mismatched %s binding',
  (name) => {
    const v = fixture(),
      owned = anchor(v);
    v.context[name] =
      name === 'sessionId'
        ? randomUUID()
        : typeof v.context[name] === 'number'
          ? 3
          : 'c'.repeat(64);
    expect(e.assessEnforcementEvidence(bytes(v), owned).contradictions).toContain(
      'owner-context-mismatch',
    );
  },
);
it('owns terminal bytes across caller mutation and rejects serialized handles', () => {
  const v = fixture(),
    raw = bytes(v),
    owned = e.createEnforcementEvidenceAnchor(raw, delivery);
  raw.fill(0);
  v.receivers[0].effect = 'unexpected';
  expect(e.assessEnforcementEvidence(bytes(fixture()), owned).completeness).toBe('incomplete');
  expect(e.assessEnforcementEvidence(bytes(v), owned).contradictions).toContain(
    'receiver-observation-mismatch',
  );
  expect(
    e.assessEnforcementEvidence(bytes(v), JSON.parse(JSON.stringify(owned))).verifiedLocalLinks,
  ).toBe(0);
});
it.each(['duplicate', 'reorder', 'after-terminal'])('rejects %s event history', (mode) => {
  const v = fixture(),
    owned = anchor(v);
  if (mode === 'duplicate') v.records[1] = { ...v.records[0], seq: 1 };
  if (mode === 'reorder') v.records.reverse();
  if (mode === 'after-terminal') v.records.push({ ...v.records[0], seq: 3 });
  expect(e.assessEnforcementEvidence(bytes(v), owned).completeness).toBe('incomplete');
});
it.each(['absent', 'malformed', 'wrong-id'])(
  'does not credit an independently observed effect with %s consumption',
  (consumedRecord) => {
    const v = fixture();
    v.receivers[0].consumedRecord = consumedRecord;
    expect(e.assessEnforcementEvidence(bytes(v), anchor(v)).contradictions).toContain(
      'effect-without-authority',
    );
  },
);
it('does not trust forged observed success or duplicate receivers', () => {
  const v = fixture(),
    trusted = anchor(v);
  v.receivers[0].effect = 'unexpected';
  expect(e.assessEnforcementEvidence(bytes(v), trusted).verifiedLocalLinks).toBe(0);
  v.receivers.push({ ...v.receivers[0] });
  expect(e.assessEnforcementEvidence(bytes(v), trusted).contradictions).toContain(
    'duplicate-receiver',
  );
});
it.each(['observerLoss', 'auditLoss', 'pending'])(
  'retains owner %s despite imported zero counters',
  (name) => {
    const v = fixture();
    expect(
      e.assessEnforcementEvidence(bytes(v), anchor(v, { ...delivery, [name]: 1 })).completeness,
    ).toBe('incomplete');
  },
);
it('retains unknown completeness without owner terminal observation', () => {
  const v = fixture();
  expect(
    e.assessEnforcementEvidence(bytes(v), anchor(v, { ...delivery, terminalKnown: false }))
      .completeness,
  ).toBe('unknown');
});
it('does not credit a failed dispatch as completed even if receiver observed an effect', () => {
  const v = fixture();
  v.records[2].code = 'failed';
  expect(e.assessEnforcementEvidence(bytes(v), anchor(v))).toMatchObject({
    verifiedLocalLinks: 0,
    externalEffects: 'unknown',
  });
});
it('bounds strict imports, decoded duplicate keys, schemas, identifiers and record counts', () => {
  const raw = bytes(fixture());
  for (const bad of [
    Buffer.alloc(e.LIMITS.bytes + 1),
    Buffer.from([255]),
    Buffer.from(raw.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
  ])
    expect(() => e.assessEnforcementEvidence(bad)).toThrow('evidence-invalid');
  const v = fixture();
  v.records = Array.from({ length: 257 }, () => v.records[0]);
  expect(() => bytes(v)).toThrow('evidence-invalid');
});
it('checks disposable signatures against owner-selected key and exact terminal context, never self-supplied keys', () => {
  const v = fixture(),
    owned = anchor(v),
    key = e.createEvidenceCheckpointKey(),
    signed = e.signEvidenceCheckpoint(owned, key);
  expect(e.verifyEvidenceCheckpoint(signed, owned, key)).toBe(true);
  const other = anchor({ ...v, context: context() });
  expect(e.verifyEvidenceCheckpoint(signed, other, key)).toBe(false);
  expect(e.verifyEvidenceCheckpoint(signed, owned, e.createEvidenceCheckpointKey())).toBe(false);
  signed[20] ^= 1;
  expect(e.verifyEvidenceCheckpoint(signed, owned, key)).toBe(false);
});

it('does not mint a completed local link by replacing the owner failed terminal with an imported success', () => {
  const v = fixture();
  v.records[2].code = 'failed';
  const owned = anchor(v);
  v.records[2].code = 'completed';
  expect(e.assessEnforcementEvidence(bytes(v), owned)).toMatchObject({
    completeness: 'incomplete',
    verifiedLocalLinks: 0,
  });
});
