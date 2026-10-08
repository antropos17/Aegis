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

# Connected regression: actual host staging AST -> actual guest validator AST.
function Test-CloudGuestTransferManifest([string]$SourceRoot, [string]$VmSourcePath) {
    $labPath = Join-Path $SourceRoot 'cloud-guest-lab.ps1'
    $tokens = $null; $errors = $null
    $labAst = [Management.Automation.Language.Parser]::ParseFile($labPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'transfer-lab-source-unavailable' }
    function FindStage([string]$Name) {
        $matches = @($labAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and
            $node.CommandElements.Count -eq 3 -and $node.CommandElements[0].Extent.Text -ceq 'Stage' -and
            $node.CommandElements[1] -is [Management.Automation.Language.StringConstantExpressionAst] -and
            $node.CommandElements[1].Value -ceq $Name }, $true))
        if ($matches.Count -ne 1) { throw 'transfer-producer-stage-unavailable' }
        return $matches[0].CommandElements[2].ScriptBlock
    }
    $producer = FindStage 'stage-fixed-runtime-and-host-controls'
    $compile = FindStage 'compile-fixed-native-helpers'
    $compileStatements = @($compile.EndBlock.Statements | Where-Object { $_.Extent.Text -match '^\$guestDll = Compile|^Copy-Item -LiteralPath \$guestDll' })
    if ($compileStatements.Count -ne 2) { throw 'transfer-compiled-output-unavailable' }
    $owned = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-transfer-' + [guid]::NewGuid().ToString('N'))
    foreach ($leaf in @('', 'transfer', 'temp', 'canaries', 'native')) { New-Item -ItemType Directory -Path (Join-Path $owned $leaf) | Out-Null }
    $OutputRoot = $owned; $report = @{ runtime = $null; claudeProvenance = $null; sourceHashes = @{} }
    $fakeNode = Join-Path $owned 'source-node.exe'; [IO.File]::WriteAllBytes($fakeNode, [byte[]]@(1))
    $compiledSources = @()
    function Compile([string]$Leaf, [string[]]$Sources, [string[]]$References) {
        foreach ($relative in $Sources) { if (!(Test-Path -LiteralPath (Join-Path ([IO.Path]::GetFullPath((Join-Path $SourceRoot '../..'))) $relative))) { throw 'transfer-compiler-input-unavailable' } }
        $script:transferCompilerSources = @($Sources)
        $path = Join-Path $owned ('native\' + $Leaf); [IO.File]::WriteAllBytes($path, [byte[]]@(2)); return $path
    }
    function Get-Command { param($Name, $CommandType) if ($Name -cne 'node.exe') { throw 'transfer-unexpected-command' }; return [pscustomobject]@{ Source = $fakeNode } }
    function Invoke-CloudGuestNativeProcess($Binary, $Arguments, $Out, $Err, $Timeout) {
        if ($Binary -cne $fakeNode -or ($Arguments -join ',') -cne '--version') { throw 'transfer-unexpected-process' }
        [IO.File]::WriteAllText($Out, 'v22.23.3'); [IO.File]::WriteAllText($Err, ''); return 0
    }
    function Save-CloudGuestClaudeBinary($Transfer, $Scratch) { [IO.File]::WriteAllBytes((Join-Path $Transfer 'claude.exe'), [byte[]]@(3)); return @{ passed = $true } }
    function Save-CloudGuestGitArchive($Path) { [IO.File]::WriteAllBytes($Path, [byte[]]@(4)) }
    foreach ($statement in $compileStatements) { . ([scriptblock]::Create($statement.Extent.Text)) }
    # The copied source lists and manifest generator remain the actual maintained
    # statements. Only upstream process/download/Git qualification effects are stubs.
    $producerText = ($producer.EndBlock.Statements | ForEach-Object {
        if ($_.Extent.Text -match "^& \(Join-Path \`$PSScriptRoot 'test-cloud-guest-git") { ' $null = $null ' }
        else { $_.Extent.Text }
    }) -join "`n"
    $producerText = $producerText.Replace('$PSScriptRoot', ("'" + $SourceRoot.Replace("'", "''") + "'"))
    . ([scriptblock]::Create($producerText))
    $manifestPath = Join-Path $owned 'transfer\manifest.json'
    $generated = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $names = @($generated.files | ForEach-Object name)
    foreach ($name in @('guest-process.dll', 'node.exe', 'claude.exe', 'git-runtime.zip', 'git-runtime-manifest.json',
        'claude-sum.test.cjs', 'claude-test-witness-runtime.cjs', 'claude-test-witness.cjs')) {
        if ($names -cnotcontains $name) { throw 'transfer-current-producer-leaf-missing' }
    }
    $vmAst = [Management.Automation.Language.Parser]::ParseFile($VmSourcePath, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'transfer-validator-source-unavailable' }
    $validators = @($vmAst.FindAll({ param($node) $node -is [Management.Automation.Language.ScriptBlockExpressionAst] -and
        $node.ScriptBlock.EndBlock.Statements.Count -gt 0 -and $node.ScriptBlock.EndBlock.Statements[0].Extent.Text -match '^\$trusted =' -and
        $node.Extent.Text.Contains('guest-transfer-manifest-invalid') }, $true))
    if ($validators.Count -ne 1) { throw 'transfer-validator-source-unavailable' }
    $validation = ($validators[0].ScriptBlock.EndBlock.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"
    $validation = $validation.Replace("'C:\ProgramData\AegisCloudLab\trusted'", ("'" + (Join-Path $owned 'transfer').Replace("'", "''") + "'"))
    $original = $validation.Replace(", 'claude-sum.test.cjs'", '')
    function Validate([string]$Text) {
        $expected = $null
        try { . ([scriptblock]::Create($Text)); return @{ passed = $true; code = $null; leaf = $null } }
        catch { return @{ passed = $false; code = $_.Exception.Message; leaf = $(if ($null -ne $expected) { $expected.name } else { $null }) } }
    }
    $before = Validate $original
    if ($before.passed -or $before.code -cne 'guest-transfer-manifest-invalid' -or $before.leaf -cne 'claude-sum.test.cjs') { throw 'transfer-original-contract-defect-not-reproduced' }
    if (!(Validate $validation).passed) { throw 'transfer-current-generated-manifest-refused' }
    $checks = 2
    foreach ($name in @('../claude-sum.test.cjs', '..\claude-sum.test.cjs', 'other.test.cjs', 'CLAUDE-sum.test.cjs', 'claude-sum.test.cjs.extra', 'claude-sum.test.cjs/child')) {
        $generated.files[0].name = $name
        [IO.File]::WriteAllText($manifestPath, ($generated | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
        $denied = Validate $validation
        if ($denied.passed -or $denied.code -cne 'guest-transfer-manifest-invalid') { throw 'transfer-arbitrary-or-escape-name-accepted' }; $checks++
    }
    $generated.files[0].name = $names[0]; $originalHash = $generated.files[0].sha256
    $generated.files[0].sha256 = '0' * 64
    [IO.File]::WriteAllText($manifestPath, ($generated | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    if ((Validate $validation).code -cne 'guest-transfer-hash-mismatch') { throw 'transfer-hash-control-lost' }; $checks++
    $generated.files[0].sha256 = 'invalid'
    [IO.File]::WriteAllText($manifestPath, ($generated | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    if ((Validate $validation).code -cne 'guest-transfer-manifest-invalid') { throw 'transfer-hash-shape-control-lost' }; $checks++
    $generated.files[0].sha256 = $originalHash
    [IO.File]::WriteAllText($manifestPath, ($generated | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    $result = @{ scope = 'actual-current-producer-to-guest-validator-pure-contract'; cases = $checks; passed = $checks;
        shellVersion = $PSVersionTable.PSVersion.ToString(); files = $names; plannedGuestDllSources = @($script:transferCompilerSources);
        originalRefusedLeaf = $before.leaf; nativeCompiled = $false; nativeProcessExecuted = $false; downloads = 0; vmEffects = $false;
        ownedFixtureRoot = $owned; producerSha256 = (Get-FileHash -LiteralPath $labPath -Algorithm SHA256).Hash.ToLowerInvariant();
        validatorSha256 = (Get-FileHash -LiteralPath $VmSourcePath -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText((Join-Path $owned 'result.json'), ($result | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    return $result
}
Test-CloudGuestTransferManifest $PSScriptRoot (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1') | ConvertTo-Json -Compress -Depth 4

function Test-CloudGuestReadinessDiagnostics([string]$VmSourcePath) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($VmSourcePath, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'readiness-source-parser-refused' }
    foreach ($name in @('New-CloudGuestReadinessObservation', 'Step-CloudGuestReadinessAttempt', 'Add-CloudGuestReadinessFailure')) {
        $definition = @($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $true) | Where-Object Name -ceq $name)
        if ($definition.Count -ne 1) { throw 'readiness-helper-seam-refused' }
        . ([scriptblock]::Create($definition[0].Extent.Text))
    }
    $loops = @($ast.FindAll({param($node) $node -is [Management.Automation.Language.WhileStatementAst] -and $node.Extent.Text.StartsWith('while ($watch.Elapsed.TotalSeconds -lt 1080)')}, $true))
    $guards = @($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.Contains("throw 'guest-setup-psdirect-not-ready'")}, $true))
    if ($loops.Count -ne 1 -or $guards.Count -ne 1) { throw 'readiness-loop-seam-refused' }
    $loop = [scriptblock]::Create($loops[0].Extent.Text + "`n" + $guards[0].Extent.Text + "`nreturn `$session")
    $checks = [Collections.Generic.List[bool]]::new()
    function NeedReadiness([bool]$Value) { if (!$Value) { throw 'readiness-behavior-control-refused' }; $checks.Add($true) }
    function RunReadinessModel([string]$Mode, [double]$Start = 0) {
        $state = @{ sessionCalls = 0; profileCalls = 0; removed = 0; sleeps = 0; downstream = 0 }
        $watch = @{ Elapsed = @{ TotalSeconds = $Start } }; $lastDisk = -60
        $diskSamples = [Collections.Generic.List[object]]::new()
        $progress = @{ sessionEstablished = $false; profileReady = $false; psDirectReadiness = (New-CloudGuestReadinessObservation) }
        $session = $null; $Admin = $null; $Id = '11111111-2222-3333-4444-555555555555'; $VmRoot = 'X:\fixed-test-only'
        function Get-PSDrive { param($Name) return @{ Free = 32GB } }
        function Get-Item { param($LiteralPath, [switch]$Force) return @{ PSIsContainer = $false; Attributes = 0; Length = 4096L } }
        function New-PSSession {
            param($VMId, $Credential, $ErrorAction)
            $state.sessionCalls++
            if ($Mode -in @('session-errors', 'unknown-error') -or ($Mode -eq 'recover' -and $state.sessionCalls -le 2) -or
                ($Mode -eq 'sticky' -and $state.sessionCalls -gt 1)) {
                $exception = if ($Mode -eq 'unknown-error') { [IO.IOException]::new('SECRET_MESSAGE C:\SECRET_PATH') } else { [UnauthorizedAccessException]::new('SECRET_MESSAGE C:\SECRET_PATH') }
                throw [Management.Automation.ErrorRecord]::new($exception, 'SECRET_FQID', [Management.Automation.ErrorCategory]::OpenError, 'SECRET_USERNAME')
            }
            if ($Mode -eq 'session-late') { $watch.Elapsed.TotalSeconds = 1080 }
            return @{ fixedTestSession = $true }
        }
        function Invoke-Command {
            param($Session, $ScriptBlock)
            $state.profileCalls++
            if ($Mode -eq 'profile-errors') { throw [InvalidOperationException]::new('SECRET_MESSAGE C:\SECRET_PATH') }
            if ($Mode -in @('profile-false', 'sticky')) { return $false }
            if ($Mode -eq 'profile-late') { $watch.Elapsed.TotalSeconds = 1081 }
            if ($Mode -eq 'profile-boundary') { $watch.Elapsed.TotalSeconds = 1080 }
            if ($Mode -eq 'profile-before-boundary') { $watch.Elapsed.TotalSeconds = 1079.999 }
            return $true
        }
        function Remove-PSSession { param($Session, $ErrorAction) $state.removed++ }
        function Start-Sleep { param($Seconds) if ($Seconds -ne 10) { throw 'readiness-poll-changed' }; $state.sleeps++; $watch.Elapsed.TotalSeconds += 360 }
        $refused = $false
        try { $retained = & $loop; if ($null -ne $retained) { $state.downstream++ } }
        catch { if ($_.Exception.Message -cne 'guest-setup-psdirect-not-ready') { throw }; $refused = $true }
        return @{ state = $state; progress = $progress; refused = $refused }
    }
    $never = RunReadinessModel 'session-errors'
    NeedReadiness ($never.refused -and !$never.progress.sessionEstablished -and !$never.progress.profileReady -and $never.state.profileCalls -eq 0 -and $never.state.downstream -eq 0)
    NeedReadiness ($never.progress.psDirectReadiness.attempts -eq 3 -and $never.progress.psDirectReadiness.failures -eq 3 -and $never.progress.psDirectReadiness.deadlineExpired)
    NeedReadiness ($never.progress.psDirectReadiness.firstFailure.attempt -eq 1 -and $never.progress.psDirectReadiness.lastFailure.attempt -eq 3 -and $never.progress.psDirectReadiness.lastFailure.phase -ceq 'SessionCreate')
    NeedReadiness ($never.progress.psDirectReadiness.firstFailure.hresult -is [int] -and $never.progress.psDirectReadiness.firstFailure.category -ceq 'OpenError')
    $falseProfile = RunReadinessModel 'profile-false'
    NeedReadiness ($falseProfile.refused -and $falseProfile.progress.sessionEstablished -and !$falseProfile.progress.profileReady -and $falseProfile.state.removed -eq 3 -and $falseProfile.state.downstream -eq 0)
    NeedReadiness ($falseProfile.progress.psDirectReadiness.lastFailure.phase -ceq 'ProfileCheck' -and $falseProfile.progress.psDirectReadiness.lastFailure.category -ceq 'ProfileNotReady' -and $null -eq $falseProfile.progress.psDirectReadiness.lastFailure.hresult)
    $profileError = RunReadinessModel 'profile-errors'
    NeedReadiness ($profileError.refused -and $profileError.progress.sessionEstablished -and !$profileError.progress.profileReady -and $profileError.state.removed -eq 3)
    NeedReadiness ($profileError.progress.psDirectReadiness.firstFailure.phase -ceq 'ProfileCheck' -and $profileError.progress.psDirectReadiness.firstFailure.exceptionKind -ceq 'InvalidOperationException')
    $sticky = RunReadinessModel 'sticky'
    NeedReadiness ($sticky.refused -and $sticky.progress.sessionEstablished -and !$sticky.progress.profileReady -and $sticky.state.removed -eq 1 -and $sticky.state.downstream -eq 0)
    NeedReadiness ($sticky.progress.psDirectReadiness.firstFailure.phase -ceq 'ProfileCheck' -and $sticky.progress.psDirectReadiness.lastFailure.phase -ceq 'SessionCreate')
    $recover = RunReadinessModel 'recover'
    NeedReadiness (!$recover.refused -and $recover.progress.sessionEstablished -and $recover.progress.profileReady -and $recover.state.downstream -eq 1 -and $recover.state.removed -eq 0)
    NeedReadiness ($recover.progress.psDirectReadiness.attempts -eq 3 -and $recover.progress.psDirectReadiness.failures -eq 2 -and !$recover.progress.psDirectReadiness.deadlineExpired)
    $unknown = RunReadinessModel 'unknown-error'
    NeedReadiness ($unknown.progress.psDirectReadiness.lastFailure.exceptionKind -ceq 'Other')
    $serialized = @($never, $falseProfile, $profileError, $sticky, $recover, $unknown) | ForEach-Object { $_.progress.psDirectReadiness } | ConvertTo-Json -Depth 6
    NeedReadiness ($serialized -notmatch 'SECRET_|Message|FQID|Username|TargetObject|C:\\SECRET')
    foreach ($mode in @('session-late', 'profile-late', 'profile-boundary')) {
        $late = RunReadinessModel $mode 1079
        NeedReadiness ($late.refused -and $late.progress.sessionEstablished -and $late.state.removed -eq 1 -and $late.state.downstream -eq 0 -and $late.progress.psDirectReadiness.deadlineExpired)
        NeedReadiness (!$late.progress.profileReady -and $late.progress.psDirectReadiness.profileReadyObservedAfterDeadline -eq ($mode -ne 'session-late'))
    }
    $before = RunReadinessModel 'profile-before-boundary' 1079
    NeedReadiness (!$before.refused -and $before.progress.profileReady -and $before.state.downstream -eq 1 -and $before.state.removed -eq 0)
    $expired = RunReadinessModel 'recover' 1080
    NeedReadiness ($expired.refused -and $expired.state.sessionCalls -eq 0 -and $expired.state.downstream -eq 0)
    $bounded = New-CloudGuestReadinessObservation; $bounded.attempts = 4094; $bounded.failures = 4094
    Step-CloudGuestReadinessAttempt $bounded; Add-CloudGuestReadinessFailure $bounded 'ProfileCheck' $null
    $first = $bounded.firstFailure
    Step-CloudGuestReadinessAttempt $bounded; Add-CloudGuestReadinessFailure $bounded 'SessionCreate' ([Management.Automation.ErrorRecord]::new([TimeoutException]::new('SECRET'), 'SECRET', [Management.Automation.ErrorCategory]::OperationTimeout, $null))
    NeedReadiness ($bounded.attempts -eq 4095 -and $bounded.failures -eq 4095 -and $bounded.attemptsCapped -and $bounded.failuresCapped)
    NeedReadiness ([object]::ReferenceEquals($first, $bounded.firstFailure) -and $bounded.lastFailure.phase -ceq 'SessionCreate')
    NeedReadiness ($bounded.lastFailure.Keys.Count -eq 5 -and $bounded.Keys.Count -eq 8 -and ($bounded | ConvertTo-Json -Depth 5).Length -lt 2048)
    return @{ kind = 'source-extracted-psdirect-readiness-controls'; checks = $checks.Count; powerShell = $PSVersionTable.PSVersion.ToString();
        vmEffects = $false; guestCommandsExecuted = $false; nativeExecuted = $false; sourceSha256 = (Get-FileHash -LiteralPath $VmSourcePath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
Test-CloudGuestReadinessDiagnostics (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1') | ConvertTo-Json -Compress
