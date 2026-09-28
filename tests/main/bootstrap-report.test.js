import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_MODES,
  BOOTSTRAP_REFUSALS,
  summarizeBootstrapReport,
} from '../../scripts/qualification/bootstrap-report.mjs';
import { encodeVmFrame } from '../../scripts/qualification/vm-wire.mjs';

const frame = encodeVmFrame(Buffer.alloc(32, 1), {
  version: 1,
  sessionId: '1'.repeat(32),
  vmId: '11111111-2222-4333-8444-555555555555',
  epoch: '2'.repeat(32),
  sequence: 1,
  challenge: '6'.repeat(64),
  phase: 'initialized',
  imageSha256: '2'.repeat(64),
  runtimeSha256: '3'.repeat(64),
  principalSha256: '4'.repeat(64),
  jobSha256: '5'.repeat(64),
});

const proof = {
  version: 1,
  scope: 'native-bootstrap-process-fixture',
  mode: 'admit',
  initialized: true,
  heldIdentityConfirmed: true,
  inOwnedJob: true,
  samePrincipal: true,
  jobKillOnClose: true,
  initialJobActiveProcesses: 2,
  processStampSha256: '1'.repeat(64),
  imageSha256: '2'.repeat(64),
  runtimeSha256: '3'.repeat(64),
  principalSha256: '4'.repeat(64),
  jobSha256: '5'.repeat(64),
  payloadReleased: true,
  workCompleted: true,
  childExited: true,
  jobEmpty: true,
  endpointCodecPassed: true,
  frameBase64: frame.toString('base64'),
  refusalReason: null,
};

describe('native bootstrap evidence boundaries', () => {
  it('refuses a release before initialized held-process observation', () => {
    expect(() =>
      summarizeBootstrapReport(JSON.stringify({ ...proof, initialized: false })),
    ).toThrow();
  });

  it.each([
    { heldIdentityConfirmed: false },
    { inOwnedJob: false },
    { samePrincipal: false },
    { jobKillOnClose: false },
    { initialJobActiveProcesses: 0 },
    { initialJobActiveProcesses: 1.5 },
    { workCompleted: false },
    { childExited: false },
    { jobEmpty: false },
    { endpointCodecPassed: false },
    { launchAllowed: true },
    { processStampSha256: null },
    { runtimeSha256: 'arbitrary runtime' },
    { payloadReleased: 'true' },
    { mode: 'arbitrary executable' },
    { frameBase64: null },
    { frameBase64: 'AA==' },
    { frameBase64: frame.toString('base64') + '\n' },
    { version: 2 },
    { refusalReason: 'frame-input-unavailable' },
  ])('rejects missing observation or fabricated fixture state %j', (change) => {
    expect(() => summarizeBootstrapReport(JSON.stringify({ ...proof, ...change }))).toThrow();
  });

  it.each(BOOTSTRAP_MODES)('keeps %s separate from protection authority', (mode) => {
    const accepted = ['admit', 'cancel', 'close-job'].includes(mode);
    const summary = summarizeBootstrapReport(
      JSON.stringify({
        ...proof,
        mode,
        initialized: accepted,
        heldIdentityConfirmed: accepted,
        payloadReleased: mode === 'admit',
        workCompleted: mode === 'admit',
        jobEmpty: mode !== 'close-job',
        frameBase64: accepted ? proof.frameBase64 : null,
        refusalReason: accepted ? null : BOOTSTRAP_REFUSALS[mode],
      }),
    );
    expect(summary).toMatchObject({
      fixedTaskCompleted: mode === 'admit',
      heldChildClosureConfirmed: true,
      ownedJobEmptyConfirmed: mode !== 'close-job',
      samePrincipalFixture: true,
      runtimeSubsetOnly: true,
      endpointCodecOnly: true,
      vmEffectsRun: false,
      launchAllowed: false,
      nativeContainmentQualified: false,
    });
    expect(summary.notRun).toContain('hyper-v-socket-transport');
  });

  it('does not turn a closed Job handle into a Job-empty observation', () => {
    expect(() =>
      summarizeBootstrapReport(
        JSON.stringify({
          ...proof,
          mode: 'close-job',
          payloadReleased: false,
          workCompleted: false,
          jobEmpty: true,
        }),
      ),
    ).toThrow();
  });

  it('rejects an oversized report before JSON parsing', () => {
    expect(() => summarizeBootstrapReport(' '.repeat(16385))).toThrow();
  });

  it('does not count a missing worker as a successful injected refusal', () => {
    expect(() =>
      summarizeBootstrapReport(
        JSON.stringify({
          ...proof,
          mode: 'timeout',
          initialized: false,
          heldIdentityConfirmed: false,
          payloadReleased: false,
          workCompleted: false,
          frameBase64: null,
          refusalReason: 'frame-input-unavailable',
        }),
      ),
    ).toThrow();
  });
});
