import { exactKeys, HEX64, requireVm } from './vm-contract.mjs';

/** Fixed trusted-process cases, never a command or VM selector. */
export const BOOTSTRAP_MODES = Object.freeze([
  'admit',
  'cancel',
  'close-job',
  'bad-mac',
  'cross-epoch',
  'oversized',
  'replay',
  'observer-loss',
  'timeout',
]);

/** Fixed fault observations; an unrelated startup/read failure is unavailable. */
export const BOOTSTRAP_REFUSALS = Object.freeze({
  'bad-mac': 'frame-authentication',
  'cross-epoch': 'frame-authentication',
  oversized: 'frame-size',
  replay: 'frame-consumed',
  'observer-loss': 'observer-unavailable',
  timeout: 'frame-timeout',
});

const hashes = [
  'processStampSha256',
  'imageSha256',
  'runtimeSha256',
  'principalSha256',
  'jobSha256',
];
const booleans = [
  'initialized',
  'heldIdentityConfirmed',
  'inOwnedJob',
  'samePrincipal',
  'jobKillOnClose',
  'payloadReleased',
  'workCompleted',
  'childExited',
  'jobEmpty',
  'endpointCodecPassed',
];

/**
 * Validate a fixed fixture report's schema and state consistency. Authentication
 * is separately checked by the native collector; a report is never authority.
 * @param {string} text Bounded native JSON output.
 * @returns {Readonly<object>} Limited, explicitly non-authorizing summary.
 * @since v0.17.0
 */
export function summarizeBootstrapReport(text) {
  requireVm(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  const report = JSON.parse(text);
  exactKeys(report, [
    'version',
    'scope',
    'mode',
    ...booleans,
    ...hashes,
    'initialJobActiveProcesses',
    'frameBase64',
    'refusalReason',
  ]);
  requireVm(report.version === 1 && report.scope === 'native-bootstrap-process-fixture');
  requireVm(BOOTSTRAP_MODES.includes(report.mode));
  requireVm(
    Number.isInteger(report.initialJobActiveProcesses) &&
      report.initialJobActiveProcesses > 0 &&
      report.initialJobActiveProcesses <= 1024,
  );
  for (const name of booleans) requireVm(typeof report[name] === 'boolean');
  for (const name of hashes)
    requireVm(typeof report[name] === 'string' && HEX64.test(report[name]));
  for (const name of [
    'inOwnedJob',
    'samePrincipal',
    'jobKillOnClose',
    'childExited',
    'endpointCodecPassed',
  ])
    requireVm(report[name]);
  const accepted = ['admit', 'cancel', 'close-job'].includes(report.mode);
  requireVm(report.refusalReason === (accepted ? null : BOOTSTRAP_REFUSALS[report.mode]));
  requireVm(report.initialized === accepted && report.heldIdentityConfirmed === accepted);
  requireVm(report.payloadReleased === (report.mode === 'admit'));
  requireVm(report.workCompleted === report.payloadReleased);
  requireVm(report.jobEmpty === (report.mode !== 'close-job'));
  if (accepted) {
    requireVm(typeof report.frameBase64 === 'string' && report.frameBase64.length <= 5468);
    const frame = Buffer.from(report.frameBase64, 'base64');
    requireVm(frame.toString('base64') === report.frameBase64 && frame.length >= 5);
    const size = frame.readUInt32LE(0);
    requireVm(size > 0 && size <= 4096 && frame.length === size + 4);
  } else requireVm(report.frameBase64 === null);
  return Object.freeze({
    scope: report.scope,
    mode: report.mode,
    initializedObservationPassed: accepted,
    fixedTaskCompleted: report.workCompleted,
    expectedRefusalObserved: !accepted,
    heldChildClosureConfirmed: true,
    ownedJobEmptyConfirmed: report.jobEmpty,
    samePrincipalFixture: true,
    runtimeSubsetOnly: true,
    completeJobMemberInventory: false,
    vmBindingSynthetic: true,
    endpointCodecOnly: true,
    vmEffectsRun: false,
    launchAllowed: false,
    nativeContainmentQualified: false,
    notRun: [
      'vm-lifecycle',
      'hyper-v-socket-transport',
      'separate-guest-principal',
      'complete-runtime-observation',
      'complete-job-member-inventory',
      'helper-crash-recovery',
      'filesystem-and-network-boundary',
      'credentials-and-export',
    ],
  });
}
