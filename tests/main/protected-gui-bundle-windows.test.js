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
