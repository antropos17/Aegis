import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable, production;
function compile(compiler, args) {
  try {
    execFileSync(compiler, args, { timeout: 30000, windowsHide: true, stdio: 'pipe' });
  } catch (error) {
    throw new Error(
      `Native fixture compilation failed: ${error.stdout?.toString().slice(0, 4096) || error.message}`,
      { cause: error },
    );
  }
}
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'inactive runtime candidate (modeled installed authority/provider; native process/file controls)',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-runtime-candidate-'));
      executable = path.join(root, 'candidate.exe');
      production = path.join(root, 'production.dll');
      const compiler = path.join(
        process.env.WINDIR || 'C:/Windows',
        'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
      );
      const sources = ['sidecar/session', 'sidecar/owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, directory))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, directory, name)),
      );
      sources.push(path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'));
      const common = [
        '/nologo',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/reference:System.Management.dll',
        '/reference:System.Security.dll',
      ];
      compile(compiler, [...common, '/target:library', `/out:${production}`, ...sources]);
      compile(compiler, [
        ...common,
        '/target:exe',
        '/main:RuntimeCandidateFixture',
        '/define:RUNTIME_CANDIDATE_TEST;INSTALLED_VM_TEST;CALLER_MAIN_OPERATION_TEST',
        `/out:${executable}`,
        ...sources,
        ...['RuntimeCandidateFixture', 'RuntimeCandidateRecords'].map((name) =>
          path.join(project, 'tests/fixtures/runtime-candidate', `${name}.cs`),
        ),
        ...['VmStorageFixture', 'VmDiskImageFixture'].map((name) =>
          path.join(project, 'tests/fixtures/vm-lifecycle', `${name}.cs`),
        ),
        path.join(project, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
      ]);
    }, 65000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    });
    function invoke(mode, args = []) {
      const result = spawnSync(executable, [mode, ...args], {
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString().slice(0, 1024)).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    function reader(mode) {
      const scratch = path.join(root, mode);
      fs.mkdirSync(scratch);
      return invoke(mode, [scratch]);
    }
    it.each(['positive', 'args-empty', 'args-unicode', 'args-quoted', 'maxima'])(
      'parses canonical candidate metadata and isolates argument copies: %s',
      (mode) => {
        expect(invoke(`parse-${mode}`)).toEqual({ accepted: true, isolated: true });
      },
    );
    it.each([
      'unknown',
      'approved',
      'host-command',
      'provider-url',
      'credential',
      'approver',
      'duplicate',
      'whitespace',
      'bom',
      'trailing',
      'truncated',
      'reordered',
      'leading-zero',
      'number-type',
      'number-overflow',
      'revision-zero',
      'hash-upper',
      'hash-short',
      'sid-overflow',
      'vm-empty',
      'vm-upper',
      'profile',
      'os-small',
      'os-large',
      'bootstrap-large',
      'package-large',
      'package-zero',
      'entry-absolute',
      'entry-drive',
      'entry-device',
      'entry-traversal',
      'entry-ads',
      'entry-reserved',
      'entry-empty',
      'entry-dot',
      'entry-long',
      'args-count',
      'args-size',
      'args-total',
      'args-nul',
      'args-escape',
      'args-type',
      'processes',
      'job-memory',
      'process-memory',
      'process-over-job',
      'duration-small',
      'duration-large',
      'status',
      'record-large',
      'invalid-utf8',
    ])('refuses noncanonical, unsupported or oversized candidate data: %s', (mode) => {
      expect(invoke(`parse-${mode}`)).toEqual({ accepted: false, isolated: false });
    });
    it('retains candidate-only metadata through original owner and fresh caller-bound inspection', () => {
      expect(reader('positive')).toEqual({
        acquired: true,
        current: true,
        revived: true,
        requests: 0,
        fresh: true,
        sharedAlive: true,
      });
    });
    it.each([
      'missing',
      'unprotected',
      'unbound',
      'legacy',
      'foreign-owner',
      'stale-install',
      'stale-revision',
      'stale-epoch',
      'stale-policy',
      'stale-operator',
      'stale-selection',
      'stale-selection-epoch',
      'stale-config',
      'stale-vm',
    ])('refuses acquisition without the original current protected association: %s', (mode) => {
      expect(reader(mode)).toMatchObject({
        acquired: false,
        current: false,
        revived: false,
        requests: 0,
      });
    });
    it.each([
      'owner-loss',
      'caller-loss',
      'leaf-replaced',
      'leaf-metadata',
      'leaf-unprotected',
      'leaf-bytes',
      'extra-arguments',
      'vm-record',
      'configuration-loss',
      'state-loss',
      'identity-loss',
    ])('permanently refuses loss even after restoring original observed values: %s', (mode) => {
      expect(reader(mode)).toMatchObject({
        acquired: true,
        current: false,
        revived: false,
        requests: 0,
      });
    });
    it('holds the actual native candidate leaf against writes/deletion with descriptor acceptance modeled', () => {
      expect(reader('native-pins')).toMatchObject({
        acquired: true,
        current: true,
        revived: true,
        requests: 0,
        fresh: true,
      });
    });
    it('refuses an actual ordinary-account descriptor through production EnrollmentNative', () => {
      expect(reader('native-unprotected')).toMatchObject({ acquired: false, requests: 0 });
    });
    it('builds production without injected factories and keeps candidate construction private', () => {
      expect(invoke('production', [production])).toEqual({ testFactoriesAbsent: true });
    });
  },
);
