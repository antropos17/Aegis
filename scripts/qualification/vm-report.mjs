import { exactKeys, HEX64, requireVm } from './vm-contract.mjs';

/**
 * Validate a subset observation; omitted devices/services/image content stay unknown.
 * @param {string} text Bounded output of the fixed read-only WMI probe.
 * @param {boolean} selected Whether an exact VM selector was supplied.
 * @returns {Readonly<object>} Non-authorizing diagnostic summary.
 * @since v0.17.0
 */
export function summarizeVmReport(text, selected = false) {
  requireVm(typeof text === 'string' && Buffer.byteLength(text) <= 4096);
  const value = JSON.parse(text);
  exactKeys(value, [
    'version',
    'scope',
    'osBuild',
    'hypervisorPresent',
    'managerStatus',
    'vmStatus',
    'details',
  ]);
  requireVm(value.version === 1 && value.scope === 'read-only-hyper-v-subset');
  requireVm(Number.isSafeInteger(value.osBuild) && value.osBuild > 0);
  requireVm([true, false, null].includes(value.hypervisorPresent));
  requireVm(['available', 'denied', 'unavailable'].includes(value.managerStatus));
  requireVm(
    (selected ? ['missing', 'observed', 'denied', 'unavailable'] : ['not-selected']).includes(
      value.vmStatus,
    ),
  );
  if (value.vmStatus === 'observed') {
    exactKeys(value.details, [
      'state',
      'generation',
      'secureBoot',
      'syntheticNicCount',
      'configSubsetSha256',
    ]);
    requireVm(['off', 'running', 'other'].includes(value.details.state));
    requireVm(
      [1, 2].includes(value.details.generation) && typeof value.details.secureBoot === 'boolean',
    );
    requireVm(
      Number.isInteger(value.details.syntheticNicCount) &&
        value.details.syntheticNicCount >= 0 &&
        value.details.syntheticNicCount <= 256,
    );
    requireVm(
      typeof value.details.configSubsetSha256 === 'string' &&
        HEX64.test(value.details.configSubsetSha256),
    );
  } else requireVm(value.details === null);
  return Object.freeze({
    scope: value.scope,
    osBuild: value.osBuild,
    hypervisorPresent: value.hypervisorPresent,
    managerStatus: value.managerStatus,
    vmStatus: value.vmStatus,
    launchAllowed: false,
    nativeContainmentQualified: false,
    notRun: [
      'vm-mutation',
      'guest-bootstrap',
      'full-device-inventory',
      'foreign-host-services',
      'image-admission',
      'file-effects',
    ],
  });
}
