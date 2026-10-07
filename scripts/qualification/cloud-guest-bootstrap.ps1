param([Parameter(Mandatory = $true)][string]$TaskPassword)

# Fixed local diagnostics helpers. No dynamic exception or arbitrary child text is returned.
function Read-CloudGuestTaskDiagnostics([string]$Path) {
    $status = 'guest-task-result-missing'
    try {
        if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'refused' }
        $status = 'guest-task-result-malformed'
        $file = Get-Item -LiteralPath $Path -Force
        if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 2 -or $file.Length -gt 16KB) { throw 'refused' }
        $value = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
        $names = @($value.PSObject.Properties.Name | Sort-Object)
        $expected = @('schemaVersion', 'task', 'passed', 'stage', 'failure', 'readEditTestPassed', 'shellAndDescendantPositive', 'hostPathProbes', 'protectedProbes') | Sort-Object
        $stages = @('manifest', 'input', 'work-edit', 'scratch', 'unit-test', 'shell-descendant', 'protected-probes', 'host-path-probes', 'negative-controls', 'completed')
        if (($names -join ',') -cne ($expected -join ',') -or ($value.schemaVersion -isnot [int] -and $value.schemaVersion -isnot [long]) -or
            $value.schemaVersion -ne 1 -or $value.task -cne 'fixed-read-edit-test' -or $value.stage -isnot [string] -or
            $value.passed -isnot [bool] -or $value.readEditTestPassed -isnot [bool] -or $value.shellAndDescendantPositive -isnot [bool] -or $value.stage -cnotin $stages -or
            $value.hostPathProbes -isnot [array] -or $value.protectedProbes -isnot [array] -or $value.hostPathProbes.Count -gt 14 -or $value.protectedProbes.Count -gt 4) { throw 'refused' }
        $codes = @('EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EIO', 'EBUSY', 'EEXIST', 'UNKNOWN')
        foreach ($probe in $value.protectedProbes) {
            $fields = @($probe.PSObject.Properties.Name | Sort-Object) -join ','
            if ($fields -cnotin @('denied,label', 'code,denied,label') -or $probe.denied -isnot [bool] -or
                $probe.label -cnotin @('admin-dummy-read', 'setup-profile-dummy-read', 'trusted-bootstrap-write', 'trusted-runtime-write') -or
                ($fields -ceq 'code,denied,label' -and $probe.code -cnotin $codes)) { throw 'refused' }
            if (($probe.denied -and ($fields -cne 'code,denied,label' -or $probe.code -cnotin @('EACCES', 'EPERM'))) -or
                (!$probe.denied -and $fields -ceq 'code,denied,label' -and $probe.code -cin @('EACCES', 'EPERM'))) { throw 'refused' }
        }
        foreach ($probe in $value.hostPathProbes) {
            $fields = @($probe.PSObject.Properties.Name | Sort-Object) -join ','
            if ($probe.route -ceq 'direct') {
                if ($fields -cnotin @('action,outcome,route', 'action,code,outcome,route') -or $probe.action -cnotin @('read', 'write', 'delete') -or
                    $probe.outcome -cnotin @('succeeded-in-guest-namespace', 'absent-in-guest-namespace', 'guest-refused') -or
                    ($fields -ceq 'action,code,outcome,route' -and $probe.code -cnotin $codes)) { throw 'refused' }
            } elseif ($probe.route -cin @('shell', 'descendant')) {
                if ($fields -cne 'action,exitCode,processFailed,route' -or $probe.processFailed -isnot [bool] -or
                    $probe.action -cnotin @('read', 'write', 'delete', 'read-write-delete') -or
                    ($null -ne $probe.exitCode -and ($probe.exitCode -isnot [int] -and $probe.exitCode -isnot [long]))) { throw 'refused' }
            } else { throw 'refused' }
        }
        if ($null -ne $value.failure) {
            if ((@($value.failure.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'childExitCode,stage' -or
                $value.failure.stage -cnotin $stages -or ($null -ne $value.failure.childExitCode -and
                $value.failure.childExitCode -isnot [int] -and $value.failure.childExitCode -isnot [long])) { throw 'refused' }
        }
        if ($value.passed) {
            $labels = @($value.protectedProbes | ForEach-Object { $_.label }) -join ','
            $requiredLabels = 'admin-dummy-read,setup-profile-dummy-read,trusted-bootstrap-write,trusted-runtime-write'
            $hostCases = @($value.hostPathProbes | ForEach-Object { $_.route + '/' + $_.action }) -join ','
            $group = 'direct/read,direct/write,direct/delete,shell/read,shell/write,shell/delete,descendant/read-write-delete'
            if ($value.stage -cne 'completed' -or $null -ne $value.failure -or !$value.readEditTestPassed -or !$value.shellAndDescendantPositive -or
                $labels -cne $requiredLabels -or $hostCases -cne ($group + ',' + $group) -or
                @($value.protectedProbes | Where-Object { !$_.denied }).Count -or
                @($value.hostPathProbes | Where-Object { $_.route -cne 'direct' -and $_.processFailed }).Count) { throw 'refused' }
        }
        return @{ status = 'verified'; task = $value }
    } catch { return @{ status = $status; task = $null } }
}
function Merge-CloudGuestTaskDiagnostics($Identity, $Parsed, [bool]$AdminCanaryUnchanged) {
    $taskResult = $Parsed.task
    if ($null -eq $taskResult) {
        $taskResult = @{ schemaVersion = 1; task = 'fixed-read-edit-test'; passed = $false; stage = 'result-unavailable';
            failure = $null; readEditTestPassed = $false; shellAndDescendantPositive = $false; hostPathProbes = @(); protectedProbes = @() }
    }
    $nativePassed = $Identity.ContainsKey('passed') -and $Identity.passed -eq $true -and $Identity.exitCodeObserved -eq $true -and
        $Identity.exitCode -eq 0 -and $Identity.jobClosureConfirmed -eq $true -and $Identity.taskReleased -eq $true -and
        $Identity.heldIdentityBeforeRelease -eq $true -and $Identity.elevated -eq $false -and $Identity.administratorEnabled -eq $false
    $passed = $nativePassed -and $Parsed.status -ceq 'verified' -and $taskResult.passed -eq $true -and $AdminCanaryUnchanged
    # Existing host driver consumes this field. Child JSON can never override native refusal.
    $taskResult.passed = [bool]$passed
    $failure = if ($passed) { $null } elseif (!$nativePassed) { 'guest-task-process-refused' } elseif ($Parsed.status -cne 'verified') { $Parsed.status } else { 'guest-task-controls-refused' }
    return @{ passed = [bool]$passed; identity = $Identity; task = $taskResult; taskResultStatus = $Parsed.status; failureCode = $failure }
}
# Only fixed enums and numeric observations cross the PS Direct boundary.
function Get-CloudGuestBootstrapFailure([string]$Stage, [Management.Automation.ErrorRecord]$ErrorRecord) {
    $stages = @('scope', 'administrator', 'accounts', 'secret-cleanup', 'acl-setup', 'native-load', 'native-run', 'result-diagnostics', 'os-receipt')
    if ($Stage -cnotin $stages) { $Stage = 'bootstrap-unknown' }
    $types = @('System.Management.Automation.RuntimeException', 'System.Management.Automation.CommandNotFoundException',
        'System.Management.Automation.MethodInvocationException', 'System.Management.Automation.PropertyNotFoundException',
        'System.Management.Automation.ItemNotFoundException', 'System.UnauthorizedAccessException', 'System.InvalidOperationException',
        'System.ArgumentException', 'System.Security.SecurityException', 'System.ComponentModel.Win32Exception', 'System.IO.IOException')
    $type = $ErrorRecord.Exception.GetType().FullName
    if ($type -cnotin $types) { $type = 'unknown' }
    $category = $ErrorRecord.CategoryInfo.Category.ToString()
    if ($category -cnotin @('NotSpecified', 'InvalidOperation', 'InvalidArgument', 'PermissionDenied', 'ObjectNotFound',
        'ResourceUnavailable', 'SecurityError', 'OperationStopped', 'ParserError', 'InvalidData', 'NotImplemented', 'WriteError', 'ReadError')) { $category = 'unknown' }
    $line = $ErrorRecord.InvocationInfo.ScriptLineNumber
    if ($line -lt 0 -or $line -gt 5000) { $line = 0 }
    return @{ stage = $Stage; type = $type; category = $category; hResult = [int]$ErrorRecord.Exception.HResult; line = [int]$line }
}
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bootstrapStage = 'scope'; $identity = $null; $diagnostics = $null; $secretCleanup = $false
try {
if ($env:AEGIS_CLOUD_GUEST_LAB -ne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:AEGIS_CLOUD_GUEST_VM_ID -notmatch '^[a-f0-9-]{36}$' -or
    !(Test-Path -LiteralPath C:/ProgramData/AegisCloudLab/trusted/manifest.json)) { throw 'trusted-guest-lab-scope-required' }
$bootstrapStage = 'administrator'
$current = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'setup-admin-required' }
$trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $root = 'C:\AegisLab'
$bootstrapStage = 'accounts'
$task = Get-LocalUser -Name AegisTask; $setup = Get-LocalUser -Name AegisSetup
if (!$task.Enabled -or $task.SID -eq $setup.SID -or @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $task.SID).Count) { throw 'separate-standard-account-required' }
# Exact setup password cache removal precedes any standard-user launch.
$bootstrapStage = 'secret-cleanup'
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
$secretCleanup = $true

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
$bootstrapStage = 'acl-setup'
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
$bootstrapStage = 'native-load'
Add-Type -Path "$trusted\guest-process.dll"
$bootstrapStage = 'native-run'
try { $identity = [CloudGuestProcess]::Run($TaskPassword, $task.SID.Value) }
catch {
    $identity = [CloudGuestProcess]::FailureReceipt($_.Exception)
    if ($null -eq $identity) { throw 'guest-task-process-refused' }
}
$bootstrapStage = 'result-diagnostics'
$parsed = @{ status = 'guest-task-result-unread-closure-unknown'; task = $null }
if ($identity.jobClosureConfirmed -eq $true) { $parsed = Read-CloudGuestTaskDiagnostics "$root\work\result.json" }
$adminCanary = $false
try { $adminCanary = [IO.File]::ReadAllText('C:\ProgramData\AegisCloudLab\admin\dummy.txt') -ceq 'guest-admin-dummy-control' } catch { }
$diagnostics = Merge-CloudGuestTaskDiagnostics $identity $parsed $adminCanary
$bootstrapStage = 'os-receipt'
$os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
return @{ schemaVersion = 1; passed = $diagnostics.passed; failureCode = $diagnostics.failureCode; taskResultStatus = $diagnostics.taskResultStatus;
    guest = @{ version = $os.Version; build = $os.BuildNumber; caption = $os.Caption }; identity = $identity; task = $diagnostics.task;
    setupAnswerCachesAbsent = $true; autoLogonDisabled = $true; passwordRegistryAbsent = $true; labOnlyPowerShellDirect = $true; atomicJobAtCreation = $false; launchAllowed = $false }
} catch {
    $failure = Get-CloudGuestBootstrapFailure $bootstrapStage $_
    $taskResult = if ($null -ne $diagnostics) { $diagnostics.task } else { $null }
    if ($null -eq $taskResult) {
        $taskResult = @{ schemaVersion = 1; task = 'fixed-read-edit-test'; passed = $false; stage = 'bootstrap-unavailable';
            failure = $null; readEditTestPassed = $false; shellAndDescendantPositive = $false; hostPathProbes = @(); protectedProbes = @() }
    }
    $taskResult.passed = $false
    $status = if ($null -ne $diagnostics) { $diagnostics.taskResultStatus } else { 'guest-task-result-unavailable' }
    return @{ schemaVersion = 1; passed = $false; failureCode = 'guest-bootstrap-refused'; bootstrapFailure = $failure; taskResultStatus = $status;
        guest = $null; identity = $identity; task = $taskResult; setupAnswerCachesAbsent = $secretCleanup; autoLogonDisabled = $secretCleanup;
        passwordRegistryAbsent = $secretCleanup; labOnlyPowerShellDirect = $true; atomicJobAtCreation = $false; launchAllowed = $false }
}
