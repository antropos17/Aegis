import { it, expect } from 'vitest';
import {
  evidenceFields,
  fieldValue,
  informationFields,
} from '../../frontend/observatory/runtime/detail-fields';

it('distinguishes absent identity, endpoint evidence and working directory without inventing measurements', () => {
  expect(fieldValue(null, 'cwd')).toBe('Working directory not recorded');
  expect(fieldValue(null, 'instanceId')).toBe('Process identity not recorded');
  expect(fieldValue('unknown', 'instanceIdSource')).toBe('Process start time not observed');
  expect(fieldValue('unknown', 'verdict')).toBe('Endpoint unverified');
  expect(fieldValue(null, 'cpu')).toBe('Unavailable');
  expect(fieldValue(0, 'cpu')).toBe('0');
  expect(fieldValue(false, 'estimated')).toBe('No');
  expect(fieldValue('unknown', 'projectName')).toBe('unknown');
});

it.each([
  ['ptr-missing', 'No reverse-DNS name was available; the lookup may also have failed.'],
  ['ptr-unconfirmed', 'The reverse-DNS name did not resolve back to this address.'],
])('retains and explains recorded network reason %s', (reason, explanation) => {
  const row = { remoteIp: '192.0.2.1', verdict: 'unknown', verdictReason: reason };
  const fields = informationFields(evidenceFields(row));
  expect(fields).toContainEqual({
    key: 'verdict',
    label: 'Endpoint verification',
    value: 'Endpoint unverified',
  });
  expect(fields).toContainEqual({
    key: 'verdictReason',
    label: 'Verification evidence',
    value: explanation,
  });
  expect(row.verdict).toBe('unknown');
  expect(row.verdictReason).toBe(reason);
});

it('keeps legacy and future verification evidence distinguishable', () => {
  expect(fieldValue(undefined, 'verdictReason')).toBe('Verification reason not recorded');
  expect(fieldValue('new-provider-state', 'verdictReason')).toBe('new provider state');
  expect(fieldValue('toString', 'verdictReason')).toBe('toString');
  expect(fieldValue('constructor', 'verdict')).toBe('constructor');
  expect(evidenceFields({ verdict: 'unknown' })).not.toHaveProperty('verdictReason');
});

it('retains exact evidence semantics and excludes secrets while formatting reasons', () => {
  const fields = evidenceFields({
    apiKey: 'private',
    attribution: { status: 'unattributed', evidence: ['population-unavailable'] },
  });
  expect(fields).toEqual({
    evidence: ['Process observation was unavailable when this event was recorded.'],
    attribution: 'unattributed',
  });
});
