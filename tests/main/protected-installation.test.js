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
    function orchestration(mode) {
      const value = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-installation/orchestration-fixture.ps1'),
          mode,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 8192 },
      );
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.length).toBe(0);
      expect(value.stdout.toString('utf8')).not.toContain('unsafe');
      expect(value.stdout.toString('utf8')).not.toContain('fixture-credential');
      return JSON.parse(value.stdout.toString('utf8'));
    }
    it('identifies each refused membership boundary and cleans only the exact created account', () => {
      for (const [mode, operation] of [
        ['membership-users-query', 'account-users-query'],
        ['membership-users-add', 'account-users-add'],
        ['membership-account-verify', 'account-verify'],
        ['membership-administrators-query', 'account-administrators-query'],
        ['membership-users-verify', 'account-users-verify'],
      ]) {
        const value = orchestration(mode);
        expect(value).toMatchObject({
          refused: true,
          createdSid: 'S-1-5-21-100-200-300-1001',
          createdRoots: [],
          ancillaryRemoved: true,
          cleanup: {
            state: 'confirmed',
            serviceAbsent: true,
            protectedParentAbsent: true,
            exactAccountSidAbsent: true,
          },
          failure: { operation, diagnosticCode: 'protected-operation-refused', nativeWin32: null },
          service: { creationAttempted: false, created: false },
          membership: { verified: false, removedSidExact: true, exactAccountAbsent: true },
        });
      }
    }, 30000);
    it('projects finite membership exception classes without arbitrary command or parameter text', () => {
      for (const [mode, diagnosticCode] of [
        ['membership-command-missing', 'protected-command-not-found'],
        ['membership-binding', 'protected-parameter-binding-refused'],
        ['membership-win32', 'protected-win32-refused'],
      ]) {
        expect(orchestration(mode)).toMatchObject({
          failure: { operation: 'account-users-query', diagnosticCode, nativeWin32: null },
          cleanup: { state: 'confirmed', exactAccountSidAbsent: true },
          membership: { removedSidExact: true, exactAccountAbsent: true },
        });
      }
    }, 30000);
    it('marks account verification before callback-local helper lookup can fail', () => {
      expect(orchestration('membership-helper-lookup')).toMatchObject({
        refused: true,
        helperCommandMissing: true,
        memberAdditionComplete: true,
        addedReferenceExact: true,
        removedSidExact: true,
        exactAccountAbsent: true,
        createdRoots: [],
        service: { creationAttempted: false, created: false },
        cleanup: { state: 'confirmed', exactAccountSidAbsent: true },
        failure: {
          operation: 'account-verify',
          diagnosticCode: 'protected-command-not-found',
          nativeWin32: null,
        },
      });
    });
    it('verifies existing Users membership and adds only the exact returned account when needed', () => {
      for (const [mode, addCalls] of [
        ['membership-existing', 0],
        ['membership-add', 1],
      ]) {
        expect(orchestration(mode)).toMatchObject({
          failure: { operation: 'parent-create' },
          createdRoots: [],
          service: { creationAttempted: false, created: false },
          cleanup: { state: 'confirmed', exactAccountSidAbsent: true },
          membership: {
            verified: true,
            addCalls,
            addedReferenceExact: addCalls === 1,
            removedSidExact: true,
            exactAccountAbsent: true,
          },
        });
      }
    }, 30000);
    it('journals exact held resources and confirmed cleanup through nested maintained orchestration', () => {
      expect(orchestration('clean-partial')).toMatchObject({
        refused: true,
        stageRemoved: true,
        ancillaryRemoved: true,
        createdSid: 'S-1-5-21-100-200-300-1001',
        cleanup: {
          state: 'confirmed',
          serviceAbsent: true,
          protectedParentAbsent: true,
          exactAccountSidAbsent: true,
        },
        failure: {
          operation: 'publish',
          diagnosticCode: 'protected-qualified-partial-fault',
          nativeWin32: null,
        },
      });
    });
    it('keeps unknown partial cleanup terminal with the original failure and owned resource identities', () => {
      expect(orchestration('unknown-partial')).toMatchObject({
        refused: true,
        stageRemoved: false,
        ancillaryRemoved: false,
        createdSid: 'S-1-5-21-100-200-300-1001',
        cleanup: { state: 'unknown', exactAccountSidAbsent: null },
        failure: { operation: 'publish', diagnosticCode: 'protected-qualified-partial-fault' },
      });
    });
    it('distinguishes a clean refusal before effects and preserves captured numeric native diagnostics', () => {
      expect(orchestration('clean-refusal')).toMatchObject({
        refused: true,
        createdSid: null,
        cleanup: { state: 'confirmed-no-effects' },
        failure: {
          operation: 'account-create',
          diagnosticCode: 'protected-operation-refused',
          nativeWin32: null,
        },
      });
      expect(orchestration('native-refusal')).toMatchObject({
        refused: true,
        stageRemoved: true,
        ancillaryRemoved: true,
        failure: {
          operation: 'service-create',
          diagnosticCode: 'protected-service-create-refused',
          nativeWin32: 5,
        },
      });
    });
    it('retains the exact original objects across two upgrades and a publication rollback', () => {
      expect(orchestration('upgrade-reference')).toMatchObject({
        firstExact: true,
        secondExact: true,
        rollbackRefused: true,
        rollbackExact: true,
        cleanupUnknown: false,
        stageType: 'Hashtable',
        path: 'C:\\ProgramData\\AEGIS\\ProtectedSession',
      });
    });
    it('refuses extra stage output without adopting or cleaning an ambiguous association', () => {
      expect(orchestration('noisy-stage')).toMatchObject({
        refused: true,
        stageRemoved: false,
        ancillaryRemoved: false,
        cleanup: { state: 'unknown' },
      });
    });
    it('keeps an ambiguous upgrade stage terminal and refuses reuse before stopping or deleting', () => {
      for (const mode of ['noisy-upgrade', 'null-upgrade']) {
        expect(orchestration(mode)).toEqual({
          firstRefused: true,
          retryRefused: true,
          cleanupUnknown: true,
          originalExact: true,
          stageCount: 2,
          stopCalls: 0,
          events: [],
        });
      }
    });
    it('exposes failed installation cleanup through the maintained qualification wrapper with no successful association', () => {
      const clean = orchestration('phase-clean');
      expect(clean).toMatchObject({
        passed: false,
        launchAllowed: false,
        completeE1: false,
        completeE11: false,
        interactiveUiQualified: false,
        baseline: null,
        positive: null,
        mutation: null,
        upgrade: null,
        partial: null,
        cleanupFailure: null,
        failure: { stage: 'baseline-install', operation: 'service-create', nativeWin32: 5 },
        installation: { createdSid: 'S-1-5-21-100-200-300-1001', cleanup: { state: 'confirmed' } },
      });
      const unknown = orchestration('phase-unknown');
      expect(unknown).toMatchObject({
        passed: false,
        failure: { stage: 'baseline-install', operation: 'service-create', nativeWin32: 5 },
        installation: { cleanup: { state: 'unknown', exactAccountSidAbsent: null } },
        cleanupFailure: {
          stage: 'partial-install-cleanup',
          diagnosticCode: 'protected-installation-cleanup-unknown',
        },
      });
      expect(unknown.installation.createdRoots).toHaveLength(3);
      expect(unknown.fixtureEvents).not.toContain('remove-stage');
      expect(unknown.fixtureEvents).not.toContain('remove-ancillary');
      expect(JSON.stringify(unknown)).not.toContain('association');
      expect(JSON.stringify(unknown)).not.toContain('credential');
    });
  },
);
