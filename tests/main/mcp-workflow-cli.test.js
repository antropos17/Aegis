import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MODES } from '../../scripts/qualification/qualify-mcp-workflows.mjs';

const run = promisify(execFile);
const entry = fileURLToPath(
  new URL('../../scripts/qualification/qualify-mcp-workflows.mjs', import.meta.url),
);
it('runs every fixed scenario through the real CLI with bounded, secret-free receipts', async () => {
  const { stdout, stderr } = await run(process.execPath, [entry, 'all'], {
    timeout: 15000,
    maxBuffer: 32768,
    windowsHide: true,
  });
  expect(stderr).toBe('');
  expect(Buffer.byteLength(stdout)).toBeLessThan(16384);
  expect(stdout).not.toMatch(
    /Bearer |bearerToken|DUMMY_KNOWN_SECRET|dummy-byte-effect|127\.0\.0\.1/,
  );
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({ developerOnly: true, launchAllowed: false });
  expect(report.scenarios.map((scenario) => scenario.mode)).toEqual(MODES);
  expect(report.scenarios.every((scenario) => scenario.passed)).toBe(true);
});

it.each(
  [[], ['--server', 'unselected'], ['unknown'], ['allow-api', 'extra']].map((args) => ({ args })),
)('refuses unsupported CLI selectors $args before effects', async ({ args }) => {
  await expect(
    run(process.execPath, [entry, ...args], { timeout: 5000, maxBuffer: 4096, windowsHide: true }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: '',
    stderr: 'mcp-workflow-qualification-unavailable\n',
  });
});
