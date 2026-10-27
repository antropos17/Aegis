$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base = Join-Path $root '.task-temp/owner-console-profile'
$run = Join-Path $base ('runner-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null
$env:TEMP = $run
$env:TMP = $run
$source = Join-Path $root 'sidecar/owner-console/ProfileIsolation.cs'
$fixture = Join-Path $PSScriptRoot 'ProfileFixture.cs'
$exe = Join-Path $run 'profile-fixture.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$before = @((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash, (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash)
$compileOutput = @(& $csc /nologo /platform:x64 /warnaserror+ "/out:$exe" $fixture $source 2>&1)
$compileStatus = $LASTEXITCODE
$compileOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'compile.log')
if ($compileStatus -ne 0) { $compileOutput; throw "profile fixture compile failed; evidence: $run" }
$testOutput = @(& $exe 2>&1)
$testStatus = $LASTEXITCODE
$testOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'runner.log')
$testOutput
if ($testStatus -ne 0) { throw "profile fixture failed with exit $testStatus; evidence: $run" }
$after = @((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash, (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash)
if ($before[0] -ne $after[0] -or $before[1] -ne $after[1]) { throw "profile fixture sources changed during run; evidence: $run" }
"Source SHA256: $($before[0]); fixture SHA256: $($before[1]); evidence: $run"
