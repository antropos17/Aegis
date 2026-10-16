import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileProcessLibrary, processCoreSources, runProcessStage } from '../fixtures/protected-gui-process/harness.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const product = 'AEGIS - AI Monitoring & Threat Detection.exe';
let root, fixture, production;
const attemptedProfiles = [];
const attemptedStages = [];
const environment = () => ({ ...process.env, TEMP: root, TMP: root });

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'original owned GUI process (real native process; modeled principal)',
  () => {
    beforeAll(() => {
      const parent = path.join(project, 'out/development');
      fs.mkdirSync(parent, { recursive: true });
      root = fs.mkdtempSync(path.join(parent, 'gui-process-'));
      fixture = path.join(root, 'fixture.exe');
      production = path.join(root, 'production.exe');
      const sources = [
        path.join(project, 'scripts/installation/ProtectedGuiProcessNative.cs'),
        path.join(project, 'tests/fixtures/protected-gui-process/ProcessFixture.cs'),
      ];
      for (const [output, modeled] of [[fixture, true], [production, false]]) {
        try {
          execFileSync(
            path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
            ['/nologo', '/target:winexe', '/platform:x64', '/warnaserror+', `/out:${output}`,
              ...(modeled ? ['/define:PROTECTED_GUI_PROCESS_TEST'] : []),
              ...(modeled ? sources : [...processCoreSources(project), sources[1]])],
            { timeout: 30000, maxBuffer: 32768, windowsHide: true, env: environment() },
          );
        } catch (failure) {
          throw new Error(`GUI process fixture compilation failed:\n${failure.stdout?.toString() || ''}\n${failure.stderr?.toString() || ''}`, { cause: failure });
        }
      }
    }, 65000);

    afterAll(() => {
      if (!root) return;
      expect(path.dirname(fs.realpathSync(root))).toBe(fs.realpathSync(path.join(project, 'out/development')));
      expect(path.basename(root)).toMatch(/^gui-process-/);
      // A failed or timed-out native owner is evidence to preserve. Never
      // recursively collect a tree while original child closure is unconfirmed.
      for (const profile of attemptedProfiles) {
        expect(fs.existsSync(path.join(profile, 'cleanup.confirmed')), 'original closure remains unconfirmed; preserve fixture').toBe(true);
        expect(fs.readFileSync(path.join(profile, 'cleanup.confirmed'), 'utf8'))
          .toBe('original-root-exited-and-job-empty');
      }
      let retainUncertainEvidence = false;
      for (const { scratch, mode } of attemptedStages) {
        if (mode === 'shell-object-id') {
          expect(fs.readFileSync(path.join(scratch, 'uncertainty.retained'), 'utf8'))
            .toBe('post-stop-metadata-change;original-job-already-empty');
          retainUncertainEvidence = true;
          continue;
        }
        if (mode === 'closure-observation-unknown' || mode === 'execution-substitution') {
          expect(fs.readFileSync(path.join(scratch, 'uncertainty.retained'), 'utf8'))
            .toBe(mode === 'execution-substitution'
              ? 'modeled-namespace-substitution-before-link-open;no-native-process-created'
              : 'modeled-acknowledgment-loss-after-actual-root-exit-and-job-empty');
          retainUncertainEvidence = true;
        } else {
          expect(fs.readFileSync(path.join(scratch, 'cleanup.confirmed'), 'utf8'))
            .toBe(mode === 'profile-existing'
              ? 'profile-attempt-refused-before-native-creation'
              : 'original-root-exited-and-job-empty');
        }
      }
      // One bounded disposable evidence tree is intentionally retained for the
      // modeled unknown case. It must not become a normal cleanup acknowledgment.
      if (retainUncertainEvidence) return;
      const check = (directory) => {
        for (const leaf of fs.readdirSync(directory)) {
          const absolute = path.join(directory, leaf), stat = fs.lstatSync(absolute);
          expect(stat.isSymbolicLink()).toBe(false);
          if (stat.isDirectory()) check(absolute);
        }
      };
      check(root);
      fs.rmSync(root, { recursive: true });
    });

    function run(file, args) {
      const result = spawnSync(file, args, {
        timeout: 12000, maxBuffer: 8192, windowsHide: true, env: environment(),
      });
      expect(result.error, 'bounded fixture execution').toBeUndefined();
      expect(result.stderr.toString(), 'finite fixture checkpoint').toBe('');
      expect(result.status, 'fixture exit').toBe(0);
      return JSON.parse(result.stdout.toString());
    }

    function scenario(mode) {
      const work = path.join(root, mode);
      const profile = path.join(work, 'profile');
      fs.mkdirSync(profile, { recursive: true });
      const image = path.join(work, product);
      fs.copyFileSync(fixture, image);
      fs.copyFileSync(fixture, path.join(work, 'fixture-grandchild.exe'));
      attemptedProfiles.push(profile);
      return run(fixture, [mode, image, profile]);
    }

    it('compiles all nine production installation sources without test factories or callback fields', () => {
      expect(run(production, ['production'])).toEqual({ nineSourceAssembly: true, testFactoryPresent: false });
    });

    it('does not inherit poisoned loader environment into the real suspended then released child', () => {
      const observation = scenario('environment');
      // The real child has reported after release and the exact root/Job are
      // already settled before testing this independent missing property.
      expect(observation).toMatchObject({
        actualNativeProcess: true,
        modeledPrincipal: true,
        suspendedNoEffect: true,
        rootExitedAndJobEmpty: true,
        child: { fixedArguments: true },
      });
      expect(observation.child.poisonPresent).toBe(false);
      expect(observation.child.nodeOptionsPresent).toBe(false);
      expect(observation.child.processId).toBe(observation.originalProcessId);
    }, 15000);

    it('settles the original suspended root without ever allowing its child effect', () => {
      expect(scenario('cancel')).toMatchObject({
        suspendedNoEffect: true, cancelNoEffect: true, rootExitedAndJobEmpty: true, child: null,
      });
    }, 15000);

    it('closes the actual owned child and grandchild Job after both have signaled readiness', () => {
      expect(scenario('descendant')).toMatchObject({
        suspendedNoEffect: true, runningCount: 2, rootExitedAndJobEmpty: true,
      });
    }, 15000);

    it('observes that original root exit leaves an actual descendant and still settles the whole Job', () => {
      expect(scenario('root-exit')).toMatchObject({
        rootExitedWithDescendant: true, runningCount: 1, rootExitState: 'root-exited', rootExitedAndJobEmpty: true,
      });
    }, 15000);

    it('keeps an actual inheritable parent event out of the launched child', () => {
      expect(scenario('handle')).toMatchObject({
        originalCanaryUnsignaled: true, rootExitedAndJobEmpty: true,
        child: { handleProbeAttempted: true },
      });
    }, 15000);

    it('refuses a second release while preserving the correctly released original child', () => {
      expect(scenario('double-release')).toMatchObject({
        duplicateReleaseRefused: true, runningCount: 1, rootExitedAndJobEmpty: true,
      });
    }, 15000);

    describe('actual installer association and typed native process composition', () => {
      let library;
      beforeAll(() => { library = compileProcessLibrary(project, root); }, 35000);

      function stage(mode) {
        const { scratch, result } = runProcessStage(project, root, fixture, library, mode);
        attemptedStages.push({ scratch, mode });
        expect(result.error, 'bounded stage fixture execution').toBeUndefined();
        expect(result.stderr.toString(), 'stage fixture diagnostic').toBe('');
        expect(result.status, 'stage fixture exit').toBe(0);
        return JSON.parse(result.stdout.toString());
      }

      it('keeps Query and Stop valid after the shell requests the executable object ID', () => {
        expect(stage('shell-object-id')).toMatchObject({ passed: true, rootExitedAndJobEmpty: true,
          originalIdsAndCandidateBytesPreserved: true, sameEpochRetryRefused: true,
          laterMetadataChangeRefused: true, launchAllowed: false });
      }, 30000);

      it.each(['lifecycle', 'administrative-unknown', 'expiry', 'profile-replacement'])(
        'refuses actual package deletion while the owned root is alive and restores exact originals in %s mode',
        (mode) => {
          const observation = stage(mode);
          expect(observation).toMatchObject({
            passed: true, actualStageAndNativeProcess: true,
            modeledPrincipalProtectionAccountServiceVmAndJournal: true,
            writeRefused: true, deleteRefused: true,
            payloadBytesPreservedWhileRootAlive: true,
            activeUpgradeRefused: true, activeUninstallRefused: true,
            noFollowupEffects: true, originalReferencesRetained: true,
            originalIdsAndCandidateBytesPreserved: true,
            busyChecksRefusedWithoutPoisoningRestoration: true,
            rootExitedAndJobEmpty: true, persistedProfilePreserved: true,
            sameEpochRetryRefused: true, guiEnrollment: false, launchAllowed: false,
          });
          expect(observation.administrativeUnknownRetained).toBe(mode === 'administrative-unknown');
          expect(observation.modeledExpiryCallbackDispatch).toBe(mode === 'expiry');
          expect(observation.actualProfileReplacementRefused).toBe(mode === 'profile-replacement');
        },
        30000,
      );

      it('refuses a real preexisting profile attempt directory without adopting its foreign canary', () => {
        expect(stage('profile-existing')).toEqual({
          passed: true, actualAtomicProfileRefusal: true, foreignProfilePreserved: true,
          noChildReleased: true, originalPackageRestored: true,
          modeledPrincipalProtectionAccountServiceVmAndJournal: true,
          guiEnrollment: false, launchAllowed: false,
        });
      }, 30000);

      it('reports exited from the actual retained lease after synchronized natural root exit until explicit Stop', () => {
        const observation = stage('natural-exit');
        expect(observation).toMatchObject({
          passed: true, actualStageAndNativeProcess: true,
          originalReferencesRetained: true, rootExitedAndJobEmpty: true,
          persistedProfilePreserved: true, sameEpochRetryRefused: true,
          noFollowupEffects: true, modeledPrincipalProtectionAccountServiceVmAndJournal: true,
        });
        expect(observation.preStopState).toBe('exited');
      }, 30000);

      it('retains exact original ownership after modeled closure acknowledgment loss following actual Job settlement', () => {
        expect(stage('closure-observation-unknown')).toEqual({
          passed: true, actualStageAndNativeProcess: true, actualRootExitedAndJobEmpty: true,
          modeledClosureAcknowledgmentLoss: true, stickyUnknown: true,
          exactOriginalReferencesRetained: true, repeatStopRefused: true,
          uninstallGuarded: true, noFollowupEffects: true,
          modeledPrincipalProtectionAccountServiceVmAndJournal: true,
          guiEnrollment: false, launchAllowed: false,
        });
      }, 30000);

      it('refuses actual namespace substitution before execution-link open and preserves both original and replacement', () => {
        expect(stage('execution-substitution')).toEqual({
          passed: true, actualNamespaceSubstitution: true, originalAndReplacementIdsAndBytesPreserved: true,
          noNativeProcessCreated: true, stickyUnknown: true, exactOriginalReferencesRetained: true,
          repeatStopRefused: true, uninstallGuarded: true, noFollowupEffects: true,
          modeledPrincipalProtectionAccountServiceVmAndJournal: true, guiEnrollment: false, launchAllowed: false,
        });
      }, 30000);
    });
  },
);
