param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out = [System.IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path $out) -and @(Get-ChildItem -LiteralPath $out -Force).Count -ne 0) { throw 'Choose a new empty task-owned output directory.' }
New-Item -ItemType Directory -Force $out | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$exe = Join-Path $out 'cleanup-fixture.exe'
& $csc /nologo /platform:x64 /warnaserror+ "/out:$exe" (Join-Path $PSScriptRoot 'CleanupFixture.cs') (Join-Path $project 'sidecar/owner-console/NativeLaunch.cs') (Join-Path $project 'sidecar/owner-console/PeerIdentity.cs')
if ($LASTEXITCODE -ne 0) { throw 'Cleanup fixture compilation failed.' }
& $exe
if ($LASTEXITCODE -ne 0) { throw "Cleanup fixture failed; see $out for diagnostics." }
