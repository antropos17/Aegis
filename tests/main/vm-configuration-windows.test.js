import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'fixed VM configuration: modeled provider records and inbox native parser',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-vm-configuration-'));
      executable = path.join(root, 'configuration.exe');
      execFileSync(
        path.join(
          process.env.WINDIR || 'C:/Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/warnaserror+',
          '/reference:System.Management.dll',
          `/out:${executable}`,
          ...[
            'VmConfigurationObservation',
            'VmConfigurationProfile',
            'VmConfigurationRead',
            'VmConfigurationNative',
            'VmManagementNative',
            'OwnedVmLifecycle',
          ].map((name) => path.join(project, 'sidecar/session', `${name}.cs`)),
          path.join(project, 'tests/fixtures/vm-configuration/VmConfigurationFixture.cs'),
        ],
        { timeout: 30000, windowsHide: true, stdio: 'pipe' },
      );
    }, 35000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    });
    function invoke(mode) {
      const result = spawnSync(executable, [mode], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString().slice(0, 1024)).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it.each(['positive', 'reorder', 'boot-tpm'])(
      'accepts the fixed profile with actual DVD slot 7 and stable digest: %s',
      (mode) => {
        expect(invoke(mode)).toEqual({ accepted: true, same: true });
      },
    );
    it.each(['changed-dvd-slot', 'changed-image', 'changed-controller', 'changed-drive'])(
      'binds exact original attachments so protected expected digest rejects replacement: %s',
      (mode) => {
        expect(invoke(mode)).toEqual({ accepted: true, same: false });
      },
    );
    it.each([
      'gen1',
      'auto-start',
      'auto-stop',
      'auto-checkpoint',
      'checkpoint',
      'secure-boot',
      'snapshot',
      'missing',
      'null',
      'flag-type',
      'enum-type',
      'wrong-vm',
      'foreign-settings',
      'settings-replaced',
      'memory',
      'memory-type',
      'memory-units',
      'dynamic',
      'cpu',
      'cpu-type',
      'duplicate',
      'duplicate-id',
      'duplicate-memory',
      'missing-cpu',
      'quota',
      'nic',
      'legacy-nic',
      'unsupported',
      'physical',
      'disk-slot',
      'controller-slot',
      'controller-range',
      'dvd-type',
      'slot-alias',
      'slot-collision',
      'foreign-parent',
      'foreign-drive',
      'missing-dvd',
      'empty-dvd',
      'multi-host',
      'host-type',
      'relative-host',
      'duplicate-host',
      'stream-host',
      'remote-parent',
      'wrong-namespace',
      'wrong-class',
      'state-before',
      'state-after',
      'identity-after',
      'vm-after',
      'null-fence',
      'orphan-resource',
      'orphan-nic',
    ])('refuses invalid profile before returning an approvable digest: %s', (mode) => {
      expect(invoke(mode)).toEqual({ accepted: false, same: false });
    });
  },
);
