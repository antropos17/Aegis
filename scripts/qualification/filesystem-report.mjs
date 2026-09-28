/** Diagnostic report validation. No result from this module authorizes a launch. */
const descriptors = ['everyone', 'principal', 'empty', 'null', 'absent'];
const operations = [
  ['read-data', 1],
  ['write-data', 2],
  ['delete', 0x10000],
];
const expectedRows = descriptors
  .flatMap((descriptor) =>
    operations.map(([operation, desiredMask]) => ({ descriptor, operation, desiredMask })),
  )
  .concat(
    ['everyone', 'null', 'empty'].map((descriptor) => ({
      descriptor: `transition-${descriptor}`,
      operation: 'read-data',
      desiredMask: 1,
    })),
  );

function requireValue(value) {
  if (!value) throw new Error('filesystem-qualification-invalid');
}

function keys(value, expected) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype);
  const names = Object.keys(value);
  requireValue(
    names.length === expected.length && expected.every((key) => Object.hasOwn(value, key)),
  );
}

/**
 * Validate paired native AccessCheck controls, retaining the known boundary gap.
 * @param {string} text Bounded output from the fixed diagnostic probe.
 * @returns {Readonly<object>} Research measurement; strictBoundaryPassed is always false.
 * @since v0.17.0
 */
export function summarizeFilesystemReport(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error('filesystem-qualification-invalid');
  }
  keys(report, [
    'version',
    'scope',
    'osBuild',
    'flags',
    'restrictorCount',
    'restrictorEqualsUser',
    'isRestricted',
    'remainingPrivilegeCount',
    'hasTraversalPrivilege',
    'cases',
  ]);
  requireValue(report.version === 1 && report.scope === 'in-memory-access-check');
  requireValue(Number.isSafeInteger(report.osBuild) && report.osBuild > 0);
  requireValue(
    report.flags === 0 &&
      report.restrictorCount === 1 &&
      report.restrictorEqualsUser === true &&
      report.isRestricted === true,
  );
  requireValue(
    [0, 1].includes(report.remainingPrivilegeCount) &&
      report.hasTraversalPrivilege === (report.remainingPrivilegeCount === 1),
  );
  requireValue(Array.isArray(report.cases) && report.cases.length === expectedRows.length);
  for (const [index, row] of report.cases.entries()) {
    keys(row, ['descriptor', 'operation', 'desiredMask', 'daclKind', 'ordinary', 'restricted']);
    const expected = expectedRows[index];
    for (const key of ['descriptor', 'operation', 'desiredMask'])
      requireValue(row[key] === expected[key]);
    const descriptor = row.descriptor.replace(/^transition-/, '');
    requireValue(
      row.daclKind === (['everyone', 'principal'].includes(descriptor) ? 'allocated' : descriptor),
    );
    for (const name of ['ordinary', 'restricted']) {
      keys(row[name], ['allowed', 'grantedMask']);
      const allowed =
        name === 'ordinary'
          ? descriptor !== 'empty'
          : ['principal', 'null', 'absent'].includes(descriptor);
      requireValue(
        row[name].allowed === allowed && row[name].grantedMask === (allowed ? row.desiredMask : 0),
      );
    }
  }
  return Object.freeze({
    scope: 'restricted-token-api-semantics',
    measurement: 'counterexample-reproduced',
    decisionCount: expectedRows.length * 2,
    strictBoundaryPassed: false,
    outsideAllowedDescriptors: Object.freeze(['null', 'absent']),
    notRun: Object.freeze([
      'file-effects',
      'separate-account',
      'private-desktop',
      'node-git-task',
      'virtual-machine',
      'network',
    ]),
  });
}
