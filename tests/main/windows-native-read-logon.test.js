import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(path.dirname(path.resolve(folder))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-native-logon-')).toBe(true);
    expect(fs.realpathSync(folder)).toBe(path.resolve(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function windowsLogonFixture(scenario) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-native-logon-'));
  folders.push(folder);
  const script = path.join(folder, 'fixture.ps1');
  fs.writeFileSync(
    script,
    `param([string]$Source,[string]$Scenario)
$ErrorActionPreference='Stop'
try {
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'fixture-engine-refused' }
  . (Join-Path $Source 'scripts/qualification/cloud-guest-media.ps1')
  . (Join-Path $Source 'scripts/qualification/windows-native-read-host.ps1')
  $admin='AEGIS_SYNTHETIC_ADMIN_0123456789aA1!';$task='AEGIS_SYNTHETIC_TASK_0123456789bB2!'
  $text=New-CloudGuestAnswerText 1 $admin $task
  $marker='<LogonCount>1</LogonCount>'
  if($Scenario -ceq 'positive') {
    $changed=Set-NativeReadSecondLogon $text
    if($changed -cne $text.Replace($marker,'<LogonCount>2</LogonCount>')) { throw 'fixture-payload-changed' }
    $before=[xml]$text;$after=[xml]$changed
    $old=@($before.SelectNodes('//*[local-name()="Password"]/*[local-name()="Value"]') | ForEach-Object { $_.InnerText })
    $new=@($after.SelectNodes('//*[local-name()="Password"]/*[local-name()="Value"]') | ForEach-Object { $_.InnerText })
    if($old.Count -ne 3 -or $new.Count -ne 3) { throw 'fixture-password-count' }
    for($index=0;$index -lt $old.Count;$index++) { if($old[$index] -cne $new[$index]) { throw 'fixture-credentials-changed' } }
    if($new[0] -cne $admin -or $new[1] -cne $task -or $new[2] -cne $admin) { throw 'fixture-credentials-refused' }
    @{status='PASS';scenario=$Scenario;version=$PSVersionTable.PSVersion.ToString();credentialsUnchanged=$true;payloadUnchangedExceptCount=$true;newCount=[regex]::Matches($changed,[regex]::Escape('<LogonCount>2</LogonCount>')).Count} | ConvertTo-Json -Compress
  } else {
    $malformed=switch($Scenario) {
      'missing' { $text.Replace($marker,'') }
      'multiple' { $text.Replace($marker,$marker+'<LogonCount>2</LogonCount>') }
      'malformed' { $text.Replace($marker,'<LogonCount>1</LogonCountWrong>') }
      default { throw 'fixture-scenario-refused' }
    }
    $original=$malformed;$refused=$false
    try { [void](Set-NativeReadSecondLogon $malformed) }
    catch { if($_.Exception.Message -cne 'Second lab logon seam changed') { throw 'fixture-refusal-code' };$refused=$true }
    if(-not $refused -or $malformed -cne $original) { throw 'fixture-unsafe-input-accepted' }
    @{status='PASS';scenario=$Scenario;version=$PSVersionTable.PSVersion.ToString();refused=$true;inputUnchanged=$true} | ConvertTo-Json -Compress
  }
} catch { @{status='FAIL';code='native-logon-fixture-refused';scenario=$Scenario} | ConvertTo-Json -Compress;exit 2 }
`,
  );
  const executable = path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const result = spawnSync(
    executable,
    ['-NoProfile', '-NonInteractive', '-File', script, '-Source', root, '-Scenario', scenario],
    { cwd: folder, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8192 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).not.toMatch(/SYNTHETIC_ADMIN|SYNTHETIC_TASK|<unattend|<Password/);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}

describe.skipIf(process.platform !== 'win32')(
  'native guest second logon in actual Windows PowerShell 5.1',
  () => {
    it('changes only the real helper logon count and preserves all synthetic credentials', () => {
      expect(windowsLogonFixture('positive')).toMatchObject({
        status: 'PASS',
        version: expect.stringMatching(/^5\.1\./),
        credentialsUnchanged: true,
        payloadUnchangedExceptCount: true,
        newCount: 1,
      });
    }, 20000);
    it.each(['missing', 'multiple', 'malformed'])(
      'refuses %s logon references without changing the input',
      (scenario) => {
        expect(windowsLogonFixture(scenario)).toMatchObject({
          status: 'PASS',
          version: expect.stringMatching(/^5\.1\./),
          refused: true,
          inputUnchanged: true,
        });
      },
      20000,
    );
  },
);
