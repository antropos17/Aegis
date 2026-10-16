import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeSource = process.env.AEGIS_MAIN_NATIVE_SOURCE || project;
let root, rootIdentity, executable;

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'installed inspection completion (native admission; synthetic installed authority)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-installed-completion-'));
      rootIdentity = fs.lstatSync(root);
      executable = path.join(root, 'completion-fixture.exe');
      const sources = ['session', 'owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(nativeSource, 'sidecar', directory))
          .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
          .sort()
          .map((name) => path.join(nativeSource, 'sidecar', directory, name)),
      );
      sources.push(
        path.join(nativeSource, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        path.join(project, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
        path.join(project, 'tests/fixtures/session-main-admission/MainFixtureTransport.cs'),
        ...fs
          .readdirSync(path.join(project, 'tests/fixtures/session-installed-completion'))
          .filter((name) => name.endsWith('.cs'))
          .sort()
          .map((name) => path.join(project, 'tests/fixtures/session-installed-completion', name)),
      );
      try {
        execFileSync(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          ),
          [
            '/nologo',
            '/target:exe',
            '/platform:x64',
            '/main:InstalledCompletionFixture',
            '/define:ENROLLMENT_LEASE_TEST,CALLER_MAIN_OPERATION_TEST',
            '/reference:System.Management.dll',
            '/reference:System.Security.dll',
            '/optimize+',
            '/warnaserror+',
            '/out:' + executable,
            ...sources,
          ],
          { timeout: 30000, maxBuffer: 32768, windowsHide: true },
        );
      } catch (error) {
        throw new Error(String(error.stdout) + String(error.stderr), { cause: error });
      }
    }, 35000);

    afterAll(() => {
      // Suite-owned disposable processes are stopped before invocation returns.
      // Retain no fixture binaries; bounded runner receipts remain outside here.
      if (root) {
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
        const realParent = fs.realpathSync(os.tmpdir());
        const actual = fs.lstatSync(root);
        const realRoot = fs.realpathSync(root);
        const localTree = (directory) =>
          fs.readdirSync(directory, { withFileTypes: true }).every((entry) => {
            const target = path.join(directory, entry.name);
            const stat = fs.lstatSync(target);
            return !stat.isSymbolicLink() && (!stat.isDirectory() || localTree(target));
          });
        if (
          /^aegis-installed-completion-[^\\/]+$/.test(relative) &&
          !actual.isSymbolicLink() &&
          actual.dev === rootIdentity.dev &&
          actual.ino === rootIdentity.ino &&
          path.dirname(realRoot).toLowerCase() === realParent.toLowerCase() &&
          realRoot.toLowerCase() === path.resolve(root).toLowerCase() &&
          localTree(root)
        )
          fs.rmSync(root, { recursive: true, force: true });
      }
    });

    function invoke(mode) {
      const directory = fs.mkdtempSync(path.join(root, mode + '-'));
      const result = spawnSync(executable, [mode, directory], {
        timeout: 14000,
        maxBuffer: 16384,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(result.stderr.length).toBe(0);
      const observed = JSON.parse(result.stdout.toString());
      if (mode === 'completion-deadline') {
        expect(observed.deadlineRetryAgeMilliseconds).toBeGreaterThanOrEqual(550);
        expect(observed.deadlineRetryAgeMilliseconds).toBeLessThan(1800);
      }
      expect(observed).toMatchObject({
        admitted: true,
        mainJobEmpty: true,
        borrowedUsable: true,
        recordsUnchanged: true,
        protectedDescriptorsModeled: true,
        installedAuthorityModeled: true,
      });
      expect(
        fs.readFileSync(path.join(directory, 'control/supervisor-job-empty.txt'), 'utf8'),
      ).toBe('true');
      const effects = Number(
        fs.readFileSync(path.join(directory, 'control/effect-counter.txt'), 'utf8'),
      );
      expect(effects).toBe(observed.effects);
      const inspection = path.join(directory, 'control/inspection.json');
      expect(fs.existsSync(inspection)).toBe(effects === 1);
      return {
        ...observed,
        inspection: fs.existsSync(inspection)
          ? JSON.parse(fs.readFileSync(inspection, 'utf8'))
          : null,
      };
    }

    it('publishes only the original owner selection through a genuine accepted native context', () => {
      expect(invoke('positive')).toMatchObject({
        completed: true,
        refused: false,
        effects: 1,
        inspection: {
          scope: 'retained-inventory-inspection',
          selectionId: 'c'.repeat(32),
          revision: 1,
          epoch: 'd'.repeat(32),
          inventoryObserved: true,
          ownershipQualified: false,
          launchAllowed: false,
        },
      });
    });

    it.each(['policy-selection', 'policy-epoch', 'policy-revision'])(
      'refuses an independently admitted inventory tuple mismatching the installed %s',
      (mode) => {
        expect(invoke(mode)).toMatchObject({
          refused: true,
          retryRefused: true,
          completed: false,
          effects: 0,
        });
      },
    );

    it('terminally refuses an expired first deadline and a fresh-deadline retry', () => {
      expect(invoke('initial-deadline')).toMatchObject({
        refused: true,
        retryRefused: true,
        completed: false,
        effects: 0,
      });
    });

    it('retains the consumed completion after two seconds within the original owner deadline', () => {
      expect(invoke('retained')).toMatchObject({
        completed: true,
        retained: true,
        refused: false,
        effects: 1,
      });
    }, 10000);

    it('refuses installed issuance after ordinary inspection has consumed the request', () => {
      expect(invoke('ordinary-first')).toMatchObject({
        completed: false,
        refused: true,
        retryRefused: true,
        effects: 0,
      });
    });

    it.each([
      'duplicate-issue',
      'duplicate-inspection',
      'completion-deadline',
      'peer-closed',
      'main-exit',
      'owner-loss',
      'foreign-owner',
      'owner-disposed',
      'operation-disposed',
    ])('terminally invalidates the retained completion after %s without publication', (mode) => {
      expect(invoke(mode)).toMatchObject({
        completed: true,
        refused: true,
        retryRefused: true,
        effects: 0,
      });
    });
  },
);
