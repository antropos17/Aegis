import { exactKeys, HEX64, requireVm } from './vm-contract.mjs';

export const GUEST_CHANNEL_MODES = Object.freeze([
  'admit',
  'cancel',
  'bad-command',
  'cross-epoch-command',
  'wrong-direction-command',
  'replay-command',
  'bad-result',
  'oversized-result',
  'timeout',
]);
export const GUEST_CHANNEL_REFUSALS = Object.freeze({
  'bad-command': 'channel-authentication',
  'cross-epoch-command': 'channel-context',
  'wrong-direction-command': 'channel-context',
  'replay-command': 'channel-sequence',
  'bad-result': 'channel-authentication',
  'oversized-result': 'frame-size',
  timeout: 'frame-timeout',
});
const booleans = [
  'initialized',
  'taskObserved',
  'resultAccepted',
  'stopMessageAccepted',
  'childExited',
  'jobEmpty',
];
const hashes = [
  'processStampSha256',
  'imageSha256',
  'runtimeSha256',
  'principalSha256',
  'jobSha256',
  'nodeSha256',
  'gitSha256',
];
const frames = ['initializedFrameBase64', 'resultFrameBase64', 'stoppedFrameBase64'];

function boundedFrame(value) {
  requireVm(typeof value === 'string' && value.length <= 5468);
  const frame = Buffer.from(value, 'base64');
  requireVm(frame.length >= 5 && frame.length <= 4100 && frame.toString('base64') === value);
  requireVm(
    frame.readUInt32LE(0) > 0 &&
      frame.readUInt32LE(0) <= 4096 &&
      frame.readUInt32LE(0) + 4 === frame.length,
  );
}

/**
 * Validate completed fixed-case observations. Frame authentication and local
 * file-effect oracles are checked separately by the collector, never this schema.
 * @param {string} text Bounded supervisor report.
 * @returns {Readonly<object>} Explicitly limited non-authorizing result.
 * @since v0.17.0
 */
export function summarizeGuestChannelReport(text) {
  requireVm(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  const report = JSON.parse(text);
  exactKeys(report, [
    'version',
    'scope',
    'mode',
    'initialJobActiveProcesses',
    ...booleans,
    ...hashes,
    ...frames,
    'refusalReason',
  ]);
  requireVm(report.version === 1 && report.scope === 'guest-channel-process-fixture');
  requireVm(GUEST_CHANNEL_MODES.includes(report.mode));
  requireVm(
    Number.isInteger(report.initialJobActiveProcesses) &&
      report.initialJobActiveProcesses > 0 &&
      report.initialJobActiveProcesses <= 1024,
  );
  for (const field of hashes)
    requireVm(typeof report[field] === 'string' && HEX64.test(report[field]));
  for (const field of booleans) requireVm(typeof report[field] === 'boolean');
  for (const field of ['initialized', 'childExited', 'jobEmpty']) requireVm(report[field]);
  requireVm(
    report.taskObserved === ['admit', 'bad-result', 'oversized-result'].includes(report.mode),
  );
  requireVm(report.resultAccepted === (report.mode === 'admit'));
  requireVm(report.stopMessageAccepted === ['admit', 'cancel'].includes(report.mode));
  requireVm(report.refusalReason === (GUEST_CHANNEL_REFUSALS[report.mode] || null));
  boundedFrame(report.initializedFrameBase64);
  for (const field of ['resultFrameBase64', 'stoppedFrameBase64']) {
    const accepted =
      field === 'resultFrameBase64' ? report.resultAccepted : report.stopMessageAccepted;
    if (accepted) boundedFrame(report[field]);
    else requireVm(report[field] === null);
  }
  return Object.freeze({
    scope: report.scope,
    mode: report.mode,
    fixedTaskFilesObserved: report.taskObserved,
    resultFrameAccepted: report.resultAccepted,
    stopMessageAccepted: report.stopMessageAccepted,
    heldChildClosureConfirmed: true,
    ownedJobEmptyConfirmed: true,
    samePrincipalFixture: true,
    runtimeSubsetOnly: true,
    completeJobMemberInventory: false,
    vmBindingSynthetic: true,
    transport: 'anonymous-pipe',
    vmEffectsRun: false,
    guestNodeGitQualified: false,
    launchAllowed: false,
    nativeContainmentQualified: false,
  });
}
