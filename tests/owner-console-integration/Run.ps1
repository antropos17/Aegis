param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out = [System.IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path $out) -and @(Get-ChildItem -LiteralPath $out -Force).Count -ne 0) { throw 'Choose a new empty task-owned output directory.' }
$sidecar = Join-Path $out 'install/resources/sidecar'
New-Item -ItemType Directory -Force $sidecar | Out-Null
$native = Join-Path $sidecar 'aegis-owner-console.exe'
$electron = Join-Path $out 'install/AEGIS - AI Monitoring & Threat Detection.exe'
$fixture = Join-Path $out 'fixture.exe'
$death = Join-Path $out 'owner-death.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$nativeSources = @(Get-ChildItem (Join-Path $project 'sidecar/owner-console/*.cs') | ForEach-Object FullName)
& $csc /nologo /platform:x64 /warnaserror+ "/out:$native" $nativeSources
if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed.' }
& $csc /nologo /platform:x64 /warnaserror+ "/out:$electron" (Join-Path $PSScriptRoot 'FakeElectron.cs') (Join-Path $project 'sidecar/owner-console/Wire.cs')
if ($LASTEXITCODE -ne 0) { throw 'Synthetic Electron compilation failed.' }
& $csc /nologo /platform:x64 /warnaserror+ "/out:$fixture" (Join-Path $PSScriptRoot 'OwnerFixture.cs') (Join-Path $project 'sidecar/owner-console/NativeLaunch.cs')
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
& $csc /nologo /platform:x64 /warnaserror+ "/out:$death" (Join-Path $PSScriptRoot 'OwnerDeath.cs')
if ($LASTEXITCODE -ne 0) { throw 'Owner death fixture compilation failed.' }
Set-Content (Join-Path $out 'install/resources/app.asar') 'Synthetic fixture archive'
& node (Join-Path $PSScriptRoot 'capture-preview.cjs') (Join-Path $out 'actual-preview.b64')
if ($LASTEXITCODE -ne 0) { throw 'JS preview capture failed.' }
foreach ($scenario in @('shutdown','approve','profile','profile-missing','profile-marker-missing','cancel','idle','after','early','cancel-wait','output-loss','wrong-secret','redirected-stdin','redirected-stderr','verifier-death','wrong-ack','duplicate-ack','partial-input','stuck-descendant')) {
    & $fixture outer $scenario
    if ($LASTEXITCODE -ne 0) { throw "Fixture failed: $scenario; see $out for diagnostics." }
}
& $death outer
if ($LASTEXITCODE -ne 0) { throw "Owner death fixture failed; see $out for diagnostics." }
