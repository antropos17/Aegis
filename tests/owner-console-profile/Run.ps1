$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base = Join-Path $root '.task-temp/owner-console-profile'
$run = Join-Path $base ('runner-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null
$env:TEMP = $run
$env:TMP = $run
$source = Join-Path $root 'sidecar/owner-console/ProfileIsolation.cs'
$fixture = Join-Path $PSScriptRoot 'ProfileFixture.cs'
$watchdogFixture = Join-Path $PSScriptRoot 'WatchdogFixture.cs'
$attributeFixture = Join-Path $PSScriptRoot 'AttributeProbe.cs'
$nativeLaunch = Join-Path $root 'sidecar/owner-console/NativeLaunch.cs'
$exe = Join-Path $run 'profile-fixture.exe'
$watchdogExe = Join-Path $run 'watchdog-fixture.exe'
$attributeExe = Join-Path $run 'attribute-probe.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$inputs = @($source, $fixture, $watchdogFixture, $nativeLaunch, $attributeFixture)
$before = @($inputs | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
$compileOutput = @(& $csc /nologo /platform:x64 /warnaserror+ /define:OWNER_PROFILE_TEST "/out:$exe" $fixture $source 2>&1)
$compileStatus = $LASTEXITCODE
$compileOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'compile.log')
if ($compileStatus -ne 0) { $compileOutput; throw "profile fixture compile failed; evidence: $run" }
$testOutput = @(& $exe 2>&1)
$testStatus = $LASTEXITCODE
$testOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'runner.log')
$testOutput
if ($testStatus -ne 0) { throw "profile fixture failed with exit $testStatus; evidence: $run" }
$watchCompile = @(& $csc /nologo /platform:x64 /warnaserror+ /define:OWNER_PROFILE_TEST "/out:$watchdogExe" $watchdogFixture $source $nativeLaunch 2>&1)
$watchCompileStatus = $LASTEXITCODE
$watchCompile | Out-String | Set-Content -LiteralPath (Join-Path $run 'watchdog-compile.log')
if ($watchCompileStatus -ne 0) { $watchCompile; throw "watchdog fixture compile failed; evidence: $run" }
$watchOutput = @(& $watchdogExe 2>&1)
$watchStatus = $LASTEXITCODE
$watchOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'watchdog-runner.log')
$watchOutput
if ($watchStatus -ne 0) { throw "watchdog fixture failed with exit $watchStatus; evidence: $run" }
$attributeCompile = @(& $csc /nologo /platform:x64 /warnaserror+ /define:OWNER_PROFILE_TEST "/out:$attributeExe" $attributeFixture $source 2>&1)
$attributeCompileStatus = $LASTEXITCODE
$attributeCompile | Out-String | Set-Content -LiteralPath (Join-Path $run 'attribute-compile.log')
if ($attributeCompileStatus -ne 0) { $attributeCompile; throw "attribute probe compile failed; evidence: $run" }
$attributeOutput = @(& $attributeExe 2>&1)
$attributeStatus = $LASTEXITCODE
$attributeOutput | Out-String | Set-Content -LiteralPath (Join-Path $run 'attribute-runner.log')
$attributeOutput
if ($attributeStatus -ne 0) { throw "attribute probe failed with exit $attributeStatus; evidence: $run" }
$after = @($inputs | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
for ($index=0; $index -lt $before.Count; $index++) { if ($before[$index] -ne $after[$index]) { throw "profile fixture sources changed during run; evidence: $run" } }
"Source SHA256: $($before[0]); fixture SHA256: $($before[1]); evidence: $run"
