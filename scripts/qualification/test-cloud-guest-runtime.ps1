Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$base = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $base -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'runtime-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $base ('aegis-guest-runtime-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $fixtureSources = Join-Path $project 'tests/fixtures/native-cloud-guest-runtime'
    Copy-Item -LiteralPath (Join-Path $fixtureSources 'client-control.cjs') -Destination $fixture
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cloud-guest-runtime.cjs') -Destination $fixture
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $exe = Join-Path $fixture 'RuntimeGateFixture.exe'
    $arguments = @('/nologo', '/warnaserror+', '/target:exe', ('/out:"' + $exe + '"'))
    foreach ($leaf in @('CloudGuestProcess.cs','CloudGuestNetwork.cs','CloudGuestRuntimeGate.cs')) { $arguments += ('"' + (Join-Path $PSScriptRoot $leaf) + '"') }
    foreach ($leaf in @('CallerAdmission','CallerRegistration','CallerIdentity','CallerNative','GuestJobNative','GuestJobInventory')) { $arguments += ('"' + (Join-Path $project ('sidecar/session/' + $leaf + '.cs')) + '"') }
    $arguments += ('"' + (Join-Path $fixtureSources 'RuntimeGateFixture.cs') + '"')
    $compile = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($compile -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 1MB) { throw 'runtime-controls-compile-failed' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"'), ('"' + $fixture + '"')) (Join-Path $fixture 'native.txt') (Join-Path $fixture 'native.error') 15000
    $native = [IO.File]::ReadAllText((Join-Path $fixture 'native.txt'))
    if ($code -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'native.error')).Length -ne 0 -or
        !$native.Contains('native-controls:8') -or !$native.Contains('pure-failure-receipt-controls:2')) { throw 'runtime-native-controls-refused' }
    $native.Trim()
    $code = Invoke-CloudGuestNativeProcess $node @(('"' + (Join-Path $PSScriptRoot 'test-cloud-guest-runtime.cjs') + '"')) (Join-Path $fixture 'pure.txt') (Join-Path $fixture 'pure.error') 5000
    $pure = [IO.File]::ReadAllText((Join-Path $fixture 'pure.txt'))
    if ($code -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'pure.error')).Length -ne 0 -or !$pure.Contains('pure-controls:10')) { throw 'runtime-pure-controls-refused' }
    $pure.Trim()
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'runtime-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
