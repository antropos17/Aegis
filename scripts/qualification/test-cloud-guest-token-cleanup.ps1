param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cleanup-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-token-cleanup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $exe = Join-Path $fixture 'CleanupFixture.exe'
    $source = Join-Path $ProjectRoot 'scripts/qualification'
    $arguments = @('/nologo', '/target:exe', '/platform:x64', '/warnaserror+', ('/out:"' + $exe + '"'),
        ('"' + (Join-Path $PSScriptRoot 'CloudGuestProcess.cs') + '"'), ('"' + (Join-Path $PSScriptRoot 'CloudGuestAdmissionCleanupFixture.cs') + '"'))
    foreach ($leaf in @('CloudGuestDesktop.cs', 'CloudGuestNetwork.cs', 'CloudGuestClaudeReceiver.cs', 'CloudGuestRuntimeGate.cs')) { $arguments += ('"' + (Join-Path $source $leaf) + '"') }
    foreach ($leaf in @('GuestJobNative', 'GuestJobInventory', 'CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative')) {
        $arguments += ('"' + (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) + '"')
    }
    # Known fixed fixture output only; no full suite, accounts or VM setup.
    $compile = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.stderr') 10000
    if ($compile -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) { throw 'cleanup-fixture-compile-refused' }
    $native = Invoke-CloudGuestNativeProcess $exe @() (Join-Path $fixture 'native.txt') (Join-Path $fixture 'native.stderr') 10000
    $text = [IO.File]::ReadAllText((Join-Path $fixture 'native.txt')).Trim()
    if ($native -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'native.stderr')).Length -ne 0 -or $text -cne 'native-cleanup-controls:11') {
        if ($text -cmatch '^native-cleanup-controls:refused;stage=(token|unassigned|assigned|nonempty|invalid-root|interrupted-setup);check=[0-9]{1,3};hResult=-?[0-9]{1,10}$') { Write-Output $text }
        throw 'cleanup-native-controls-refused'
    }
    [ordered]@{ schemaVersion = 1; passed = $true; nativeCases = 11; scope = 'own-suspended-same-principal-processes-and-jobs';
        warningsAsErrors = $true; crossAccountTokenQualified = $false; actualCloudFailureCauseKnown = $false; launchAllowed = $false;
        accountAclVmOrPrivilegeChanges = $false; powershell = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or
            !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'cleanup-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}
