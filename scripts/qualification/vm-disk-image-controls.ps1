param([Parameter(Mandatory = $true)][string]$OutputRoot, [hashtable]$Observation = @{})
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Observation.passed = $false
$Observation.phase = 'source'
$Observation.cases = [Collections.Generic.List[object]]::new()
$Observation.scope = 'Unattached disposable image eligibility; no VM authority or production acceptance.'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$root = [IO.Path]::GetFullPath($OutputRoot)
if ([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) { throw 'disk-image-fixture-root-exists' }
[void][IO.Directory]::CreateDirectory($root)
$sources = @((Get-ChildItem -LiteralPath (Join-Path $project 'sidecar\session') -Filter '*.cs' -File).FullName) +
    @((Get-ChildItem -LiteralPath (Join-Path $project 'sidecar\owner') -Filter '*.cs' -File).FullName) +
    @((Join-Path $project 'sidecar\mcpjob\AppContainerExecutable.cs'), (Join-Path $project 'tests\fixtures\vm-lifecycle\VmDiskImageFixture.cs'))
$hashes = @{}
$Observation.sourceHashes = $hashes
foreach ($source in @($sources) + @($PSCommandPath)) {
    $file = Get-Item -LiteralPath $source
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 128KB) { throw 'disk-image-fixture-source-refused' }
    $hashes[$source.Substring($project.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
}
$exe = Join-Path $root 'images.exe'
$Observation.phase = 'compile'
$stdout = Join-Path $root 'compile.txt'; $stderr = $stdout + '.error'
$arguments = @('/nologo', '/target:exe', '/platform:x64', '/optimize+', '/warnaserror+', '/reference:System.Management.dll',
    '/reference:System.Security.dll', '/main:VmDiskImageFixture', ('/out:"' + $exe + '"')) + @($sources | ForEach-Object { '"' + $_ + '"' })
$code = Invoke-CloudGuestNativeProcess (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') $arguments $stdout $stderr 30000
if ($code -ne 0 -or (Get-Item -LiteralPath $stdout).Length -gt 16KB -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'disk-image-fixture-build-refused' }
$cases = @('vhd-fixed', 'vhd-dynamic', 'vhdx-fixed', 'vhdx-dynamic', 'vhd-child', 'vhdx-child', 'vhd-missing-parent', 'vhdx-missing-parent', 'corrupt', 'mislabel', 'disposed')
$Observation.phase = 'cases'
foreach ($mode in $cases) {
    $Observation.currentCase = $mode
    $scratch = Join-Path $root $mode
    [void][IO.Directory]::CreateDirectory($scratch)
    $stdout = Join-Path $root ($mode + '.json'); $stderr = $stdout + '.error'
    $code = Invoke-CloudGuestNativeProcess $exe @($mode, ('"' + $scratch + '"')) $stdout $stderr 10000
    $Observation.lastExitCode = $code
    if ($code -ne 0 -or (Get-Item -LiteralPath $stdout).Length -gt 1KB -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'disk-image-fixture-execution-refused' }
    $row = [IO.File]::ReadAllText($stdout) | ConvertFrom-Json
    $expected = $mode -in @('vhd-fixed', 'vhd-dynamic', 'vhdx-fixed', 'vhdx-dynamic')
    if ($row.accepted -isnot [bool] -or $row.accepted -ne $expected -or $row.cleanup -isnot [bool] -or !$row.cleanup -or
        $row.writeDenied -isnot [bool] -or $row.writeDenied -ne ($mode -ne 'disposed') -or
        @(Get-ChildItem -LiteralPath $scratch -Force).Count -ne 0) { throw 'disk-image-fixture-result-refused' }
    $Observation.cases.Add(@{ mode = $mode; accepted = $row.accepted; writeDenied = $row.writeDenied; cleanup = $row.cleanup })
}
foreach ($relative in $hashes.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $project $relative) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hashes[$relative]) { throw 'disk-image-fixture-source-changed' }
}
$Observation.passed = $true
$Observation.phase = 'complete'
$Observation
