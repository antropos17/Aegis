import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUI_EXECUTABLE,
  produceGuiManifest,
} from '../../scripts/produce-protected-gui-manifest.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root,
  executable,
  production,
  sequence = 0;
const environment = () => ({ ...process.env, TEMP: root, TMP: root });
function run(file, args) {
  return JSON.parse(
    execFileSync(file, args, {
      timeout: 15000,
      maxBuffer: 65536,
      windowsHide: true,
      env: environment(),
    }).toString(),
  );
}
function candidate() {
  const work = path.join(root, `case-${sequence++}`),
    source = path.join(work, 'candidate'),
    manifest = path.join(work, 'manifest.json');
  fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(source, GUI_EXECUTABLE), 'dummy-executable');
  fs.writeFileSync(path.join(source, 'resources/app.asar'), 'dummy-asar');
  fs.writeFileSync(manifest, produceGuiManifest(source));
  return { work, source, manifest };
}
function capture(value) {
  return run(executable, [value.source, value.manifest]);
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'protected GUI candidate intake',
  () => {
    beforeAll(() => {
      const parent = path.join(project, 'out/development');
      fs.mkdirSync(parent, { recursive: true });
      root = fs.mkdtempSync(path.join(parent, 'b12-fixture-'));
      executable = path.join(root, 'fixture.exe');
      production = path.join(root, 'production.exe');
      const sources = [
        'ProtectedInstallFiles.cs',
        'ProtectedGuiManifest.cs',
        'ProtectedGuiBundleNative.cs',
        'ProtectedGuiBundleFiles.cs',
        'ProtectedGuiIdentity.cs',
      ].map((name) => path.join(project, 'scripts/installation', name));
      sources.push(path.join(project, 'tests/fixtures/protected-gui/BundleFixture.cs'));
      for (const [output, define] of [
        [executable, true],
        [production, false],
      ]) {
        try {
          execFileSync(
            path.join(
              process.env.WINDIR || 'C:/Windows',
              'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
            ),
            [
              '/nologo',
              '/warnaserror+',
              '/platform:x64',
              `/out:${output}`,
              ...(define ? ['/define:PROTECTED_GUI_TEST'] : []),
              ...sources,
            ],
            { timeout: 30000, maxBuffer: 65536, windowsHide: true, env: environment() },
          );
        } catch (failure) {
          throw new Error(
            `GUI fixture compilation failed:\n${failure.stdout?.toString() || ''}\n${failure.stderr?.toString() || ''}`,
            { cause: failure },
          );
        }
      }
    }, 65000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(fs.realpathSync(root))).toBe(
        fs.realpathSync(path.join(project, 'out/development')),
      );
      expect(path.basename(root)).toMatch(/^b12-fixture-/);
      const check = (directory) => {
        for (const name of fs.readdirSync(directory)) {
          const item = path.join(directory, name),
            stat = fs.lstatSync(item);
          expect(stat.isSymbolicLink()).toBe(false);
          if (stat.isDirectory()) check(item);
        }
      };
      check(root);
      fs.rmSync(root, { recursive: true });
    });
    it('compiles the production path without modeled authority factories', () => {
      expect(run(production, ['production'])).toEqual({ passed: true, testFactories: false });
    });
    it.each(['empty', 'by-id'])('probes ancestor rename with retained original mode %s', (mode) => {
      const work = path.join(root, `rename-probe-${mode}`);
      fs.mkdirSync(work);
      expect(run(executable, ['rename-probe', work, mode])).toEqual({
        passed: true,
        continuousOriginal: true,
      });
    });
    it('captures a complete candidate with the actual producer and native retained handles', () => {
      const value = candidate();
      expect(capture(value)).toEqual({ refused: false });
      expect(produceGuiManifest(value.source)).toEqual(fs.readFileSync(value.manifest));
    });
    it('refuses an unlisted bundle member after the actual manifest producer captured the candidate', () => {
      const value = candidate();
      fs.writeFileSync(path.join(value.source, 'unlisted.dll'), 'unlisted');
      expect(capture(value)).toEqual({ refused: true });
    });
    it.each(['missing', 'changed', 'resized'])('refuses %s original payloads', (mode) => {
      const value = candidate(),
        file = path.join(value.source, 'resources/app.asar');
      if (mode === 'missing') fs.unlinkSync(file);
      else fs.writeFileSync(file, mode === 'changed' ? 'dummy-XXXX' : 'larger changed payload');
      expect(capture(value)).toEqual({ refused: true });
    });
    it.each([
      'unknown',
      'duplicate',
      'bom',
      'trailing',
      'path',
      'oversize',
      'case',
      'missing-parent',
    ])('refuses closed manifest violation %s', (mode) => {
      const value = candidate();
      let bytes = fs.readFileSync(value.manifest).toString();
      const object = JSON.parse(bytes);
      if (mode === 'unknown')
        bytes = bytes.replace('"schemaVersion":1', '"schemaVersion":1,"unknown":false');
      if (mode === 'duplicate')
        bytes = bytes.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
      if (mode === 'bom') bytes = '\uFEFF' + bytes;
      if (mode === 'trailing') bytes += '\n';
      if (mode === 'path') {
        object.files[0].path = '../escape.exe';
        bytes = JSON.stringify(object);
      }
      if (mode === 'oversize') {
        object.files[0].bytes = 536870913;
        bytes = JSON.stringify(object);
      }
      if (mode === 'case') {
        object.files.push({ ...object.files[0], path: object.files[0].path.toUpperCase() });
        bytes = JSON.stringify(object);
      }
      if (mode === 'missing-parent') {
        object.directories = [];
        bytes = JSON.stringify(object);
      }
      fs.writeFileSync(value.manifest, bytes);
      expect(capture(value)).toEqual({ refused: true });
    });
    it('refuses a real hardlink alias without deleting either original', () => {
      const value = candidate(),
        original = path.join(value.source, GUI_EXECUTABLE),
        alias = path.join(value.work, 'alias.exe');
      fs.linkSync(original, alias);
      expect(capture(value)).toEqual({ refused: true });
      expect(fs.readFileSync(alias, 'utf8')).toBe('dummy-executable');
    });
    it('refuses a named data stream on an otherwise listed original', () => {
      const value = candidate(),
        stream = path.join(value.source, GUI_EXECUTABLE) + ':hidden';
      try {
        fs.writeFileSync(stream, 'canary');
        expect(capture(value)).toEqual({ refused: true });
      } finally {
        if (fs.existsSync(stream)) fs.unlinkSync(stream);
      }
    });
    it('refuses a junction and preserves its external canary', () => {
      const value = candidate(),
        target = path.join(value.work, 'external'),
        link = path.join(value.source, 'junction');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'canary'), 'untouched');
      fs.symlinkSync(target, link, 'junction');
      try {
        expect(capture(value)).toEqual({ refused: true });
        expect(fs.readFileSync(path.join(target, 'canary'), 'utf8')).toBe('untouched');
      } finally {
        fs.unlinkSync(link);
      }
    });
    it.each([
      'stage',
      'rename',
      'partial',
      'clone',
      'foreign',
      'wrong-parent',
      'wrong-principal',
      'stopped-principal',
      'rename-replace',
      'rename-missing',
      'rename-extra',
      'rename-hash',
      'rename-acl',
      'rename-principal',
      'rename-dispose',
      'delete-link-replace',
      'delete-link-readonly',
    ])('uses original creation handles for %s lifecycle (modeled protection only)', (mode) => {
      const value = candidate(),
        work = path.join(value.work, 'stage-parent');
      fs.mkdirSync(work);
      expect(run(executable, [value.source, value.manifest, mode, work])).toEqual({
        passed: true,
        nativeFiles: true,
        modeledProtection: true,
        guiLaunched: false,
      });
    });
    it('checks principal pair roles and stable token identity separately from privilege modification', () => {
      expect(run(executable, ['identity'])).toEqual({ passed: true, modeledPrincipal: true });
    });
    function diagnostic(mode, malformed = false) {
      const value = candidate();
      const work = path.join(value.work, 'diagnostic-stage');
      fs.mkdirSync(work);
      if (malformed) fs.writeFileSync(value.manifest, '{');
      return {
        value,
        observed: run(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'System32/WindowsPowerShell/v1.0/powershell.exe',
          ),
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            path.join(project, 'tests/fixtures/protected-gui/stage.ps1'),
            '-Project',
            project,
            '-Assembly',
            executable,
            '-Source',
            value.source,
            '-Manifest',
            value.manifest,
            '-Scratch',
            work,
            '-Mode',
            mode,
          ],
        ),
      };
    }
    it('projects only finite GUI identities and same-node Int32 metadata from synthetic diagnostic records', () => {
      const { observed } = diagnostic('diagnostic-projection-matrix');
      expect(observed).toMatchObject({
        syntheticProjection: true,
        nativeWin32Observed: false,
        firstFailureExact: true,
      });
      expect(observed.rows).toHaveLength(27);
      const rows = new Map(observed.rows.map((row) => [row.name, row]));
      expect(rows.size).toBe(27);
      const codes = [
        'protected-gui-input-refused',
        'protected-gui-binding-refused',
        'protected-gui-manifest-refused',
        'protected-gui-bundle-refused',
        'protected-gui-principal-refused',
        'protected-gui-cleanup-unknown',
      ];
      codes.forEach((code, index) => {
        expect(rows.get('code-' + index)).toMatchObject({
          operation: 'publish',
          diagnosticCode: code,
          nativeWin32: null,
        });
      });
      const operations = [
        'protected-gui-metadata-changed',
        'protected-gui-open-original-id',
        'protected-gui-delete-original',
      ];
      operations.forEach((operation, index) => {
        expect(rows.get('op-' + index)).toMatchObject({
          operation,
          diagnosticCode: 'protected-gui-bundle-refused',
          nativeWin32: [0, 17, 2147483647][index],
        });
      });
      for (let index = 0; index < 4; index++) {
        expect(rows.get('unknown-code-' + index)).toMatchObject({
          operation: 'publish',
          diagnosticCode: 'protected-operation-refused',
          nativeWin32: null,
        });
        expect(rows.get('unknown-op-' + index)).toMatchObject({
          operation: 'publish',
          diagnosticCode: 'protected-gui-bundle-refused',
          nativeWin32: null,
        });
      }
      for (const name of ['native-int64', 'native-string', 'native-negative']) {
        expect(rows.get(name)).toMatchObject({
          operation: 'protected-gui-open-original-id',
          diagnosticCode: 'protected-gui-bundle-refused',
          nativeWin32: null,
        });
      }
      for (const [name, operation, nativeWin32] of [
        ['pair-inner-number-ignored', 'protected-gui-open-original-id', 17],
        ['pair-outer-number-not-borrowed', 'protected-gui-metadata-changed', null],
        ['pair-deeper-known-replaces', 'protected-gui-delete-original', 23],
        ['pair-deeper-known-clears', 'protected-gui-metadata-changed', null],
        ['pair-deeper-unknown-ignored', 'protected-gui-open-original-id', 17],
      ]) {
        expect(rows.get(name)).toMatchObject({
          operation,
          nativeWin32,
          diagnosticCode: 'protected-gui-bundle-refused',
        });
      }
      expect(rows.get('depth-7')).toMatchObject({
        operation: 'protected-gui-open-original-id',
        nativeWin32: 17,
        diagnosticCode: 'protected-gui-manifest-refused',
      });
      expect(rows.get('depth-8')).toMatchObject({
        operation: 'publish',
        nativeWin32: null,
        diagnosticCode: 'protected-operation-refused',
      });
      expect(observed.receiptKeys).toEqual([
        'cleanup',
        'createdRoots',
        'createdSid',
        'failure',
        'operation',
        'published',
        'schemaVersion',
        'service',
      ]);
      expect(observed.failureKeys).toEqual([
        'diagnosticCode',
        'hResult',
        'nativeWin32',
        'operation',
      ]);
      expect(observed.privacyReceipt.failure).toMatchObject({
        operation: 'publish',
        nativeWin32: null,
        diagnosticCode: 'protected-gui-principal-refused',
      });
      expect(JSON.stringify(observed)).not.toContain('PRIVATE_GUI_CANARY_20261016');
    });
    it('preserves the actual malformed GUI manifest helper code without projecting private invocation details', () => {
      const { observed, value } = diagnostic('diagnostic-malformed-manifest', true);
      expect(observed).toMatchObject({
        actualManifestHelper: true,
        sourceDiagnosticCode: 'protected-gui-manifest-refused',
        cleanupUnknown: false,
        receipt: {
          failure: {
            operation: 'input',
            diagnosticCode: 'protected-gui-manifest-refused',
            nativeWin32: null,
          },
        },
      });
      expect(Object.keys(observed.receipt.failure).sort()).toEqual([
        'diagnosticCode',
        'hResult',
        'nativeWin32',
        'operation',
      ]);
      expect(JSON.stringify(observed.receipt)).not.toContain(value.source);
      expect(JSON.stringify(observed.receipt)).not.toContain(value.manifest);
      expect(fs.readFileSync(path.join(value.source, GUI_EXECUTABLE), 'utf8')).toBe(
        'dummy-executable',
      );
      expect(fs.readFileSync(path.join(value.source, 'resources/app.asar'), 'utf8')).toBe(
        'dummy-asar',
      );
    });
    it('preserves the actual GUI metadata helper failure through the administrative failure receipt', () => {
      const value = candidate();
      const work = path.join(value.work, 'diagnostic-stage');
      fs.mkdirSync(work);
      const observed = run(
        path.join(
          process.env.WINDIR || 'C:/Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-gui/stage.ps1'),
          '-Project',
          project,
          '-Assembly',
          executable,
          '-Source',
          value.source,
          '-Manifest',
          value.manifest,
          '-Scratch',
          work,
          '-Mode',
          'diagnostic-rename-missing',
        ],
      );
      expect(observed).toMatchObject({
        helperFailureObserved: true,
        sourceOperation: 'protected-gui-metadata-changed',
        sourceDiagnosticCode: 'protected-gui-bundle-refused',
        nativeCodeCaptured: false,
        capturedNativeWin32: null,
        cleanupUnknown: true,
        modeledPrincipalAndProtection: true,
      });
      expect(observed.finiteChain).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'invalid-data',
            operation: 'protected-gui-metadata-changed',
            code: 'protected-gui-bundle-refused',
            nativeCodeType: 'absent',
          }),
        ]),
      );
      expect(observed.finiteChain.length).toBeLessThanOrEqual(8);
      expect(observed.projectedOperation).toBe(observed.sourceOperation);
      expect(observed.projectedDiagnosticCode).toBe(observed.sourceDiagnosticCode);
      expect(observed.projectedNativeWin32).toBeNull();
    });
    it.each(['normal', 'failed-record-cleanup'])(
      'runs actual shared GUI stage hooks with %s ownership',
      (mode) => {
        const value = candidate(),
          work = path.join(value.work, 'ps-stage');
        fs.mkdirSync(work);
        const result = run(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'System32/WindowsPowerShell/v1.0/powershell.exe',
          ),
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(project, 'tests/fixtures/protected-gui/stage.ps1'),
            '-Project',
            project,
            '-Assembly',
            executable,
            '-Source',
            value.source,
            '-Manifest',
            value.manifest,
            '-Scratch',
            work,
            '-Mode',
            mode,
          ],
        );
        expect(result).toEqual(
          mode === 'normal'
            ? {
                passed: true,
                serializer: true,
                nativeFiles: true,
                modeledPrincipalAndProtection: true,
                guiEnrollment: false,
              }
            : { passed: true, retainedUnknownOwner: true, foreignPreserved: true },
        );
      },
    );
  },
);
