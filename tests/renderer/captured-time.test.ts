import { describe, expect, it } from 'vitest';
import { capturedTime } from '../../frontend/observatory/runtime/captured-time';

const iso = '2026-10-19T12:00:00.000Z';
const epoch = 1792411200000;
// Built from local-date parts so the expectation holds in any test timezone.
const local = new Date(epoch);
const [month, day, year] = [local.getMonth() + 1, local.getDate(), local.getFullYear()];

describe('capturedTime', () => {
  it('orders the date by the selected language for epoch and ISO captures', () => {
    expect(new Date(iso).getTime()).toBe(epoch);
    for (const value of [epoch, iso]) {
      expect(capturedTime(value, 'en')).toContain(`${month}/${day}/${year}`);
      expect(capturedTime(value, 'pt')).toContain(`${day}/${month}/${year}`);
    }
  });

  it('keeps absent and invalid captures unavailable', () => {
    for (const value of [undefined, null, '', 'not-a-date', NaN, -1, 8640000000000001, {}])
      for (const locale of ['en', 'pt']) expect(capturedTime(value, locale)).toBe('Not reported');
  });
});
