import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable, production, registration;
function invoke(mode, args = [], file = executable) {
  return JSON.parse(
    execFileSync(file, [mode, ...args], {
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    }).toString(),
  );
}
function provision(directory, record) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(project, 'tests/fixtures/protected-journal/registration.ps1'),
      '-Project',
      project,
      '-Output',
      record,
      '-Directory',
      directory,
    ],
    { timeout: 30000, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
  );
}
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native live journal backend (no mutation or restart authority)',
  () => {
    beforeAll(() => {
      const parent = path.join(project, 'out/development');
      fs.mkdirSync(parent, { recursive: true });
      root = fs.mkdtempSync(path.join(parent, 'journal-fixture-'));
      executable = path.join(root, 'fixture.exe');
      production = path.join(root, 'production.exe');
      registration = path.join(root, 'registered-journal.json');
      const sources = ['session', 'owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, 'sidecar', directory))
          .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
          .map((name) => path.join(project, 'sidecar', directory, name)),
      );
      for (const [output, defines] of [
        [
          executable,
          ['/define:PROTECTED_JOURNAL_TEST;PROTECTED_OPERATION_TEST;CALLER_MAIN_OPERATION_TEST'],
        ],
        [production, []],
      ]) {
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
              '/main:ProtectedJournalFixture',
              '/warnaserror+',
              '/reference:System.Management.dll',
              '/reference:System.Security.dll',
              ...defines,
              `/out:${output}`,
              ...sources,
              path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
              path.join(project, 'tests/fixtures/protected-journal/ProtectedJournalFixture.cs'),
            ],
            { timeout: 30000, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
          );
        } catch (error) {
          throw new Error(
            `Native journal compilation failed: ${error.stdout?.toString().slice(0, 4096) || error.stderr?.toString().slice(0, 4096) || error.message}`,
            { cause: error },
          );
        }
      }
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'tests/fixtures/protected-journal/registration.ps1'),
          '-Project',
          project,
          '-Output',
          registration,
        ],
        { timeout: 30000, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
      );
    }, 65000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(fs.realpathSync(root))).toBe(
        fs.realpathSync(path.join(project, 'out/development')),
      );
      expect(path.basename(root)).toMatch(/^journal-fixture-/);
      function checkDirectory(directory) {
        for (const leaf of fs.readdirSync(directory)) {
          const target = path.join(directory, leaf);
          const stat = fs.lstatSync(target);
          expect(stat.isSymbolicLink()).toBe(false);
          if (stat.isDirectory()) checkDirectory(target);
          else expect(stat.isFile()).toBe(true);
        }
      }
      checkDirectory(root);
      fs.rmSync(root, { recursive: true });
    });
    it('accepts actual PowerShell installer-produced registration bytes in the production parser', () => {
      const observed = invoke('parse', [registration]);
      expect(observed).toEqual({ accepted: true });
    });
    it('compiles without test seams or mutation/transport admission', () => {
      expect(invoke('production', [], production)).toEqual({ production: true, effects: 0 });
    });
    it.each([
      'unknown',
      'directory-id',
      'volume',
      'leaf',
      'revision',
      'trailing',
      'utf8',
      'oversized',
    ])('refuses a noncanonical or invalid installer registration: %s', (mode) => {
      let bytes = fs.readFileSync(registration);
      const value = JSON.parse(bytes);
      if (mode === 'unknown') value.approved = true;
      if (mode === 'directory-id') value.directoryFileId = '0'.repeat(32);
      if (mode === 'volume') value.fileVolumeSerial = '9'.repeat(16);
      if (mode === 'leaf') value.journalLeaf = '../other.jsonl';
      if (mode === 'revision') value.revision = 4294967296;
      bytes = Buffer.from(JSON.stringify(value));
      if (mode === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('\n')]);
      if (mode === 'utf8') bytes[0] = 255;
      if (mode === 'oversized') bytes = Buffer.alloc(2049, 32);
      const input = path.join(root, `invalid-${mode}.json`);
      fs.writeFileSync(input, bytes);
      expect(invoke('parse', [input])).toEqual({ accepted: false });
    });
    it.each([
      'positive',
      'chunks',
      'exclusive',
      'zero',
      'write',
      'after-write',
      'flush',
      'readback',
      'owner-loss',
      'prefix',
      'reentry',
      'dispose',
      'reopen',
      'ack',
      'nonempty',
      'wrong-file',
      'two-stage',
      'protection',
      'foreign-directory',
      'foreign-file',
      'foreign-security',
      'bad-head',
      'illegal-phase',
      'append-dispose-race',
      'caller-dispose-race',
    ])(
      'runs actual native file controls with modeled original protection/owner: %s',
      (mode) => {
        const directory = path.join(root, mode);
        const record = path.join(root, `${mode}.json`);
        provision(directory, record);
        expect(invoke('parse', [record], production)).toEqual({ accepted: true });
        const result = invoke(mode, [record, directory]);
        expect(result).toMatchObject({ passed: true, effects: 0, modeledProtection: true });
        expect(result.headerBytes).toBeLessThanOrEqual(2048);
        if (mode === 'chunks') expect(result.nativeWriteCalls).toBeGreaterThan(2);
      },
      40000,
    );
    it('lets original caller completion observe owner closure without the reverse disposal lock order', () => {
      expect(invoke('owner-dispose-race', [root])).toMatchObject({ passed: true, effects: 0 });
    });
    it('uses actual stage/retirement helpers through two-original verification and rollback without services', () => {
      const scratch = path.join(root, 'lifecycle');
      fs.mkdirSync(scratch);
      const result = JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            path.join(project, 'tests/fixtures/protected-journal/lifecycle.ps1'),
            '-Project',
            project,
            '-Scratch',
            scratch,
          ],
          { timeout: 30000, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
        ).toString(),
      );
      expect(result).toEqual({
        passed: true,
        stageLeaves: 11,
        twoOriginals: true,
        rollbackOriginalPreserved: true,
        closedEvidence: 3,
        directoryRemoved: true,
        unknownClosureRefused: true,
        originalIdentityAndBytesPreserved: true,
        modeledProtection: true,
        serviceOperations: 0,
      });
    }, 35000);
  },
);
