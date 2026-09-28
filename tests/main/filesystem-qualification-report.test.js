import { describe, expect, it } from 'vitest';
import { summarizeFilesystemReport } from '../../scripts/qualification/filesystem-report.mjs';

function fixture() {
  const cases = [];
  for (const descriptor of ['everyone', 'principal', 'empty', 'null', 'absent']) {
    for (const [operation, desiredMask] of [
      ['read-data', 1],
      ['write-data', 2],
      ['delete', 0x10000],
    ]) {
      const ordinary = descriptor !== 'empty';
      const restricted = ['principal', 'null', 'absent'].includes(descriptor);
      cases.push({
        descriptor,
        operation,
        desiredMask,
        daclKind: ['everyone', 'principal'].includes(descriptor) ? 'allocated' : descriptor,
        ordinary: { allowed: ordinary, grantedMask: ordinary ? desiredMask : 0 },
        restricted: { allowed: restricted, grantedMask: restricted ? desiredMask : 0 },
      });
    }
  }
  for (const descriptor of ['everyone', 'null', 'empty']) {
    const row = structuredClone(cases.find((entry) => entry.descriptor === descriptor));
    row.descriptor = `transition-${descriptor}`;
    cases.push(row);
  }
  return {
    version: 1,
    scope: 'in-memory-access-check',
    osBuild: 26200,
    flags: 0,
    restrictorCount: 1,
    restrictorEqualsUser: true,
    isRestricted: true,
    remainingPrivilegeCount: 1,
    hasTraversalPrivilege: true,
    cases,
  };
}

describe('filesystem qualification receipt boundary', () => {
  it('records reproduced escapes while keeping strict protection unavailable', () => {
    expect(summarizeFilesystemReport(JSON.stringify(fixture()))).toEqual({
      scope: 'restricted-token-api-semantics',
      measurement: 'counterexample-reproduced',
      decisionCount: 36,
      strictBoundaryPassed: false,
      outsideAllowedDescriptors: ['null', 'absent'],
      notRun: [
        'file-effects',
        'separate-account',
        'private-desktop',
        'node-git-task',
        'virtual-machine',
        'network',
      ],
    });
  });

  it.each([
    [
      'unknown launch claim',
      (report) => {
        report.launchAllowed = true;
      },
    ],
    [
      'weak token flags',
      (report) => {
        report.flags = 8;
      },
    ],
    [
      'extra restrictor',
      (report) => {
        report.restrictorCount = 2;
      },
    ],
    [
      'wrong principal',
      (report) => {
        report.restrictorEqualsUser = false;
      },
    ],
    [
      'ordinary token substitution',
      (report) => {
        report.isRestricted = false;
      },
    ],
    [
      'retained extra privilege',
      (report) => {
        report.remainingPrivilegeCount = 2;
      },
    ],
    [
      'inconsistent privilege query',
      (report) => {
        report.hasTraversalPrivilege = false;
      },
    ],
    [
      'unknown OS',
      (report) => {
        report.osBuild = 0;
      },
    ],
    [
      'missing counterexample',
      (report) => {
        report.cases.splice(9, 1);
      },
    ],
    [
      'reordered matrix',
      (report) => {
        report.cases.reverse();
      },
    ],
    [
      'broken positive control',
      (report) => {
        report.cases[3].ordinary.allowed = false;
      },
    ],
    [
      'broken restricted useful control',
      (report) => {
        report.cases[3].restricted.allowed = false;
      },
    ],
    [
      'broken empty-DACL control',
      (report) => {
        report.cases[6].restricted.allowed = true;
      },
    ],
    [
      'unexpected Everyone access',
      (report) => {
        report.cases[0].restricted.allowed = true;
      },
    ],
    [
      'NULL gap hidden as prevention',
      (report) => {
        report.cases[9].restricted.allowed = false;
      },
    ],
    [
      'NULL confused with empty',
      (report) => {
        report.cases[9].daclKind = 'empty';
      },
    ],
    [
      'absent confused with present',
      (report) => {
        report.cases[12].daclKind = 'null';
      },
    ],
    [
      'unexpected granted rights',
      (report) => {
        report.cases[0].ordinary.grantedMask = 0x1f01ff;
      },
    ],
    [
      'stale transition result',
      (report) => {
        report.cases[16].restricted.allowed = false;
      },
    ],
    [
      'unknown authority field on result',
      (report) => {
        report.cases[0].restricted.approved = true;
      },
    ],
  ])('refuses %s', (_label, mutate) => {
    const report = fixture();
    mutate(report);
    expect(() => summarizeFilesystemReport(JSON.stringify(report))).toThrow(
      'filesystem-qualification-invalid',
    );
  });

  it.each(['', '{', 'null', '[]', 'x'.repeat(16385)])(
    'refuses malformed or unbounded input',
    (input) => {
      expect(() => summarizeFilesystemReport(input)).toThrow('filesystem-qualification-invalid');
    },
  );

  it('accepts an actually absent traversal privilege without claiming native file effects', () => {
    const report = fixture();
    report.remainingPrivilegeCount = 0;
    report.hasTraversalPrivilege = false;
    expect(summarizeFilesystemReport(JSON.stringify(report)).notRun).toContain('file-effects');
  });
});
