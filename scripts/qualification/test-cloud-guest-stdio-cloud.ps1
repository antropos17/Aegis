param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-stdio.ps1')
$sid = 'S-1-5-21-1-2-3-1001'
$value = @{ schemaVersion = 1; kind = 'fixed-cloud-stdio'; passed = $true; cases = @(); failureStage = $null;
    inputsHeldThroughClosure = $true; newReceiversStarted = $false; e2Qualified = $false; launchAllowed = $false }
foreach ($kind in 1..5) {
    $case = @{ sid = $sid; stdioCase = $kind; pid = [uint32]11; birthFileTime = 12L; stdioHelperPid = [uint32]13; stdioHelperBirthFileTime = 14L;
        failureStage = $null; tokenRequestedAccess = 8; exitCode = [uint32]$(if ($kind -le 2) { 0 } else { 137 });
        stdioInputBytes = 8192; stdioOutputBytes = 0; stdioErrorBytes = 0;
        stdioInputEof = $true; stdioOutputEof = $true; stdioErrorEof = $true; stdioBytesMatched = $kind -le 2;
        stdioNaturalRootExitObserved = $true; stdioRootLiveBeforeTermination = $true; stdioCancellationHeldPayloadAlive = $true;
        stdioCancellationPayloadReadyBeforeTimer = $true; stdioCancellationReadyPayloadPid = [uint32]15; stdioCancellationReadyPayloadBirthFileTime = 16L;
        stdioCancellationReadyPayloadImage = 'C:\ProgramData\AegisCloudLab\trusted\node.exe'; stdioCancellationReadyPayloadSid = $sid;
        stdioCancellationReadyPayloadSession = 0; heldTokenSessionId = 0; stdioCancellationReadyMemberCount = 4; stdioCancellationReadyPayloadIdentityVerified = $true;
        stdioOutcome = $(if ($kind -le 2) { 'Complete' } elseif ($kind -le 4) { 'OutputLimit' } else { 'Cancelled' }) }
    foreach ($field in @('passed', 'runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased',
        'heldIdentityBeforeRelease', 'jobAssignedBeforeAdmission', 'privateDesktopCreated', 'privateDesktopParentRestored',
        'privateDesktopHandlesClosedAfterJobClosure', 'exitCodeObserved', 'jobClosureConfirmed', 'stdioHelperIdentityVerified',
        'stdioRetainedMembersExitObserved', 'stdioPassed', 'ownerNodeVersionPassed')) { $case[$field] = $true }
    foreach ($field in @('administratorGroupPresent', 'administratorEnabled', 'elevated', 'e2Qualified', 'launchAllowed')) { $case[$field] = $false }
    if ($kind -le 2) { $case.stdioOutputBytes = $(if ($kind -eq 1) { 8192 } else { 56192 }); $case.stdioErrorBytes = $(if ($kind -eq 1) { 8192 } else { 48000 }) }
    $value.cases += $case
}
if (!(Test-CloudGuestStdioResult $value $sid)) { throw 'stdio-result-positive-refused' }
$checks = 1
foreach ($mutation in @(@(0,'runtimeCallerAuthenticated',$false), @(0,'taskReleased',$false), @(0,'jobClosureConfirmed',$false),
    @(0,'stdioHelperIdentityVerified',$false), @(0,'stdioRetainedMembersExitObserved',$false), @(0,'stdioBytesMatched',$false),
    @(0,'stdioInputEof',$false), @(0,'stdioOutputBytes',8191), @(1,'stdioErrorBytes',48001), @(1,'stdioOutcome','OutputLimit'),
    @(2,'stdioOutputBytes',1025), @(3,'stdioErrorBytes',1025), @(4,'stdioCancellationHeldPayloadAlive',$false), @(4,'stdioRootLiveBeforeTermination',$false),
    @(4,'stdioCancellationPayloadReadyBeforeTimer',$false), @(4,'stdioCancellationReadyPayloadPid',0), @(4,'stdioCancellationReadyPayloadPid',11),
    @(4,'stdioCancellationReadyPayloadPid',13), @(4,'stdioCancellationReadyPayloadPid','15'), @(4,'stdioCancellationReadyPayloadBirthFileTime',0L),
    @(4,'stdioCancellationReadyPayloadImage','C:\wrong.exe'), @(4,'stdioCancellationReadyPayloadSid','S-1-5-18'), @(4,'stdioCancellationReadyPayloadSession',1),
    @(4,'stdioCancellationReadyMemberCount',2), @(4,'stdioCancellationReadyMemberCount',17), @(4,'stdioCancellationReadyPayloadIdentityVerified',$false),
    @(4,'exitCode',0), @(0,'administratorGroupPresent',$true), @(0,'sid','S-1-5-18'), @(0,'pid','11'), @(0,'stdioHelperBirthFileTime',0),
    @(0,'stdioCase','1'), @(0,'launchAllowed',$true))) {
    $case = $value.cases[$mutation[0]]; $old = $case[$mutation[1]]; $case[$mutation[1]] = $mutation[2]
    try { if (Test-CloudGuestStdioResult $value $sid) { throw 'stdio-result-mutation-admitted' }; $checks++ }
    finally { $case[$mutation[1]] = $old }
}
foreach ($field in @('inputsHeldThroughClosure', 'passed')) {
    $value[$field] = $false
    try { if (Test-CloudGuestStdioResult $value $sid) { throw 'stdio-result-mutation-admitted' }; $checks++ }
    finally { $value[$field] = $true }
}
# Actual controller assignment: stdio refusal or canary mutation cannot preserve aggregate success.
$controllerSource = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-lab.ps1'
$controllerAst = [Management.Automation.Language.Parser]::ParseFile($controllerSource, [ref]$null, [ref]$null)
$controller = @($controllerAst.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$report.passed' }, $true))
if ($controller.Count -ne 1) { throw 'stdio-controller-source-refused' }
# Synthetic installed-owner facts only; no actual installation qualification.
$report = @{ installedOwnerControlsComplete = $true; hostCanariesUnchangedAfterInstalledOwner = $true; ownerLifetimeControlsComplete = $true; hostCanariesUnchangedAfterOwnerLifetime = $true; stdioControlsComplete = $true; hostCanariesUnchangedAfterStdio = $true; cancellationControlsComplete = $true;
    hostCanariesUnchangedAfterCancellation = $true; failure = $null; cleanupFailure = $null; offObserved = $true;
    removedObserved = $true; hostCanariesUnchangedAfterTask = $true; hostCanariesUnchangedAfterRemoval = $true }
$expression = [scriptblock]::Create($controller[0].Right.Extent.Text)
if (!(Invoke-Command -ScriptBlock $expression)) { throw 'stdio-controller-positive-refused' }; $checks++
foreach ($field in @('stdioControlsComplete','hostCanariesUnchangedAfterStdio','cancellationControlsComplete','hostCanariesUnchangedAfterCancellation')) {
    $report[$field] = $false
    try { if (Invoke-Command -ScriptBlock $expression) { throw 'stdio-controller-refusal-lost' }; $checks++ }
    finally { $report[$field] = $true }
}
# Use actual maintained compiler and transfer statements; execute only compiler functions in disposable paths.
$lab = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-lab.ps1'; $tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($lab, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'stdio-lab-source-refused' }
foreach ($name in @('Compile', 'CompileStdioGuest')) {
    $definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true))
    if ($definitions.Count -ne 1) { throw 'stdio-lab-source-refused' }
    . ([scriptblock]::Create($definitions[0].Extent.Text))
}
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$OutputRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-stdio-cloud-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $OutputRoot,(Join-Path $OutputRoot 'native'),(Join-Path $OutputRoot 'transfer') | Out-Null
$project = $ProjectRoot; $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$report = @{ sourceHashes = @{} }
$compileStage = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Stage' -and $node.CommandElements.Count -ge 3 -and $node.CommandElements[1].Extent.Text -ceq "'compile-fixed-native-helpers'" }, $true))
if ($compileStage.Count -ne 1) { throw 'stdio-lab-source-refused' }
$stageText = $compileStage[0].CommandElements[2].ScriptBlock.Extent.Text
# Compile all actual guest-process dependencies and stdio outputs; preceding host-only metadata/VM/download helpers are not stdio consumers.
$start = $stageText.IndexOf('$guestDll = Compile'); if ($start -lt 0) { throw 'stdio-lab-source-refused' }
$selected = $stageText.Substring($start).TrimEnd().TrimEnd('}')
. ([scriptblock]::Create($selected))
foreach ($entry in @(@('guest-process.dll',80KB), @('guest-stdio-host.dll',64KB), @('guest-stdio.exe',64KB))) {
    $file = Get-Item -LiteralPath (Join-Path $OutputRoot ('transfer\' + $entry[0]))
    if ($file.Length -gt $entry[1] -or $file.Length -lt 1) { throw 'stdio-maintained-composition-refused' }
}
$result = @{ schemaVersion = 1; scope = 'actual-source-compiler-plus-synthetic-stdio-receipt-controls'; modelCases = $checks;
    hostedGuestExecuted = $false; nativeStdioPreviouslySeparate = $true; ownedFixtureRoot = $OutputRoot;
    guestBytes = (Get-Item (Join-Path $OutputRoot 'transfer\guest-process.dll')).Length;
    stdioHostBytes = (Get-Item (Join-Path $OutputRoot 'transfer\guest-stdio-host.dll')).Length;
    stdioExecutableBytes = (Get-Item (Join-Path $OutputRoot 'transfer\guest-stdio.exe')).Length; sourceHashes = $report.sourceHashes; passed = $true }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$modelsOut = Join-Path $OutputRoot 'source-models.json'; $modelsErr = $modelsOut + '.error'
$modelCode = Invoke-CloudGuestNativeProcess $node @(('"' + (Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-stdio-cloud.cjs') + '"')) $modelsOut $modelsErr 5000
if ($modelCode -ne 0 -or (Get-Item -LiteralPath $modelsErr).Length -ne 0) { throw 'stdio-source-controls-refused' }
$models = [IO.File]::ReadAllText($modelsOut) | ConvertFrom-Json
if ($models.scope -cne 'synthetic-actual-stdio-runtime-task-source' -or $models.passed -ne 18 -or $models.expectedCases -ne 18 -or $models.guestExecuted -isnot [bool] -or $models.guestExecuted) { throw 'stdio-source-controls-refused' }
$result.runtimeTaskSourceModels = 18
# Execute the maintained fixed-copy loop and manifest producer, then the actual bootstrap
# pinning statements in a disposable trusted directory. Node is a pinning-only byte fixture.
$copyLoops = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and $node.Extent.Text.Contains("'cloud-guest-stdio-bootstrap.ps1'") -and $node.Body.Extent.Text.Contains('Copy-Item') }, $true))
if ($copyLoops.Count -ne 1) { throw 'stdio-transfer-source-refused' }
$transfer = Join-Path $OutputRoot 'transfer'
$qualificationRoot = Join-Path $ProjectRoot 'scripts/qualification'
# A recreated ScriptBlock has an empty automatic PSScriptRoot; bind only its source root.
. ([scriptblock]::Create($copyLoops[0].Extent.Text.Replace('$PSScriptRoot', '$qualificationRoot')))
[IO.File]::WriteAllBytes((Join-Path $transfer 'node.exe'), [byte[]](1,2,3,4))
$labText = [IO.File]::ReadAllText($lab)
$manifestStart = $labText.IndexOf('$files = @(Get-ChildItem -LiteralPath $transfer -File')
$manifestEnd = $labText.IndexOf("`n", $labText.IndexOf("[Text.UTF8Encoding]::new(`$false))", $manifestStart))
if ($manifestStart -lt 0 -or $manifestEnd -le $manifestStart) { throw 'stdio-transfer-source-refused' }
$canaryEntries = @()
. ([scriptblock]::Create($labText.Substring($manifestStart, $manifestEnd - $manifestStart)))
$manifestPath = Join-Path $transfer 'manifest.json'
$savedManifest = [IO.File]::ReadAllText($manifestPath)
$bootstrap = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-stdio-bootstrap.ps1'))
$pinStart = $bootstrap.IndexOf('$manifestFile = Get-Item')
$pinEnd = $bootstrap.IndexOf("`$stage = 'loader'", $pinStart)
if ($pinStart -lt 0 -or $pinEnd -le $pinStart) { throw 'stdio-bootstrap-source-refused' }
$pinning = [scriptblock]::Create($bootstrap.Substring($pinStart, $pinEnd - $pinStart))
$pinCases = 0
foreach ($label in @('positive', 'wrong-hash', 'duplicate', 'oversized', 'missing')) {
    $trusted = $transfer; $held = [Collections.Generic.List[IO.FileStream]]::new()
    [IO.File]::WriteAllText($manifestPath, $savedManifest, [Text.UTF8Encoding]::new($false))
    $target = Join-Path $transfer 'guest-stdio-host.dll'; $savedBytes = [IO.File]::ReadAllBytes($target)
    try {
        if ($label -cin @('wrong-hash','duplicate')) {
            $changed = $savedManifest | ConvertFrom-Json
            if ($label -ceq 'wrong-hash') { ($changed.files | Where-Object name -CEQ 'guest-stdio-host.dll').sha256 = '0' * 64 }
            else { $changed.files = @($changed.files) + @($changed.files | Where-Object name -CEQ 'guest-stdio-host.dll') }
            [IO.File]::WriteAllText($manifestPath,($changed | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        }
        if ($label -ceq 'oversized') { [IO.File]::WriteAllBytes($target, (New-Object byte[] 65537)) }
        if ($label -ceq 'missing') { Remove-Item -LiteralPath $target }
        $refused = $false
        try { . $pinning } catch { $refused = $true }
        if ($label -ceq 'positive') {
            if ($refused -or $held.Count -ne 7) { throw 'stdio-bootstrap-positive-refused' }
            foreach ($stream in $held) {
                $writeRefused = $false
                try { $writer = [IO.File]::Open($stream.Name, 'Open', 'Write', 'ReadWrite'); $writer.Dispose() }
                catch [IO.IOException] { $writeRefused = $true }
                if (!$writeRefused) { throw 'stdio-bootstrap-held-write-admitted' }
            }
        } elseif (!$refused) { throw 'stdio-bootstrap-negative-admitted' }
        $pinCases++
    } finally {
        foreach ($stream in $held) { $stream.Dispose() }
        [IO.File]::WriteAllBytes($target, $savedBytes)
        [IO.File]::WriteAllText($manifestPath, $savedManifest, [Text.UTF8Encoding]::new($false))
    }
}
$result.fixedTransferAndPinCases = $pinCases
$result.pinningNodeExecutableExecuted = $false
# Reuse maintained synthetic prior-phase fixtures, including strict receiver chronology.
$priorOutput = . (Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-cancellation.ps1') -ProjectRoot $ProjectRoot -PureOnly
$cancellation = @{ passed = $true; controls = $value }
$ordering = Assert-CloudGuestStdioPreviousClosures $first $claude $cancellation
if ($ordering.sid -cne $native.sid -or !$ordering.priorJobsClosed -or !$ordering.priorReceiversExited -or !$ordering.priorWitnessClosed) { throw 'stdio-ordering-positive-refused' }
$orderingCases = 1
foreach ($entry in @(@($first.guestResult,'passed'), @($claudeNative,'claudeReceiverExitObserved'), @($cancellation,'passed'),
    @($value.before,'jobClosureConfirmed'), @($value.after,'descendantExitObserved'))) {
    $old = $entry[0][$entry[1]]; $entry[0][$entry[1]] = $false
    try {
        $refused = $false
        try { Assert-CloudGuestStdioPreviousClosures $first $claude $cancellation | Out-Null } catch { $refused = $true }
        if (!$refused) { throw 'stdio-ordering-negative-admitted' }; $orderingCases++
    } finally { $entry[0][$entry[1]] = $old }
}
$result.priorClosureOrderingModels = $orderingCases
[IO.File]::WriteAllText((Join-Path $OutputRoot 'result.json'),($result | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
$result | ConvertTo-Json -Depth 4
