import { describe, it, expect } from 'vitest';
import { formatBytes } from '../../src/renderer/lib/utils/format-bytes.ts';

describe('formatBytes', () => {
  // ═══════════════════════════════════════════════════════════════
  // BOUNDARY TRANSITIONS
  // Tests the exact thresholds where the unit changes.
  // These are where off-by-one bugs in the division loop surface.
  // ═══════════════════════════════════════════════════════════════
  describe('boundary transitions', () => {
    it('stays in bytes at 1023 (one below KB threshold)', () => {
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('transitions from bytes to KB at exactly 1024', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('stays in KB at 1048575 (one below MB threshold)', () => {
      // 1024 * 1024 - 1 = 1048575
      const result = formatBytes(1048575);
      expect(result).toContain('KB');
      expect(result).toBe('1024.0 KB');
    });

    it('transitions from KB to MB at exactly 1048576', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
    });

    it('stays in MB at 1073741823 (one below GB threshold)', () => {
      // 1024^3 - 1
      const result = formatBytes(1073741823);
      expect(result).toContain('MB');
    });

    it('transitions from MB to GB at exactly 1073741824', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
    });

    it('stays in GB at 1099511627775 (one below TB threshold)', () => {
      // 1024^4 - 1
      const result = formatBytes(1099511627775);
      expect(result).toContain('GB');
    });

    it('transitions from GB to TB at exactly 1099511627776', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ROUNDING BEHAVIOR
  // Verifies that toFixed(1) rounding produces expected results.
  // Catches floating-point precision issues and rounding direction.
  // ═══════════════════════════════════════════════════════════════
  describe('rounding behavior', () => {
    it('renders exact halves with one decimal (1.5 KB)', () => {
      // 1536 = 1024 * 1.5 — exact binary fraction, no rounding needed
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('rounds 1792 bytes to 1.8 KB (1024 + 512 + 256)', () => {
      // 1792 / 1024 = 1.75 → toFixed(1) rounds to 1.8
      expect(formatBytes(1792)).toBe('1.8 KB');
    });

    it('floors fractional bytes instead of rounding (999.7 → 999 B)', () => {
      // Math.floor is used for byte-range values
      expect(formatBytes(999.7)).toBe('999 B');
    });

    it('always shows one decimal place for KB and above', () => {
      // 2048 / 1024 = exactly 2.0 — must still show ".0"
      expect(formatBytes(2048)).toBe('2.0 KB');
    });

    it('never shows decimal places for bytes', () => {
      const result = formatBytes(500);
      expect(result).toBe('500 B');
      expect(result).not.toContain('.');
    });

    it('handles value near rounding boundary (1024 * 1.05 = 1075.2)', () => {
      // 1075.2 / 1024 = 1.05 → toFixed(1) = "1.0" or "1.1"?
      // 1.05.toFixed(1) = "1.1" in most JS engines (rounds half up)
      expect(formatBytes(1075.2)).toBe('1.1 KB');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASES
  // Protects against crashes and undefined behavior on invalid input.
  // The guard clause should handle all non-finite and negative values.
  // ═══════════════════════════════════════════════════════════════
  describe('edge cases', () => {
    it('returns "0 B" for zero (not undefined or empty string)', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('treats negative numbers as invalid, returning "0 B"', () => {
      expect(formatBytes(-1)).toBe('0 B');
      expect(formatBytes(-1024)).toBe('0 B');
    });

    it('treats NaN as invalid, returning "0 B"', () => {
      expect(formatBytes(NaN)).toBe('0 B');
    });

    it('treats Infinity as invalid, returning "0 B"', () => {
      expect(formatBytes(Infinity)).toBe('0 B');
    });

    it('treats -Infinity as invalid, returning "0 B"', () => {
      expect(formatBytes(-Infinity)).toBe('0 B');
    });

    it('handles 1 byte without pluralization issues', () => {
      expect(formatBytes(1)).toBe('1 B');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SCALE LIMITS
  // TB is the highest unit in the UNITS array. Values beyond 1 PB
  // must stay expressed in TB (the loop stops at the last unit).
  // ═══════════════════════════════════════════════════════════════
  describe('scale limits', () => {
    it('caps at TB for petabyte-scale values (1 PB = 1024.0 TB)', () => {
      // 1024^5 = 1125899906842624
      expect(formatBytes(1125899906842624)).toBe('1024.0 TB');
    });

    it('does not crash on Number.MAX_SAFE_INTEGER', () => {
      // 2^53 - 1 = 9007199254740991
      const result = formatBytes(9007199254740991);
      expect(result).toContain('TB');
      expect(typeof result).toBe('string');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RETURN TYPE CONSISTENCY
  // Every code path must return a string matching "number unit" format.
  // ═══════════════════════════════════════════════════════════════
  describe('return type consistency', () => {
    it('always returns a string for valid inputs', () => {
      const inputs = [0, 1, 512, 1024, 1048576, 1073741824];
      for (const input of inputs) {
        expect(typeof formatBytes(input)).toBe('string');
      }
    });

    it('always returns a string for invalid inputs', () => {
      const inputs = [-1, NaN, Infinity, -Infinity];
      for (const input of inputs) {
        expect(typeof formatBytes(input)).toBe('string');
      }
    });

    it('output always matches "number unit" format', () => {
      const pattern = /^\d+(\.\d)? [A-Z]{1,2}$/;
      const inputs = [0, 1, 1023, 1024, 1048576, 1099511627776];
      for (const input of inputs) {
        expect(formatBytes(input)).toMatch(pattern);
      }
    });
  });
});
