import { describe, it, expect } from 'vitest';
import { formatBytes } from '../../src/renderer/lib/utils/format-bytes.ts';

describe('format-bytes', () => {
  describe('formatBytes()', () => {
    it('returns "0 B" for zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes below 1 KB', () => {
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(10240)).toBe('10.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(524288)).toBe('512.0 KB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
    });

    it('formats terabytes', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB');
      expect(formatBytes(1649267441664)).toBe('1.5 TB');
    });

    it('caps at terabytes for very large numbers', () => {
      // 1 PB = 1024 TB → should show as 1024.0 TB
      expect(formatBytes(1125899906842624)).toBe('1024.0 TB');
    });

    it('returns "0 B" for negative numbers', () => {
      expect(formatBytes(-1)).toBe('0 B');
      expect(formatBytes(-1024)).toBe('0 B');
    });

    it('returns "0 B" for NaN', () => {
      expect(formatBytes(NaN)).toBe('0 B');
    });

    it('returns "0 B" for Infinity', () => {
      expect(formatBytes(Infinity)).toBe('0 B');
      expect(formatBytes(-Infinity)).toBe('0 B');
    });

    it('handles fractional bytes by flooring', () => {
      // 999.7 bytes → should show as 999 B (floored)
      expect(formatBytes(999.7)).toBe('999 B');
    });

    it('rounds to one decimal place for KB+', () => {
      // 1024 + 102.4 = 1126.4 → 1.1 KB
      expect(formatBytes(1126.4)).toBe('1.1 KB');
    });
  });
});
