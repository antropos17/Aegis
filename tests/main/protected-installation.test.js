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
    it('projects finite uninstall checkpoints and stops at the first failing callback', () => {
      const script = `
        . './scripts/installation/protected-install-transaction.ps1'
        $rows = @()
        $names = @('validate', 'stop', 'unregister', 'remove', 'account')
        foreach ($failed in $names) {
          $events = [Collections.Generic.List[string]]::new()
          $ops = @{}
          foreach ($name in $names) {
            $selectedName = $name; $selectedFailure = $failed; $selectedEvents = $events
            $ops[$name] = {
              param($first, $second)
              $selectedEvents.Add($selectedName)
              if ($selectedName -ceq $selectedFailure) {
                $error = [InvalidOperationException]::new('private-path-password-command')
                if ($selectedName -ceq 'unregister') {
                  $error.Data['protectedOperation'] = 'service-delete'
                  $error.Data['protectedNativeWin32'] = [int]5
                }
                throw $error
              }
            }.GetNewClosure()
          }
          try { Invoke-ProtectedUninstallTransaction $ops @{ service = @{}; stage = @{} } }
          catch { $rows += @{ events = @($events.ToArray()); failure = Get-ProtectedInstallFailure $_ 'qualification' } }
        }
        foreach ($checkpoint in @('administrator', 'absence-confirm', 'private-path-password-command')) {
          try { Invoke-ProtectedUninstallCheckpoint $checkpoint { throw 'private-path-password-command' } }
          catch { $rows += @{ failure = Get-ProtectedInstallFailure $_ 'qualification' } }
        }
        foreach ($code in @('protected-control-unknown-child', 'protected-receipt-unknown-child')) {
          try { Invoke-ProtectedUninstallCheckpoint 'validate' { throw $code } }
          catch { $rows += @{ failure = Get-ProtectedInstallFailure $_ 'qualification' } }
        }
        $rows | ConvertTo-Json -Depth 8 -Compress
      `;
      const value = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          cwd: project,
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 8192,
        },
      );
      expect(value.error).toBeUndefined();
      expect(value.status).toBe(0);
      expect(value.stderr.toString()).toBe('');
      expect(value.stdout.toString()).not.toContain('private-path-password-command');
      const rows = JSON.parse(value.stdout.toString('utf8'));
      const callbacks = ['validate', 'stop', 'unregister', 'remove', 'account'];
      const checkpoints = ['validate', 'stop', 'unregister', 'stage-removal', 'ancillary-account'];
      checkpoints.forEach((checkpoint, index) => {
        expect(rows[index].events).toEqual(callbacks.slice(0, index + 1));
        expect(rows[index].failure).toMatchObject({
          uninstallCheckpoint: checkpoint,
          diagnosticCode: 'protected-operation-refused',
          operation: index === 2 ? 'service-delete' : 'qualification',
          nativeWin32: index === 2 ? 5 : null,
        });
      });
      expect(rows[5].failure.uninstallCheckpoint).toBe('administrator');
      expect(rows[6].failure.uninstallCheckpoint).toBe('absence-confirm');
      expect(rows[7].failure).not.toHaveProperty('uninstallCheckpoint');
      expect(rows[7].failure.diagnosticCode).toBe('protected-operation-refused');
      expect(rows[8].failure).toMatchObject({
        uninstallCheckpoint: 'validate',
        diagnosticCode: 'protected-control-unknown-child',
      });
      expect(rows[9].failure).toMatchObject({
        uninstallCheckpoint: 'validate',
        diagnosticCode: 'protected-receipt-unknown-child',
      });
    });
    it('projects only bounded integer storage checkpoints without private exception text', () => {
      const script = `
        . './scripts/installation/protected-install-transaction.ps1'
        $rows=@()
        foreach($code in @(-1,0,21,22,23,24,25,'22',$true,[uint32]22)){
          $checkpointFailure=[InvalidOperationException]::new('private-path-password-command')
          $checkpointFailure.Data['protectedStorageCheckpoint']=$code
          try{throw $checkpointFailure}catch{$failure=Get-ProtectedInstallFailure $_ 'input'}
          $rows += @{included=$failure.ContainsKey('storageCheckpoint');value=$failure['storageCheckpoint']}
        }
        ConvertTo-Json -InputObject $rows -Compress
      `;
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          cwd: project,
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 4096,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      expect(result.stdout.toString()).not.toContain('private-path-password-command');
      const rows = JSON.parse(result.stdout.toString('utf8'));
      expect(rows.map((row) => row.included)).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
      ]);
      expect(rows.filter((row) => row.included).map((row) => row.value)).toEqual([
        0, 21, 22, 23, 24,
      ]);
    });
    it('refuses an unrelated service before any stop, file deletion or account removal', () => {
      expect(invoke('uninstall-foreign')).toMatchObject({ refused: true, events: ['validate'] });
    });
    it('refuses foreign SID, administrator membership and missing Users membership', () => {
      expect(invoke('account-foreign-sid')).toEqual({
        refused: true,
        failure: 'protected-owned-account-association-refused',
        events: ['account-query'],
      });
      expect(invoke('account-administrator')).toEqual({
        refused: true,
        failure: 'protected-operator-administrator-refused',
        events: ['account-query', 'S-1-5-32-544'],
      });
      expect(invoke('account-not-user')).toEqual({
        refused: true,
        failure: 'protected-operator-users-membership-required',
        events: ['account-query', 'S-1-5-32-544', 'S-1-5-32-545'],
      });
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
    it('resolves maintained callback helpers from a hosted child script through install, upgrades and uninstall', () => {
      expect(orchestration('host-script-scope')).toMatchObject({
        installed: true,
        accountVerified: true,
        memberAdditionComplete: true,
        addedReferenceExact: true,
        removedSidExact: true,
        originalExact: true,
        firstUpgradeExact: true,
        secondUpgradeExact: true,
        rollbackExact: true,
        uninstalled: true,
        failure: null,
      });
    });
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
    it('resolves callback-local account verification before a later parent-creation refusal', () => {
      expect(orchestration('membership-helper-lookup')).toMatchObject({
        refused: true,
        helperCommandMissing: false,
        memberAdditionComplete: true,
        addedReferenceExact: true,
        removedSidExact: true,
        exactAccountAbsent: true,
        createdRoots: [],
        service: { creationAttempted: false, created: false },
        cleanup: { state: 'confirmed', exactAccountSidAbsent: true },
        failure: {
          operation: 'parent-create',
          diagnosticCode: 'protected-operation-refused',
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
    it('keeps post-effect handoff uncertainty terminal before compensation and later reuse', () => {
      expect(orchestration('upgrade-handoff-unknown')).toEqual({
        firstFailure: 'protected-upgrade-handoff-cleanup-unknown',
        retryGuarded: true,
        uninstallGuarded: true,
        cleanupUnknown: true,
        originalExact: true,
        postEffectPathRecorded: true,
        stageCount: 2,
        stopCalls: 1,
        eventsAfterFailure: ['publish'],
        eventsAfterReuse: ['publish'],
        stageRemoved: false,
        ancillaryRemoved: false,
      });
    });
  },
);
