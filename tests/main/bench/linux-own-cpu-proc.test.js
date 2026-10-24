import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statText } from './linux-own-cpu-fixtures.js';
const require = createRequire(import.meta.url);
const proc = require('../../../bench/lib/linux-own-cpu-proc');
const childProcess = require('node:child_process');
afterEach(() => vi.restoreAllMocks());
describe('bounded SELF proc and clock-tick parsing (CI only)', () => {
  it('uses the last parenthesis and preserves exact large unsigned fields without PID/comm', () => {
    const bytes = statText({
      pid: 17,
      user: '18446744073709551615',
      system: '9007199254740993',
      start: '9007199254740994',
    });
    const result = proc.parseSelfStat(bytes, 17);
    expect(result).toEqual({
      userTicks: '18446744073709551615',
      systemTicks: '9007199254740993',
      startTicks: '9007199254740994',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(JSON.stringify(result)).not.toContain('private name');
    expect(result).not.toHaveProperty('pid');
  });
  it.each(['pid', 'negative', 'overflow', 'truncated', 'nul', 'utf8', 'oversized'])(
    'refuses invalid %s stat with fixed diagnostics',
    (kind) => {
      let bytes = statText({ pid: 17 });
      if (kind === 'pid') bytes = statText({ pid: 18 });
      if (kind === 'negative') bytes = statText({ pid: 17, user: '-1' });
      if (kind === 'overflow') bytes = statText({ pid: 17, start: '18446744073709551616' });
      if (kind === 'truncated') bytes = Buffer.from('17 (name) R 0 0');
      if (kind === 'nul') bytes = Buffer.concat([bytes, Buffer.from([0])]);
      if (kind === 'utf8')
        bytes = Buffer.concat([Buffer.from('17 ('), Buffer.from([255]), Buffer.from(') R')]);
      if (kind === 'oversized') bytes = Buffer.alloc(16385, 32);
      expect(() => proc.parseSelfStat(bytes, 17)).toThrow(/^linux-own-cpu-proc-unavailable$/);
    },
  );
  it.each([
    Buffer.from('0\n'),
    Buffer.from('3\n'),
    Buffer.from('100 garbage'),
    Buffer.from([0xb1, 0xb0, 0xb0, 0x0a]),
    Buffer.alloc(129, 49),
  ])('refuses unsupported/noncanonical getconf bytes %#', (bytes) => {
    expect(() => proc.parseClockTicks(bytes)).toThrow(/^linux-own-cpu-proc-unavailable$/);
  });
  it('uses exactly the fixed absolute getconf command, timeout, byte cap and minimal environment', () => {
    const exec = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from('100\n'));
    expect(proc.parseClockTicks(proc.getClockTicks())).toBe('100');
    expect(exec).toHaveBeenCalledExactlyOnceWith('/usr/bin/getconf', ['CLK_TCK'], {
      timeout: 1000,
      maxBuffer: 128,
      env: { LC_ALL: 'C' },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });
});
