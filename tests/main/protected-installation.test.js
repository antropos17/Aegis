import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
describe.skipIf(process.platform !== 'win32')(
  'protected installation transactions (no host effects)',
  () => {
    function invoke(mode) {
      const value = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/transaction-fixture.ps1'),
          mode,
        ],
        {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 8192,
        },
      );
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      return JSON.parse(value.stdout.toString('utf8'));
    }
    it('refuses an unrelated service before any stop, file deletion or account removal', () => {
      expect(invoke('uninstall-foreign')).toMatchObject({ refused: true, events: ['validate'] });
    });
    it('restores the held original installation after new publication fails', () => {
      expect(invoke('upgrade-after-publication')).toMatchObject({
        refused: true,
        events: [
          'validate',
          'stage',
          'stop',
          'saveOld',
          'publish',
          'verify',
          'stop',
          'unpublish',
          'restore',
          'restart',
          'remove',
        ],
      });
    });
    it('refuses a running owner before staging, stopping or replacing its revision', () => {
      expect(invoke('upgrade-running')).toMatchObject({
        refused: true,
        failure: 'protected-upgrade-idle-owner-required',
        events: ['validate', 'status'],
      });
    });
    it('rejects an unknown receipt before service stop, file deletion or account removal', () => {
      expect(invoke('uninstall-unknown-receipt')).toMatchObject({
        refused: true,
        failure: 'protected-receipt-unknown-child',
        events: ['validate', 'receipts-recheck'],
      });
    });
    it('removes a published partial installation when service creation was refused', () => {
      expect(invoke('partial-register')).toMatchObject({
        refused: true,
        events: ['validate', 'stage', 'publish', 'register', 'remove'],
      });
    });
    it('keeps unknown rollback terminal and skips restart and further cleanup', () => {
      expect(invoke('upgrade-rollback-unknown')).toMatchObject({
        refused: true,
        failure: 'protected-upgrade-rollback-unknown',
        events: [
          'validate',
          'stage',
          'stop',
          'saveOld',
          'publish',
          'verify',
          'stop',
          'unpublish',
          'restore',
        ],
      });
    });
    it('keeps a failed old-revision deletion terminal without restoring a partial revision', () => {
      expect(invoke('upgrade-commit-unknown')).toMatchObject({
        refused: true,
        failure: 'protected-upgrade-commit-cleanup-unknown',
        events: ['validate', 'stage', 'stop', 'saveOld', 'publish', 'verify', 'commit'],
      });
    });
    function receipt(mode) {
      const value = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/receipt-fixture.ps1'),
          mode,
        ],
        {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 8192,
        },
      );
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      return JSON.parse(value.stdout.toString('utf8'));
    }
    it('requires actual actors, cleanup, source, image and permitted effects for a native receipt', () => {
      expect(receipt('green')).toEqual({ corpus: true, guest: true });
      for (const mode of [
        'red-without-actors',
        'cleanup-unknown',
        'foreign-source',
        'malformed-boolean',
        'foreign-image',
        'missing-allowed-effect',
        'filtered-admin',
        'missing-users-membership',
      ]) {
        expect(receipt(mode)).toEqual({ corpus: false, guest: false });
      }
    }, 30000);
    it('rejects a mismatched Windows 11 observation and broader qualification flags', () => {
      for (const mode of ['guest-os-mismatch', 'guest-overclaim']) {
        expect(receipt(mode)).toEqual({ corpus: true, guest: false });
      }
    });
  },
);
