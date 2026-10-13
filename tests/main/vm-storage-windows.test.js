import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable;
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'offline VM storage observation',
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-vm-storage-'));
      executable = path.join(root, 'storage.exe');
      const sources = ['sidecar/session', 'sidecar/owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, directory))
          .filter((name) => name.endsWith('.cs'))
          .map((name) => path.join(project, directory, name)),
      );
      execFileSync(
        path.join(
          process.env.WINDIR || 'C:/Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/warnaserror+',
          '/reference:System.Management.dll',
          '/reference:System.Security.dll',
          '/main:VmStorageFixture',
          `/out:${executable}`,
          ...sources,
          path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
          path.join(project, 'tests/fixtures/vm-lifecycle/VmStorageFixture.cs'),
        ],
        { timeout: 30000, windowsHide: true, stdio: 'pipe' },
      );
    }, 35000);
    afterAll(() => {
      if (!root) return;
      expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    });
    function invoke(mode, args = []) {
      const result = spawnSync(executable, [mode, ...args], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 4096,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString().slice(0, 1024)).toBe(0);
      expect(result.stderr.length).toBe(0);
      return JSON.parse(result.stdout.toString());
    }
    it.each(['positive', 'dvd-read', 'inherit-only'])('accepts private ACL policy: %s', (mode) => {
      expect(invoke(`acl-${mode}`)).toEqual({ accepted: true });
    });
    it.each([
      'public-read',
      'foreign-vm',
      'ordinary-owner',
      'vm-owner',
      'inherited',
      'missing-vm',
      'empty',
      'null-dacl',
      'deny',
      'callback',
      'truncated',
      'disk-read-only',
      'dvd-write',
    ])('refuses unsafe or unusable private ACL policy: %s', (mode) => {
      expect(invoke(`acl-${mode}`)).toEqual({ accepted: false });
    });
    it('returns an isolated native descriptor snapshot and observes later ACL changes', () => {
      const scratch = path.join(root, 'acl-native');
      fs.mkdirSync(scratch);
      expect(invoke('native-acl-snapshot', [scratch])).toEqual({
        isolated: true,
        changedAclRefused: true,
        cleanup: true,
      });
    });
    it('refuses foreign qualification roots and invalid VM IDs before ACL effects', () => {
      const driver = path.join(project, 'scripts/qualification/cloud-guest-lab.ps1');
      const command = `
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${driver.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count){throw 'source-parse-refused'}
        $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Protect-OwnedCloudGuestStorage'},$true)
        . ([scriptblock]::Create($function.Extent.Text))
        $env:GITHUB_ACTIONS='true'; $env:RUNNER_ENVIRONMENT='github-hosted'; $env:GITHUB_RUN_ID='123'; $env:GITHUB_RUN_ATTEMPT='1'
        $rows=@()
        foreach($case in @(@{root='D:\\foreign';id='11111111-1111-1111-1111-111111111111'},@{root='C:\\ProgramData\\aegis-cloud-assets-123-1';id='invalid'},@{root='C:\\ProgramData\\aegis-cloud-assets-123-1';id='00000000-0000-0000-0000-000000000000'})){
          try{Protect-OwnedCloudGuestStorage $case.root $case.id | Out-Null; $rows += $false}
          catch{$rows += $_.Exception.Message -ceq 'registered-vm-owner-corpus-refused'}
        }
        ConvertTo-Json -InputObject $rows -Compress
      `;
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          timeout: 10000,
          windowsHide: true,
          maxBuffer: 4096,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr.length).toBe(0);
      expect(JSON.parse(result.stdout.toString('utf8'))).toEqual([true, true, true]);
    });
    it.each(['positive', 'reordered'])('accepts unchanged attachments: %s', (mode) => {
      const result = invoke(mode);
      expect(result).toMatchObject({ acquired: true, checked: true, refusedAgain: false });
      expect(result.closed).toBe(result.opened);
    });
    it.each([
      'empty',
      'missing',
      'foreign-path',
      'ads',
      'dot-path',
      'unsupported',
      'empty-disk',
      'duplicate-id',
      'duplicate-path',
      'null-row',
      'quota',
      'link',
      'zero',
      'file-failure',
      'partial-open',
      'metadata',
    ])('refuses invalid initial storage: %s', (mode) => {
      const result = invoke(`initial-${mode}`);
      expect(result.acquired).toBe(false);
      expect(result.closed).toBe(result.opened);
    });
    it.each(['changed-file', 'reconnected', 'outage', 'changed-during-query'])(
      'retains refusal after %s',
      (mode) => {
        const result = invoke(mode);
        expect(result).toMatchObject({ acquired: true, checked: false, refusedAgain: true });
        expect(result.closed).toBe(result.opened);
      },
    );
    it.each(['changed-identity', 'changed-metadata'])(
      'binds %s across separate acquisitions',
      (mode) => {
        expect(invoke(mode)).toMatchObject({ acquired: true, changedDigest: true });
      },
    );
    it('denies native file writes/deletion while held, detects replacement and releases every handle', () => {
      const scratch = path.join(root, 'native');
      fs.mkdirSync(scratch);
      expect(invoke('native', [scratch])).toEqual({
        writeDenied: true,
        deleteDenied: true,
        replacementChanged: true,
        cleanup: true,
      });
      expect(fs.readdirSync(scratch)).toEqual([]);
    });
    it.each(['native-writer', 'native-hardlink'])(
      'refuses %s and closes partial native holds',
      (mode) => {
        const scratch = path.join(root, mode);
        fs.mkdirSync(scratch);
        expect(invoke(mode, [scratch])).toEqual({ refused: true, cleanup: true });
        expect(fs.readdirSync(scratch)).toEqual([]);
      },
    );
  },
);
