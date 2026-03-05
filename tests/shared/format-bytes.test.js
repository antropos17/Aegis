import { describe, it, expect } from 'vitest';
import { formatBytes } from '../../src/shared/format-bytes.js';

describe('formatBytes', () => {
  describe('edge cases', () => {
    it('returns "0 B" for zero', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('returns "0 B" for negative numbers', () => {
      expect(formatBytes(-100)).toBe('0 B');
    });

    it('handles very small numbers', () => {
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });
  });

  describe('bytes to KB', () => {
    it('formats bytes to KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048575)).toBe('1024.0 KB');
    });
  });

  describe('KB to MB', () => {
    it('formats KB to MB', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
    });
  });

  describe('MB to GB', () => {
    it('formats MB to GB', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
    });
  });

  describe('GB to TB', () => {
    it('formats GB to TB', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB');
      expect(formatBytes(1649267441664)).toBe('1.5 TB');
    });
  });
});
