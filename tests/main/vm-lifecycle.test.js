import { expect, it } from 'vitest';
import { collectVmLifecycle } from '../../scripts/qualification/qualify-vm-lifecycle.mjs';

it('executes the synthetic lifecycle against the real fsync journal without native authority', async () => {
  const receipt = await collectVmLifecycle();
  expect(receipt.summary).toEqual({
    scope: 'synthetic-vm-lifecycle',
    effectsRun: false,
    launchAllowed: false,
    nativeContainmentQualified: false,
    states: ['ready', 'running', 'stopped'],
    fixtureReleases: 1,
    recoveryLaunchAllowed: false,
  });
  expect(receipt.journalRows.map((row) => row.entry.event)).toEqual([
    'created',
    'start-intent',
    'ready',
    'release-intent',
    'released',
    'stop-intent',
    'stopped',
  ]);
  expect(receipt.journalSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(receipt.sourceSha256)).toHaveLength(5);
  expect(JSON.stringify(receipt)).not.toMatch(/"key"|"challenge"|S-1-5-21-/);
});
