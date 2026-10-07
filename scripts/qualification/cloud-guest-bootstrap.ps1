param([Parameter(Mandatory = $true)][string]$TaskPassword)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:AEGIS_CLOUD_GUEST_LAB -ne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:AEGIS_CLOUD_GUEST_VM_ID -notmatch '^[a-f0-9-]{36}$' -or
    !(Test-Path -LiteralPath C:/ProgramData/AegisCloudLab/trusted/manifest.json)) { throw 'trusted-guest-lab-scope-required' }
$current = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'setup-admin-required' }
$trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $root = 'C:\AegisLab'
$task = Get-LocalUser -Name AegisTask; $setup = Get-LocalUser -Name AegisSetup
if (!$task.Enabled -or $task.SID -eq $setup.SID -or @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $task.SID).Count) { throw 'separate-standard-account-required' }
# Exact setup password cache removal precedes any standard-user launch.
$answerPaths = @('C:\Windows\Panther\unattend.xml', 'C:\Windows\Panther\Autounattend.xml', 'C:\Windows\Panther\Unattend\unattend.xml', 'C:\Windows\Panther\UnattendGC\unattend.xml', 'C:\Windows\System32\Sysprep\unattend.xml', 'C:\Windows\System32\Sysprep\Panther\unattend.xml', 'C:\$Windows.~BT\Sources\Panther\unattend.xml', 'C:\$Windows.~BT\Sources\Panther\Unattend\unattend.xml')
foreach ($selected in $answerPaths) {
    if (Test-Path -LiteralPath $selected) {
        $file = Get-Item -LiteralPath $selected -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'answer-cache-path-invalid' }
        Remove-Item -LiteralPath $selected -Force
    }
}
$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -LiteralPath $winlogon -Name AutoAdminLogon -Value '0'
foreach ($value in @('DefaultPassword', 'AutoLogonCount')) { Remove-ItemProperty -LiteralPath $winlogon -Name $value -ErrorAction SilentlyContinue }
if (@($answerPaths | Where-Object { Test-Path -LiteralPath $_ }).Count -or
    (Get-ItemProperty -LiteralPath $winlogon).AutoAdminLogon -ne '0' -or
    (Get-Item -LiteralPath $winlogon).GetValueNames() -contains 'DefaultPassword') { throw 'setup-secret-cleanup-unconfirmed' }

function FixedAcl([string]$Path, [bool]$Directory, [bool]$TaskWrite, [bool]$TaskRead) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', $inherit, 'None', 'Allow'))
    }
    if ($TaskWrite -or $TaskRead) {
        $rights = if ($TaskWrite) { 'Modify' } else { 'ReadAndExecute' }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($task.SID, $rights, $inherit, 'None', 'Allow'))
    }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')); Set-Acl -LiteralPath $Path -AclObject $acl
}
foreach ($directory in @($root, "$root\input", "$root\work", "$root\scratch", 'C:\ProgramData\AegisCloudLab\admin')) { New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null }
FixedAcl 'C:\ProgramData\AegisCloudLab' $true $false $true
FixedAcl $trusted $true $false $true
FixedAcl 'C:\ProgramData\AegisCloudLab\admin' $true $false $false
FixedAcl $root $true $false $true
FixedAcl "$root\input" $true $false $true; FixedAcl "$root\work" $true $true $true; FixedAcl "$root\scratch" $true $true $true
[IO.File]::WriteAllText('C:\ProgramData\AegisCloudLab\admin\dummy.txt', 'guest-admin-dummy-control')
[IO.File]::WriteAllText('C:\Users\AegisSetup\aegis-dummy.txt', 'setup-profile-dummy-control')
FixedAcl 'C:\Users\AegisSetup\aegis-dummy.txt' $false $false $false
[IO.File]::WriteAllText("$root\input\numbers.json", '{"a":2,"b":3}')
[IO.File]::WriteAllText("$root\work\sum.cjs", "module.exports=(a,b)=>a-b;`n")
[IO.File]::WriteAllText("$trusted\sum.test.cjs", "const t=require('node:test'),a=require('node:assert/strict');t('fixed sum',()=>a.equal(require('C:/AegisLab/work/sum.cjs')(2,3),5));")
foreach ($file in @(Get-ChildItem -LiteralPath $trusted -File)) { FixedAcl $file.FullName $false $false $true }
if ([IO.File]::ReadAllText('C:\ProgramData\AegisCloudLab\admin\dummy.txt') -ne 'guest-admin-dummy-control') { throw 'admin-positive-control-failed' }
Add-Type -Path "$trusted\guest-process.dll"
$identity = [CloudGuestProcess]::Run($TaskPassword, $task.SID.Value)
$resultFile = Get-Item -LiteralPath "$root\work\result.json" -Force
if ($resultFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $resultFile.Length -gt 16KB) { throw 'guest-result-budget-failed' }
$taskResult = [IO.File]::ReadAllText($resultFile.FullName) | ConvertFrom-Json
if (!$taskResult.passed -or !$identity.jobClosureConfirmed -or [IO.File]::ReadAllText('C:\ProgramData\AegisCloudLab\admin\dummy.txt') -ne 'guest-admin-dummy-control') { throw 'guest-controls-unconfirmed' }
$os = Get-CimInstance Win32_OperatingSystem
return @{ schemaVersion = 1; guest = @{ version = $os.Version; build = $os.BuildNumber; caption = $os.Caption }; identity = $identity; task = $taskResult;
    setupAnswerCachesAbsent = $true; autoLogonDisabled = $true; passwordRegistryAbsent = $true; labOnlyPowerShellDirect = $true; atomicJobAtCreation = $false; launchAllowed = $false }
