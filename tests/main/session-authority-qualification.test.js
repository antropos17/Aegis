import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(
  new URL('../../scripts/qualification/qualify-session-authority.mjs', import.meta.url),
);

it.each(['allow', 'ask', 'deny', 'lost-response', 'revoked'])(
  'qualifies fixed %s policy via the real reusable broker and independent effect oracle',
  async (mode) => {
    const { stdout, stderr } = await execute(process.execPath, [script, mode], {
      timeout: 15000,
      maxBuffer: 4096,
      windowsHide: true,
    });
    expect(stderr).toBe('');
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      fixturePassed: true,
      mode,
      launchAllowed: false,
      nativeContainmentQualified: false,
      replay: 'refused',
    });
    expect(result.dispatchCount).toBe(['deny', 'revoked'].includes(mode) ? 0 : 1);
    expect(result.sentinelBytes).toBe(result.dispatchCount);
    expect(stdout).not.toMatch(/dummy-policy|fixed-dummy|aegis-session-qualification-/);
  },
);

it.each([{ args: [] }, { args: ['unsupported'] }, { args: ['allow', 'extra'] }])(
  'refuses arbitrary selectors and extra arguments before qualification: $args',
  async ({ args }) => {
    try {
      await execute(process.execPath, [script, ...args], {
        timeout: 15000,
        maxBuffer: 4096,
        windowsHide: true,
      });
      throw Error('unexpected success');
    } catch (error) {
      expect(error.code).toBe(2);
      expect(JSON.parse(error.stdout)).toEqual({
        schemaVersion: 1,
        state: 'unavailable',
        launchAllowed: false,
      });
    }
  },
);
