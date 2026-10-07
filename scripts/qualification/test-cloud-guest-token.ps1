param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = $ProjectRoot
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'token-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-guest-token-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $dll = Join-Path $fixture 'token-controls.dll'
    $arguments = @('/nologo', '/target:library', '/platform:x64', '/warnaserror+', ('/out:"' + $dll + '"'),
        ('"' + (Join-Path $PSScriptRoot 'CloudGuestProcess.cs') + '"'), ('"' + (Join-Path $PSScriptRoot 'CloudGuestDesktop.cs') + '"'), ('"' + (Join-Path $PSScriptRoot 'CloudGuestTokenFixture.cs') + '"'),
        ('"' + (Join-Path $project 'sidecar/session/GuestJobNative.cs') + '"'), ('"' + (Join-Path $project 'sidecar/session/GuestJobInventory.cs') + '"'))
    foreach ($leaf in @('CloudGuestRuntimeGate.cs','CloudGuestNetwork.cs', 'CloudGuestClaudeReceiver.cs')) { $arguments += ('"' + (Join-Path $PSScriptRoot $leaf) + '"') }
    foreach ($leaf in @('CallerAdmission','CallerRegistration','CallerIdentity','CallerNative')) { $arguments += ('"' + (Join-Path $project ('sidecar/session/' + $leaf + '.cs')) + '"') }
    $exit = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($exit -ne 0 -or (Get-Item -LiteralPath $dll).Length -gt 1MB) { throw 'token-native-compile-failed' }
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
    $type = $assembly.GetType('CloudGuestTokenFixture')
    $old = $type.GetMethod('Observe').Invoke($null, @($true))
    $current = $type.GetMethod('Observe').Invoke($null, @($false))
    if ($old.membershipObserved -or !$old.sidMatches -or $null -ne $old.administratorEnabled -or
        $old.hResult -ne -2146233078 -or $old.win32Error -ne 5) { throw 'query-only-regression-not-reproduced' }
    if (!$current.membershipObserved -or !$current.sidMatches -or !$current.filteredGroupsAvailable -or $current.administratorGroupPresent -isnot [bool] -or
        $current.administratorGroupPresent -ne $current.baselineAdministratorGroupPresent) { throw 'actual-held-token-membership-failed' }
    $groupControls = $type.GetMethod('GroupControls').Invoke($null, @())
    if ($groupControls -ne 13) { throw 'all-attributes-group-controls-failed' }
    foreach ($closed in @($false, $true)) {
        if (!$type.GetMethod('RefusesInvalid').Invoke($null, @($closed))) { throw 'invalid-held-process-accepted' }
    }
    $receiver = $type.GetMethod('ObserveReceiver').Invoke($null, @())
    if (!$receiver.membershipObserved -or !$receiver.sidMatches -or $receiver.administratorEnabled -isnot [bool] -or
        $receiver.administratorEnabled -ne $receiver.baselineAdministratorEnabled) { throw 'actual-receiver-token-membership-failed' }
    foreach ($closed in @($false,$true)) {
        if (!$type.GetMethod('RefusesInvalidReceiver').Invoke($null, @($closed))) { throw 'invalid-receiver-held-process-accepted' }
    }
    @{passed=$true;cases=20;allAttributesGroupControls=$groupControls;actualReceiverOpener=$receiver;queryOnly=$old;actualLauncher=$current;invalidAndClosedHandlesRefused=$true;
        powerShell=$PSVersionTable.PSVersion.ToString();nativeCompiledWarningsAsErrors=$true;currentProcessOnly=$true;
        childLaunchAccountAclOrVmEffects=$false;launchAllowed=$false} | ConvertTo-Json -Depth 5
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'token-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
