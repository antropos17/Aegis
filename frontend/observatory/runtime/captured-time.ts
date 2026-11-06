import { coverageTime } from './sensor-coverage';

/** Format a captured epoch or ISO timestamp in the selected app language.
 * @param value Recorded capture time @param locale UI locale
 * @returns Timestamp or localizable absence @since 0.24.0-beta
 */
export function capturedTime(value: unknown, locale: string): string {
  return coverageTime(typeof value === 'string' ? Date.parse(value) : value, locale);
}
