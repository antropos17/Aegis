import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { APP_HEALTH_STATE, APP_HEALTH_REASON } from '../../src/main/app-health.js';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

/**
 * Read a `export type X = 'a' | 'b';` union out of a .ts file as an ordered list.
 *
 * Per-member JSDoc is stripped FIRST: a comment may legally contain quoted text, and a
 * naive literal scan would then read prose as a member.
 * @param {string} src
 * @param {string} name
 * @returns {string[]}
 */
function readUnion(src, name) {
  const union = src.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  expect(union, `union ${name} not found`).not.toBeNull();
  return [
    ...union[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .matchAll(/'([^']+)'/g),
  ].map((m) => m[1]);
}

// A closed list living in two languages is connected by nothing else: `tsc` cannot see
// a frozen runtime object, and the runtime cannot see a union. Same mechanism as
// file-watcher-attribution.test.js's EVIDENCE_CODES mirror (PR #227).
describe('app-health typed mirror', () => {
  const src = readFileSync(
    new URL('../../src/shared/types/app-health.ts', import.meta.url),
    'utf-8',
  );

  it('AppHealthState mirrors APP_HEALTH_STATE exactly, in declaration order', () => {
    // Order included: a mirror that agrees only as a SET hides which member was
    // appended where, and the runtime table's order is the emitted order elsewhere.
    expect(readUnion(src, 'AppHealthState')).toEqual(Object.values(APP_HEALTH_STATE));
  });

  it('AppHealthReason mirrors APP_HEALTH_REASON exactly, in declaration order', () => {
    // This one carries real weight: APP_HEALTH_REASON's declaration order IS the order
    // `reasons` is emitted in, so a drifted union misdescribes the array's shape.
    expect(readUnion(src, 'AppHealthReason')).toEqual(Object.values(APP_HEALTH_REASON));
  });

  it('SensorHealthState mirrors SENSOR_HEALTH_STATE exactly, in declaration order', () => {
    expect(readUnion(src, 'SensorHealthState')).toEqual(Object.values(SENSOR_HEALTH_STATE));
  });

  it('the aggregate sentinel NONE is in the typed state but not in the leaf enum', () => {
    // `SensorHealthAggregate.state` is `SensorHealthState | 'NONE'`. NONE is a property
    // of the AGGREGATE — zero participation — and must never become a leaf state.
    expect(Object.values(SENSOR_HEALTH_STATE)).not.toContain('NONE');
    expect(src).toContain("readonly state: SensorHealthState | 'NONE';");
  });

  it('the payload type does not carry monitoringPaused', () => {
    // Operator control rides beside appHealth as `stats.monitoringPaused`, never inside
    // it. If the field ever appears in this file, orthogonality has been given up in
    // the type before it was given up in the code.
    expect(src).not.toMatch(/^\s*readonly monitoringPaused/m);
  });
});
