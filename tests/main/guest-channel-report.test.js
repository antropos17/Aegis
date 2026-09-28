import { describe, expect, it } from 'vitest';
import {
  GUEST_CHANNEL_MODES,
  GUEST_CHANNEL_REFUSALS,
  summarizeGuestChannelReport,
} from '../../scripts/qualification/guest-channel-report.mjs';

const frame = Buffer.from([1, 0, 0, 0, 65]).toString('base64');
function report(mode = 'admit') {
  return {
    version: 1,
    scope: 'guest-channel-process-fixture',
    mode,
    initialized: true,
    initialJobActiveProcesses: 2,
    taskObserved: ['admit', 'bad-result', 'oversized-result'].includes(mode),
    resultAccepted: mode === 'admit',
    stopMessageAccepted: ['admit', 'cancel'].includes(mode),
    childExited: true,
    jobEmpty: true,
    refusalReason: GUEST_CHANNEL_REFUSALS[mode] || null,
    ...Object.fromEntries(
      ['processStamp', 'image', 'runtime', 'principal', 'job', 'node', 'git'].map((name) => [
        name + 'Sha256',
        '1'.repeat(64),
      ]),
    ),
    initializedFrameBase64: frame,
    resultFrameBase64: mode === 'admit' ? frame : null,
    stoppedFrameBase64: ['admit', 'cancel'].includes(mode) ? frame : null,
  };
}
describe('guest channel observation report', () => {
  it.each(GUEST_CHANNEL_MODES)('keeps %s non-authorizing', (mode) => {
    expect(summarizeGuestChannelReport(JSON.stringify(report(mode)))).toMatchObject({
      heldChildClosureConfirmed: true,
      ownedJobEmptyConfirmed: true,
      transport: 'anonymous-pipe',
      guestNodeGitQualified: false,
      vmEffectsRun: false,
      launchAllowed: false,
      nativeContainmentQualified: false,
    });
  });
  it.each([
    { launchAllowed: true },
    { mode: 'arbitrary command' },
    { version: 2 },
    { initialized: false },
    { childExited: false },
    { jobEmpty: false },
    { initialJobActiveProcesses: 0 },
    { initialJobActiveProcesses: 1.5 },
    { taskObserved: false },
    { resultAccepted: false },
    { stopMessageAccepted: false },
    { nodeSha256: null },
    { gitSha256: 'unobserved' },
    { refusalReason: 'loader-unavailable' },
    { initializedFrameBase64: 'AA==' },
    { resultFrameBase64: null },
    { stoppedFrameBase64: frame + '\n' },
  ])('rejects inconsistent or overstated report %j', (change) => {
    expect(() => summarizeGuestChannelReport(JSON.stringify({ ...report(), ...change }))).toThrow();
  });
  it('refuses a stopped message without independently confirmed empty Job accounting', () => {
    expect(() =>
      summarizeGuestChannelReport(JSON.stringify({ ...report('cancel'), jobEmpty: false })),
    ).toThrow();
  });
  it('does not count an unexpected worker exit as a correct negative control', () => {
    expect(() =>
      summarizeGuestChannelReport(
        JSON.stringify({ ...report('bad-command'), refusalReason: 'frame-input-unavailable' }),
      ),
    ).toThrow();
  });
  it('rejects oversized output before parsing', () => {
    expect(() => summarizeGuestChannelReport(' '.repeat(16385))).toThrow();
  });
});
