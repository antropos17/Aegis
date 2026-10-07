Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'cloud-guest-bootstrap.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'bootstrap-diagnostics-parser-failed' }
$definition = $ast.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -ceq 'Get-CloudGuestBootstrapFailure'
if (@($definition).Count -ne 1) { throw 'bootstrap-failure-projection-missing' }
. ([scriptblock]::Create($definition.Extent.Text))
$outer = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($outer.Count -ne 1 -or $outer[0].CatchClauses.Count -ne 1) { throw 'bootstrap-outer-boundary-missing' }
$catchBody = $outer[0].CatchClauses[0].Body.Extent.Text
$script:bootstrapChecks = 0
function CheckBootstrap([bool]$Value, [string]$Code) { if (!$Value) { throw $Code }; $script:bootstrapChecks++ }
function RefuseBootstrap { throw [InvalidOperationException]::new('PASSWORD_SENTINEL C:\PRIVATE_SENTINEL') }
function InvokeBootstrapModel([string]$Stage, [string]$Body, $Identity, $Diagnostics) {
    $bootstrapStage = $Stage; $identity = $Identity; $diagnostics = $Diagnostics; $secretCleanup = $false
    function Get-LocalUser { RefuseBootstrap }
    function Test-Path { return $false }
    function Set-ItemProperty { RefuseBootstrap }
    function New-Item { RefuseBootstrap }
    function Add-Type { RefuseBootstrap }
    function Merge-CloudGuestTaskDiagnostics { RefuseBootstrap }
    function Get-CimInstance { RefuseBootstrap }
    return & ([scriptblock]::Create('try { ' + $Body + ' } catch ' + $catchBody))
}
function StatementMatching([string]$Pattern) {
    $statement = @($outer[0].Body.Statements | Where-Object { $_.Extent.Text -match $Pattern })
    if ($statement.Count -ne 1) { throw 'bootstrap-stage-operation-missing' }; return $statement[0].Extent.Text
}
$models = @(
    @{stage='accounts';body=(StatementMatching '^\$task = Get-LocalUser')},
    @{stage='secret-cleanup';body=(StatementMatching '^Set-ItemProperty')},
    @{stage='acl-setup';body=(StatementMatching '^foreach \(\$directory')},
    @{stage='native-load';body=(StatementMatching '^Add-Type')},
    @{stage='result-diagnostics';body=(StatementMatching '^\$diagnostics = Merge-CloudGuestTaskDiagnostics')},
    @{stage='os-receipt';body=(StatementMatching '^\$os = Get-CimInstance')},
    @{stage='native-run';body='RefuseBootstrap'},
    @{stage='administrator';body='RefuseBootstrap'}
)
foreach ($model in $models) {
    $result = InvokeBootstrapModel $model.stage $model.body $null $null
    CheckBootstrap (!$result.passed -and !$result.task.passed -and !$result.launchAllowed -and $result.bootstrapFailure.stage -ceq $model.stage) 'bootstrap-stage-refusal-lost'
    $json = $result | ConvertTo-Json -Depth 8
    CheckBootstrap (!$json.Contains('PASSWORD_SENTINEL') -and !$json.Contains('PRIVATE_SENTINEL') -and
        $result.bootstrapFailure.hResult -is [int] -and $result.bootstrapFailure.line -is [int] -and $json.Length -lt 8192) 'bootstrap-private-error-exposed'
}
foreach ($closure in @($true, $false)) {
    $identity = @{passed=$false;exitCode=7;exitCodeObserved=$true;jobClosureConfirmed=$closure;pid=123;birthFileTime=[long]456}
    $diagnostics = @{task=@{passed=$true;stage='unit-test';failure=@{stage='unit-test';childExitCode=7}};taskResultStatus='verified'}
    $result = InvokeBootstrapModel 'os-receipt' 'RefuseBootstrap' $identity $diagnostics
    CheckBootstrap (!$result.task.passed -and $result.identity.exitCode -eq 7 -and $result.identity.jobClosureConfirmed -eq $closure -and
        $result.task.failure.childExitCode -eq 7 -and $result.task.stage -ceq 'unit-test') 'bootstrap-masked-native-or-task-failure'
}
$saved = $env:AEGIS_CLOUD_GUEST_LAB
try {
    $env:AEGIS_CLOUD_GUEST_LAB = 'diagnostics-fixture-invalid'
    $result = & ([scriptblock]::Create($source)) -TaskPassword 'PASSWORD_SENTINEL'
    CheckBootstrap (!$result.passed -and !$result.task.passed -and $result.bootstrapFailure.stage -ceq 'scope' -and $null -eq $result.identity) 'actual-scope-entry-refusal-lost'
} finally { $env:AEGIS_CLOUD_GUEST_LAB = $saved }
$result = InvokeBootstrapModel 'PASSWORD_SENTINEL' 'RefuseBootstrap' $null $null
CheckBootstrap ($result.bootstrapFailure.stage -ceq 'bootstrap-unknown') 'unknown-bootstrap-stage-exposed'
if ($bootstrapChecks -ne 20) { throw 'bootstrap-control-count-mismatch' }
@{passed=$true;checks=$bootstrapChecks;scope='AST-mocked-bootstrap-stages-and-actual-scope-refusal';actualLocalAccountAclOrVm=$false;launchAllowed=$false} | ConvertTo-Json -Depth 4

# Execute the real downstream orchestration statements, with file readers that
# can only supply fixed controls. No local process/account/ACL/guest execution.
foreach ($name in @('Merge-CloudGuestTaskDiagnostics', 'Merge-CloudGuestNetworkControls', 'Get-CloudGuestDownstreamState', 'Merge-CloudGuestGitControls')) {
    $found = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false))
    if ($found.Count -ne 1) { throw 'downstream-helper-unavailable' }
    . ([scriptblock]::Create($found[0].Extent.Text))
}
$begin = $source.IndexOf('$downstreamState = Get-CloudGuestDownstreamState')
$end = $source.IndexOf("`$bootstrapStage = 'os-receipt'", $begin)
if ($begin -lt 0 -or $end -lt 0) { throw 'downstream-operation-unavailable' }
$operation = [scriptblock]::Create($source.Substring($begin, $end - $begin))
function RunDownstreamModel($ModelIdentity, [bool]$NetworkPass, [bool]$GitPass) {
    $identity = $ModelIdentity; $root = 'C:\fixed-model'; $trusted = 'C:\fixed-trusted-model'
    $script:downstreamReads = 0
    function Read-CloudGuestTaskDiagnostics { $script:downstreamReads++; return @{ status = 'verified'; task = @{ passed = $true; stage = 'completed' } } }
    function Read-CloudGuestNetworkControls { $script:downstreamReads++; return @{ passed = $NetworkPass; status = 'network-model' } }
    function Read-CloudGuestGitControls { $script:downstreamReads++; return @{ passed = $GitPass } }
    function Read-AdminControl { return 'guest-admin-dummy-control' }
    # Only the dummy admin canary read is substituted in this test model.
    $text = $operation.ToString().Replace("[IO.File]::ReadAllText('C:\ProgramData\AegisCloudLab\admin\dummy.txt')", '(Read-AdminControl)')
    . ([scriptblock]::Create($text))
    return @{ diagnostics = $diagnostics; network = $network; git = $gitControls; gitStatus = $gitStatus; state = $downstreamState; reads = $script:downstreamReads }
}
$earlyIdentity = @{ passed = $false; failureStage = 'held-token-open'; failureHResult = -2146233079; taskReleased = $false; runtimeResumed = $false; jobClosureConfirmed = $false }
$earlyResult = RunDownstreamModel $earlyIdentity $true $true
CheckBootstrap ($earlyResult.reads -eq 0 -and !$earlyResult.diagnostics.passed -and $earlyResult.diagnostics.failureCode -ceq 'guest-task-process-refused' -and
    $earlyResult.diagnostics.identity.failureStage -ceq 'held-token-open' -and $earlyResult.diagnostics.identity.failureHResult -eq -2146233079) 'early-native-failure-overwritten'
CheckBootstrap ($earlyResult.state -ceq 'not-run' -and $earlyResult.diagnostics.taskResultStatus -ceq 'guest-task-not-run' -and
    $earlyResult.diagnostics.task.stage -ceq 'not-run' -and $earlyResult.network.status -ceq 'network-controls-not-run' -and
    $earlyResult.gitStatus -ceq 'git-controls-not-run' -and !$earlyResult.network.passed -and !$earlyResult.git.passed) 'downstream-not-run-lost'
foreach ($released in @($true, 'true', $null)) {
    $unknownIdentity = @{ passed = $false; taskReleased = $released; jobClosureConfirmed = $false }
    $unknownResult = RunDownstreamModel $unknownIdentity $true $true
    $expected = if ($released -is [bool]) { 'unavailable-closure-unknown' } else { 'unavailable-release-unconfirmed' }
    CheckBootstrap ($unknownResult.reads -eq 0 -and $unknownResult.state -ceq $expected -and !$unknownResult.diagnostics.passed -and
        $unknownResult.diagnostics.failureCode -ceq 'guest-task-process-refused') 'unknown-observation-became-success-or-not-run'
}
$ready = @{ passed = $true; taskReleased = $true; jobClosureConfirmed = $true; runtimeResumed = $true; runtimeCallerAuthenticated = $true;
    runtimeInitializedBeforeProject = $true; networkReceiverStartedAfterRuntimeReady = $true; exitCodeObserved = $true; exitCode = 0;
    heldIdentityBeforeRelease = $true; elevated = $false; administratorEnabled = $false }
foreach ($pair in @(@($true, $true), @($false, $true), @($true, $false), @($false, $false))) {
    $merged = RunDownstreamModel $ready $pair[0] $pair[1]
    $expected = if (!$pair[0]) { 'guest-network-controls-refused' } elseif (!$pair[1]) { 'guest-git-controls-refused' } else { $null }
    CheckBootstrap ($merged.reads -eq 3 -and $merged.diagnostics.failureCode -ceq $expected -and
        $merged.diagnostics.passed -eq ($pair[0] -and $pair[1]) -and $merged.diagnostics.task.passed -eq ($pair[0] -and $pair[1])) 'downstream-failure-order-or-positive-control-lost'
}
$result = InvokeBootstrapModel 'os-receipt' 'RefuseBootstrap' $earlyIdentity $earlyResult.diagnostics
CheckBootstrap ($result.failureCode -ceq 'guest-task-process-refused' -and $result.identity.failureStage -ceq 'held-token-open' -and
    $result.bootstrapFailure.stage -ceq 'os-receipt' -and $result.downstreamChecks.state -ceq 'not-run') 'later-bootstrap-failure-overwrote-native-cause'
@{ passed = $true; checks = $bootstrapChecks - 20; scope = 'pure-native-first-downstream-cause-ordering'; nativeOrGuestEffects = $false } | ConvertTo-Json -Compress
# Models execute the actual connected VM completion helper. Stubs represent only
# remote task-file reading and retained receiver/VM observations; no native effects.
$vmAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-vm.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'route-completion-source-parse-refused' }
foreach ($name in @('Get-CloudGuestResultField', 'Get-CloudGuestNativeResultFailure', 'Complete-CloudGuestHostRouteObservation')) {
    $definition = $vmAst.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -ceq $name
    if (@($definition).Count -ne 1) { throw 'route-completion-helper-missing' }; . ([scriptblock]::Create($definition.Extent.Text))
}
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$routeChecks = 0
function NeedRoute([bool]$Value) { if (!$Value) { throw 'route-completion-control-refused' }; $script:routeChecks++ }
function InvokeRouteModel($Native, [string]$Fault = '') {
    $script:routeStops = 0; $script:routeSnapshots = 0; $script:routeReads = 0; $script:routeOracles = 0; $script:routeJobClosed = $null
    function Stop-CloudHostRoutes($Owner, [bool]$JobClosed) {
        $script:routeStops++; $script:routeJobClosed = $JobClosed
        if ($Fault -ceq 'stop') { throw 'host-route-exit-unconfirmed' }
        return @{ owner = @{ closed = $true; exitObserved = $true; exitCode = $(if ($Fault -ceq 'exit') { 7 } else { 0 }); forced = $false; stopAfterJobClosure = $JobClosed };
            receiver = @{ socketsClosed = $true; stoppedOnRequest = $true; positivePassed = $true; expired = $false } }
    }
    function Get-CloudHostRouteSnapshot($Id, $Name, $Root, [ref]$Diagnostic) {
        $script:routeSnapshots++; $Diagnostic.Value = @{ reason = 'confirmed' }
        if ($Fault -ceq 'snapshot') { throw 'host-route-owned-vm-refused' }
        return @{ vmId = $Id; state = 'Running'; nics = 0 }
    }
    function Invoke-Command($Session, $ScriptBlock) { $script:routeReads++; if ($Fault -ceq 'read') { throw 'PASSWORD_SENTINEL' }; return '{}' }
    function Test-CloudHostRoutes($Owner, $Closed, $Identity, $Client, $Passed, $After) {
        $script:routeOracles++; if ($Fault -ceq 'oracle') { throw 'host-route-oracle-refused' }
        return @{ passed = $true; status = 'verified'; owner = $Closed.owner; receiver = $Closed.receiver }
    }
    $owner = @{ before = @{ state = 'Running'; nics = 0 } }; $closed = $null; $after = $null
    $value = Complete-CloudGuestHostRouteObservation @{ identity = $Native; passed = $Native.passed } $owner '00000000-0000-0000-0000-000000000001' 'fixed-owned-model' 'X:\fixed-model' 'fixed-session' ([ref]$closed) ([ref]$after)
    NeedRoute ($script:routeStops -eq 1 -and $script:routeSnapshots -eq 1)
    return $value
}
$native = @{ passed = $false; taskReleased = $false; jobClosureConfirmed = $true; failureStage = 'held-token-open'; failureHResult = -2146233079 }
$value = InvokeRouteModel $native
NeedRoute ($value.failure.code -ceq 'guest-task-process-refused' -and $value.failure.nativeStage -ceq 'held-token-open' -and $value.evidence.status -ceq 'not-run' -and !$value.evidence.passed -and $value.evidence.independentClosureConfirmed -and $script:routeReads -eq 0 -and $script:routeOracles -eq 0 -and $script:routeJobClosed)
foreach ($fault in @('stop', 'snapshot', 'exit')) {
    $value = InvokeRouteModel $native $fault
    NeedRoute ($value.failure.nativeStage -ceq 'held-token-open' -and $null -ne $value.downstreamFailure -and !$value.evidence.passed -and $script:routeReads -eq 0)
}
foreach ($released in @($null, 'true', 'false')) {
    $native.taskReleased = $released; $value = InvokeRouteModel $native
    NeedRoute ($value.evidence.status -ceq 'unavailable-release-unconfirmed' -and !$value.evidence.passed -and $script:routeReads -eq 0 -and $value.failure.nativeStage -ceq 'held-token-open')
}
$native.taskReleased = $true; $native.jobClosureConfirmed = 'true'; $value = InvokeRouteModel $native
NeedRoute (!$script:routeJobClosed -and $value.evidence.status -ceq 'unavailable-closure-unknown' -and $script:routeReads -eq 0)
$native.jobClosureConfirmed = $true
foreach ($fault in @('read', 'oracle')) {
    $value = InvokeRouteModel $native $fault
    NeedRoute ($value.failure.nativeStage -ceq 'held-token-open' -and !$value.evidence.passed -and $script:routeReads -eq 1)
}
$native.passed = $true; $native.failureStage = $null; $value = InvokeRouteModel $native
NeedRoute ($value.evidence.passed -and $null -eq $value.failure -and $script:routeReads -eq 1 -and $script:routeOracles -eq 1 -and $value.evidence.independentClosureConfirmed)
$native.taskReleased = $false; $value = InvokeRouteModel $native
NeedRoute (!$value.evidence.passed -and $value.failure.code -ceq 'guest-controls-unconfirmed' -and $script:routeReads -eq 0)
$native.passed = $false; $native.failureStage = 'PASSWORD_SENTINEL'; $value = InvokeRouteModel $native
NeedRoute ($value.failure.nativeStage -ceq 'unknown' -and ($value | ConvertTo-Json -Depth 8) -cnotmatch 'PASSWORD_SENTINEL')
@{ scope = 'actual-host-route-completion-pure-models'; passed = $routeChecks; cases = $routeChecks; nativeEffects = $false } | ConvertTo-Json -Compress
