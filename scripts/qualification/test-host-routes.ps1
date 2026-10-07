param([string]$SupportRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
$script:controls = 0
function Require([bool]$Value) { if (!$Value) { throw ('host-route-control-failed-' + ($script:controls + 1)) }; $script:controls++ }
function Refused([scriptblock]$Operation) { try { & $Operation | Out-Null; return $false } catch { return $true } }
function Assert-CloudGuestRunner { throw 'test-cloud-scope-unavailable' }
. (Join-Path $SupportRoot 'cloud-host-routes.ps1')
# Effectful production entries stop at the cloud guard, before PID/VM/socket work.
Require (Refused { Get-CloudHostRouteSnapshot 'bad' 'bad' 'bad' })
Require (Refused { Get-CloudHostRouteAddresses })
Require (Refused { New-CloudHostRouteProcess 'bad' 'bad' $true })
Require (Refused { Start-CloudHostRoutes 'bad' 'bad' 'bad' 'bad' 'bad' 'bad' })
Require (Refused { Stop-CloudHostRoutes $null $true })
Require (Refused { Test-CloudHostRoutes $null $null $null $null $false $null })
$done = [Threading.Tasks.TaskCompletionSource[string]]::new(); $done.SetResult('fixed')
$watch = [Diagnostics.Stopwatch]::StartNew()
Require ((Read-CloudHostRouteLine $done.Task $watch 1000 5) -ceq 'fixed')
Require (Refused { Read-CloudHostRouteLine $done.Task $watch 1000 4 })
$pending = [Threading.Tasks.TaskCompletionSource[string]]::new()
Require (Refused { Read-CloudHostRouteLine $pending.Task $watch 5 100 })
$missing = [Threading.Tasks.TaskCompletionSource[string]]::new(); $missing.SetResult($null)
Require (Refused { Read-CloudHostRouteLine $missing.Task $watch 1000 100 })
$faulted = [Threading.Tasks.TaskCompletionSource[string]]::new(); $faulted.SetException([InvalidOperationException]::new('secret-model'))
Require (Refused { Read-CloudHostRouteLine $faulted.Task $watch 1000 100 })
$watch.Stop()
# Deterministic process/stdio doubles exercise the real cleanup helper, with no
# launched process, account, VM, or ACL. Guard bypass is scoped to this test only.
Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class RouteProcessDouble {
 public StringWriter StandardInput = new StringWriter();
 public StringReader StandardOutput = new StringReader("");
 public bool HasExited = true, WaitResult = true, Killed, Disposed;
 public int ExitCode;
 public bool WaitForExit(int timeout) { return WaitResult || Killed; }
 public void Kill() { Killed = true; HasExited = true; }
 public void Dispose() { Disposed = true; }
}
public sealed class RouteWatchDouble { public long ElapsedMilliseconds; public void Stop() {} }
'@
function Assert-CloudGuestRunner { }
$savedRun = $env:GITHUB_RUN_ID; $savedAttempt = $env:GITHUB_RUN_ATTEMPT
$savedFixture = $env:AEGIS_ROUTE_DRIVER_SNAPSHOT
$env:GITHUB_RUN_ID = '123'; $env:GITHUB_RUN_ATTEMPT = '1'
$tokens = $null; $errors = $null
$lab = [Management.Automation.Language.Parser]::ParseFile((Join-Path $SupportRoot 'cloud-guest-lab.ps1'), [ref]$tokens, [ref]$errors)
Require ($errors.Count -eq 0)
function Assignment([string]$Variable) {
    $matches = @($lab.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -ceq $Variable }, $true))
    if ($matches.Count -ne 1) { throw 'actual-driver-assignment-unavailable' }
    return $matches[0].Right.Extent.Text
}
# Keep the actual producer command expression. A lexical path-provider double
# avoids requiring or creating a local D: drive for Join-Path.
function Join-Path([string]$Path, [string]$ChildPath) { return [IO.Path]::Combine($Path, $ChildPath) }
$OutputRoot = & ([scriptblock]::Create((Assignment 'expectedRoot')))
$generatedName = & ([scriptblock]::Create((Assignment 'name')))
$generatedRoot = & ([scriptblock]::Create((Assignment 'vmRoot')))
$script:ownedVm = [pscustomobject]@{ Id = [guid]'a0000000-0000-0000-0000-000000000000'; Name = $generatedName; ConfigurationLocation = $generatedRoot; State = 'Running' }
$script:nicCount = 0
function Get-VM { param([guid]$Id) return $script:ownedVm }
function Get-VMNetworkAdapter { param($VM) for ($index = 0; $index -lt $script:nicCount; $index++) { [pscustomobject]@{ fixture = $true } } }
$driverSnapshot = Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName $generatedRoot
Require ($driverSnapshot.name -ceq $generatedName -and $driverSnapshot.vmRoot -ceq $generatedRoot)
# V1 rejects this actual producer output before querying its exact GUID.
Require ($generatedName -cnotmatch '^aegis-cloud-guest-[0-9]+-[0-9]+$')
Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName ('D:\' + $generatedName + '\vm') })
Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() 'aegis-cloud-999-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' $generatedRoot })
Require (Refused { Get-CloudHostRouteSnapshot 'b0000000-0000-0000-0000-000000000000' $generatedName $generatedRoot })
$ownedVm.Name = 'foreign'; Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName $generatedRoot }); $ownedVm.Name = $generatedName
$ownedVm.ConfigurationLocation = 'D:\foreign'; Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName $generatedRoot }); $ownedVm.ConfigurationLocation = $generatedRoot
$ownedVm.State = 'Off'; Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName $generatedRoot }); $ownedVm.State = 'Running'
$script:nicCount = 1; Require (Refused { Get-CloudHostRouteSnapshot $ownedVm.Id.ToString() $generatedName $generatedRoot }); $script:nicCount = 0
function Owner([bool]$Exited, [bool]$Wait, [int]$Exit, [long]$Elapsed) {
    $process = [RouteProcessDouble]::new(); $process.HasExited = $Exited; $process.WaitResult = $Wait; $process.ExitCode = $Exit
    $frame = [Threading.Tasks.TaskCompletionSource[string]]::new(); $frame.SetResult('{"schemaVersion":1}')
    $errorText = [Threading.Tasks.TaskCompletionSource[string]]::new(); $errorText.SetResult('')
    $timer = [RouteWatchDouble]::new(); $timer.ElapsedMilliseconds = $Elapsed
    return @{ process = $process; finalLine = $frame.Task; stderr = $errorText.Task; watch = $timer; ownerPid = 123;
        birth = '639115271077711234'; imageSha256 = ('a' * 64) }
}
$held = Owner $true $true 0 2000
$closed = Stop-CloudHostRoutes $held $true
Require ($held.process.StandardInput.ToString() -ceq "stop`n")
Require ($held.process.Disposed -and !$held.process.Killed -and $closed.owner.stopAfterJobClosure -and $closed.owner.exitObserved -and $closed.owner.exitCode -eq 0)
$unknownJob = Owner $true $true 2 2000
$closed = Stop-CloudHostRoutes $unknownJob $false
Require ($unknownJob.process.StandardInput.ToString().Length -eq 0 -and !$closed.owner.stopAfterJobClosure -and $closed.owner.exitCode -eq 2)
$late = Owner $true $true 2 110000
$closed = Stop-CloudHostRoutes $late $true
Require ($late.process.StandardInput.ToString().Length -eq 0 -and $closed.owner.stopMilliseconds -eq 110000)
$unreturned = Owner $false $false 2 2000
Require (Refused { Stop-CloudHostRoutes $unreturned $true })
Require ($unreturned.process.Killed -and $unreturned.process.Disposed)
Write-Output ("host-route PowerShell controls passed: " + $script:controls)
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$fixture = Join-Path $env:TEMP ('aegis-route-driver-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [IO.File]::WriteAllText($fixture, ($driverSnapshot | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    $env:AEGIS_ROUTE_DRIVER_SNAPSHOT = $fixture
    & $node --test (Join-Path $SupportRoot 'test-host-routes.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'host-route-node-controls-failed' }
} finally {
    $env:GITHUB_RUN_ID = $savedRun; $env:GITHUB_RUN_ATTEMPT = $savedAttempt; $env:AEGIS_ROUTE_DRIVER_SNAPSHOT = $savedFixture
    $file = Get-Item -LiteralPath $fixture -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        [IO.Path]::GetFullPath($file.DirectoryName) -cne [IO.Path]::GetFullPath($env:TEMP)) { throw 'driver-fixture-cleanup-refused' }
    Remove-Item -LiteralPath $file.FullName
}
