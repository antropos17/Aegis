import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import { collectVmInspection } from '../../scripts/qualification/qualify-vm-inspection.mjs';
import { summarizeVmReport } from '../../scripts/qualification/vm-report.mjs';

describe('non-authorizing VM observation validation', () => {
  const base = {
    version: 1,
    scope: 'read-only-hyper-v-subset',
    osBuild: 26200,
    hypervisorPresent: true,
    managerStatus: 'available',
    vmStatus: 'not-selected',
    details: null,
  };
  it('keeps denied and unavailable distinct and always retains missing qualification', () => {
    for (const managerStatus of ['available', 'denied', 'unavailable']) {
      expect(summarizeVmReport(JSON.stringify({ ...base, managerStatus }))).toMatchObject({
        managerStatus,
        launchAllowed: false,
        nativeContainmentQualified: false,
      });
    }
  });
  it.each([
    { launchAllowed: true },
    { vmStatus: 'observed' },
    { osBuild: 0 },
    { managerStatus: 'prevented' },
    { details: {} },
  ])('rejects fabricated or missing observations %j', (change) => {
    expect(() => summarizeVmReport(JSON.stringify({ ...base, ...change }))).toThrow();
  });
});

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native read-only Hyper-V subset',
  () => {
    let host, selected;
    beforeAll(() => {
      host = collectVmInspection();
      selected = collectVmInspection('00000000-0000-0000-0000-000000000000');
    }, 80000);
    it('queries the actual host with bounded provenance and no VM selector', () => {
      expect(host.probe.osBuild).toBe(Number(os.release().split('.')[2]));
      expect(host.probe.vmStatus).toBe('not-selected');
      expect(['available', 'denied', 'unavailable']).toContain(host.probe.managerStatus);
      for (const name of ['sourceSha256', 'compilerSha256', 'executableSha256'])
        expect(host[name]).toMatch(/^[a-f0-9]{64}$/);
      expect(host.summary.nativeContainmentQualified).toBe(false);
      expect(JSON.stringify(host)).not.toMatch(/S-1-5-21-|\\Users\\|ElementName/);
    });
    it('queries only an exact nonexistent identifier without treating failure as prevention', () => {
      expect(['missing', 'denied', 'unavailable']).toContain(selected.probe.vmStatus);
      expect(selected.probe.details).toBe(null);
      expect(selected.summary.notRun).toContain('vm-mutation');
      expect(selected.summary.launchAllowed).toBe(false);
    });
    it('refuses query injection before compilation', () => {
      expect(() => collectVmInspection("' OR Name LIKE '%' ")).toThrow(
        'vm-inspection-selector-invalid',
      );
    });
  },
);
