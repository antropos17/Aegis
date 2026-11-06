$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base = Join-Path $root '.task-temp/owner-console-nested'
$run = Join-Path $base ('run-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $run | Out-Null
$env:TEMP = $run
$env:TMP = $run
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$native = Join-Path $run 'aegis-mcpjob.exe'
$outerExe = Join-Path $run 'outer-job.exe'
$sources = @(Get-ChildItem (Join-Path $root 'sidecar/mcpjob') -Filter '*.cs' | ForEach-Object FullName)
& $csc /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ /reference:System.Web.Extensions.dll "/out:$native" $sources
if ($LASTEXITCODE -ne 0) { throw "mcpjob compilation failed: $LASTEXITCODE" }
& $csc /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ "/out:$outerExe" (Join-Path $PSScriptRoot 'OuterJob.cs')
if ($LASTEXITCODE -ne 0) { throw "outer compilation failed: $LASTEXITCODE" }
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$script = Join-Path $PSScriptRoot 'runner.cjs'
function Start-Owner([string]$mode) {
  Start-Process -FilePath $outerExe -ArgumentList @(('"'+$node+'"'),('"'+$script+'"'),('"'+$root+'"'),('"'+$run+'"'),$mode) -WindowStyle Hidden -PassThru
}
function Wait-File([string]$path, [int]$ms) {
  $until = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ([DateTime]::UtcNow -lt $until) { if (Test-Path -LiteralPath $path) { return }; Start-Sleep -Milliseconds 50 }
  throw "fixture output timeout: $path"
}
$owner = $null
try {
  $owner = Start-Owner 'normal'
  if (-not $owner.WaitForExit(15000)) { throw 'normal owner timeout' }
  if ($owner.ExitCode -ne 0) { throw "normal owner failed: $($owner.ExitCode)" }
  $normal = Get-Content (Join-Path $run 'normal-outcome.json') -Raw | ConvertFrom-Json
  if (-not $normal.ready -or $normal.failed -or -not $normal.cleanupConfirmed -or -not $normal.actionOutcome.exited -or $normal.actionOutcome.exitCode -ne 0) { throw 'normal nested helper outcome invalid' }
  $normalPids = @(Get-Content (Join-Path $run 'normal-tree.json') -Raw | ConvertFrom-Json)
  if ($normalPids.Count -ne 2 -or @($normalPids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -ne 0) { throw 'normal action tree remains' }
  $owner = Start-Owner 'running'
  Wait-File (Join-Path $run 'running-runner-pid.txt') 10000
  Wait-File (Join-Path $run 'running-helper-pid.txt') 10000
  Wait-File (Join-Path $run 'running-tree.json') 10000
  $ids = @([int](Get-Content (Join-Path $run 'running-runner-pid.txt') -Raw), [int](Get-Content (Join-Path $run 'running-helper-pid.txt') -Raw)) + @(Get-Content (Join-Path $run 'running-tree.json') -Raw | ConvertFrom-Json)
  if ($ids.Count -ne 4) { throw 'wrong number of running processes' }
  $held = @($ids | ForEach-Object { $p = Get-Process -Id $_; @{ Id=$p.Id; Start=$p.StartTime } })
  Stop-Process -Id $owner.Id -Force
  $owner.WaitForExit()
  $until = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $remaining = @($held | Where-Object { $p = Get-Process -Id $_.Id -ErrorAction SilentlyContinue; $p -and $p.StartTime -eq $_.Start })
    if ($remaining.Count -eq 0) { break }; Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $until)
  if ($remaining.Count -ne 0) { throw "processes remained after owner death: $($remaining.Id -join ',')" }
  "PASS actual mcpjob nested Job completed, confirmed cleanup and action tree exited; outer owner forced death: runner/helper/action/descendant exited; run=$run" | Tee-Object -FilePath (Join-Path $run 'result.txt')
} catch {
  "FAIL $($_.Exception.Message) run=$run" | Tee-Object -FilePath (Join-Path $run 'result.txt')
  throw
} finally {
  if ($owner) { $owner.Refresh(); if (-not $owner.HasExited) { Stop-Process -Id $owner.Id -Force; $owner.WaitForExit() } }
}
