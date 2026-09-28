import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import { collectFilesystemQualification } from '../../scripts/qualification/qualify-filesystem.mjs';

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native filesystem access-check qualification',
  () => {
    let receipt;
    beforeAll(() => {
      receipt = collectFilesystemQualification();
    }, 40000);

    it('queries the actual unassigned restricted token and records build provenance', () => {
      expect(receipt.probe).toMatchObject({
        flags: 0,
        restrictorCount: 1,
        restrictorEqualsUser: true,
        isRestricted: true,
      });
      expect(receipt.probe.remainingPrivilegeCount).toBeLessThanOrEqual(1);
      expect(receipt.probe.osBuild).toBe(Number(os.release().split('.')[2]));
      for (const key of ['sourceSha256', 'compilerSha256', 'executableSha256']) {
        expect(receipt[key]).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(JSON.stringify(receipt)).not.toMatch(/S-1-5-21-/);
    });

    it('demonstrates NULL and absent DACL access for all three requested rights', () => {
      const rows = receipt.probe.cases.filter((row) => ['null', 'absent'].includes(row.descriptor));
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.restricted).toEqual({ allowed: true, grantedMask: row.desiredMask });
        expect(row.ordinary).toEqual({ allowed: true, grantedMask: row.desiredMask });
      }
      expect(receipt.summary.strictBoundaryPassed).toBe(false);
    });

    it('distinguishes a useful principal grant, Everyone grant and empty DACL', () => {
      for (const row of receipt.probe.cases.slice(0, 9)) {
        expect(row.ordinary.allowed).toBe(row.descriptor !== 'empty');
        expect(row.restricted.allowed).toBe(row.descriptor === 'principal');
      }
    });

    it('rechecks changed in-memory descriptors without treating that as a file experiment', () => {
      expect(receipt.probe.cases.slice(15).map((row) => row.restricted.allowed)).toEqual([
        false,
        true,
        false,
      ]);
      expect(receipt.summary.decisionCount).toBe(36);
      expect(receipt.summary.notRun).toContain('file-effects');
      expect(receipt.summary.notRun).toContain('virtual-machine');
    });
  },
);
