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
        {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: mode === 'upgrade-retention-matrix' ? 32768 : 8192,
        },
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
    it('stages the optional original GUI bundle through the real stage serializer without changing inspection bytes', () => {
      expect(orchestration('gui-stage-hook')).toEqual({
        guiStaged: true,
        candidateWritten: true,
        originalInventoryPreserved: true,
        originalFixedFixturePreserved: true,
        genericDirectorySnapshots: 0,
        headlessRows: 11,
        guiRows: 12,
      });
    });
    it('rejects malformed optional GUI inputs before capture or account creation', () => {
      expect(orchestration('gui-invalid-options')).toEqual({
        refused: 9,
        noEffects: true,
        captures: 0,
        roots: 0,
      });
    });
    it('preserves the original GUI principal and clones retained bundles through actual upgrade and rollback callbacks', () => {
      const value = orchestration('gui-lifecycle');
      expect(value).toMatchObject({
        installed: true,
        originalExact: true,
        firstUpgradeExact: true,
        secondUpgradeExact: true,
        rollbackExact: true,
        uninstalled: true,
        failure: null,
        unknownPreserved: true,
        captures: 1,
        sourceCloses: 1,
        principalCloses: 1,
        allBundlesClosed: true,
        removed: [0, 1, 3, 2],
      });
      expect(value.events.indexOf('source-close')).toBeLessThan(value.events.indexOf('stage-1'));
      expect(value.events.indexOf('stage-1')).toBeLessThan(value.events.indexOf('remove-0'));
      expect(value.events.indexOf('stage-2')).toBeLessThan(value.events.indexOf('remove-1'));
      expect(value.events.indexOf('remove-2')).toBeLessThan(
        value.events.indexOf('principal-close'),
      );
      expect(value.events.filter((event) => event === 'capture')).toHaveLength(1);
    });
    it('retires only the original staged GUI on a confirmed install rollback and then releases its captures', () => {
      const value = orchestration('gui-clean-failure');
      expect(value).toMatchObject({
        refused: true,
        cleanup: 'confirmed',
        sourceCloses: 1,
        principalCloses: 1,
        bundleRemoved: true,
        bundleDisposed: true,
        originalRetained: false,
      });
      expect(value.events.indexOf('remove-0')).toBeLessThan(
        value.events.indexOf('principal-close'),
      );
      expect(value.events.indexOf('principal-close')).toBeLessThan(
        value.events.indexOf('source-close'),
      );
    });
    it('retains original staged GUI ownership and principal when service creation cleanup is unknown', () => {
      expect(orchestration('gui-unknown-failure')).toMatchObject({
        refused: true,
        cleanup: 'unknown',
        sourceCloses: 1,
        principalCloses: 0,
        bundleRemoved: false,
        bundleDisposed: false,
        originalRetained: true,
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
        failedStageExact: true,
        failedRootExact: true,
        failedGuiBundleExact: true,
        stageCount: 2,
        stopCalls: 1,
        eventsAfterFailure: ['publish'],
        eventsAfterReuse: ['publish'],
        stageRemoved: false,
        ancillaryRemoved: false,
      });
    });
    it('retains only the exact issued upgrade stage across transaction failure and ownership-transfer boundaries', () => {
      const value = orchestration('upgrade-retention-matrix');
      expect(value).toMatchObject({ modeledCallbackResources: true, nativeEffects: 0 });
      expect(value.rows).toHaveLength(19);
      const rows = new Map(value.rows.map((row) => [row.case, row]));
      expect(rows.size).toBe(19);
      for (const name of ['preexisting', 'construction-throw', 'callback-slot-conflict']) {
        expect(rows.get(name)).toMatchObject({
          refused: true,
          returnedExact: false,
          slotEmpty: false,
          partialExact: true,
          issuedExact: false,
          beforeStopExact: false,
          oldStillCurrent: true,
          removedExact: false,
          events: name === 'preexisting' ? [] : ['validate', 'stage'],
        });
      }
      for (const name of ['null-output', 'noisy-output', 'multiple-output']) {
        expect(rows.get(name)).toMatchObject({
          refused: true,
          returnedExact: false,
          slotEmpty: true,
          issuedExact: false,
          partialExact: false,
          beforeStopExact: false,
          oldStillCurrent: true,
          removedExact: false,
          events: ['validate', 'stage'],
        });
      }
      const forward = ['validate', 'stage', 'stop', 'saveOld', 'publish', 'verify', 'commit'];
      const compensated = [
        ...forward.slice(0, -1),
        'stop',
        'unpublish',
        'restore',
        'restart',
        'remove',
      ];
      expect(rows.get('commit-success')).toMatchObject({
        refused: false,
        returnedExact: true,
        slotEmpty: true,
        issuedCurrent: true,
        beforeStopExact: true,
        removedExact: false,
        events: forward,
      });
      expect(rows.get('compensation-success')).toMatchObject({
        refused: true,
        returnedExact: false,
        slotEmpty: true,
        oldStillCurrent: true,
        beforeStopExact: true,
        removedExact: true,
        events: compensated,
      });
      expect(rows.get('commit-no-transfer')).toMatchObject({
        refused: true,
        returnedExact: false,
        issuedExact: true,
        issuedRootExact: true,
        issuedBundleExact: true,
        oldStillCurrent: true,
        beforeStopExact: true,
        events: forward,
      });
      expect(rows.get('remove-slot-replaced')).toMatchObject({
        refused: true,
        returnedExact: false,
        slotEmpty: false,
        partialExact: true,
        issuedExact: false,
        removedExact: true,
        beforeStopExact: true,
        events: compensated,
      });
      for (const step of ['stop', 'saveOld', 'publish', 'verify', 'commit']) {
        expect(rows.get('unknown-' + step)).toMatchObject({
          refused: true,
          returnedExact: false,
          slotEmpty: false,
          issuedExact: true,
          issuedRootExact: true,
          issuedBundleExact: true,
          beforeStopExact: true,
          removedExact: false,
          issuedCurrent: step === 'commit',
          events: forward.slice(0, forward.indexOf(step) + 1),
        });
      }
      for (const step of ['unpublish', 'restore', 'restart', 'remove']) {
        expect(rows.get('rollback-' + step)).toMatchObject({
          refused: true,
          returnedExact: false,
          slotEmpty: false,
          issuedExact: true,
          issuedRootExact: true,
          issuedBundleExact: true,
          beforeStopExact: true,
          removedExact: false,
          oldStillCurrent: true,
          events: compensated.slice(0, compensated.indexOf(step) + 1),
        });
      }
    });
  },
);
