param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $ProjectRoot 'scripts/qualification/claude-public/provenance.ps1'
$wrapperPath = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-claude-public.ps1'
$repaired = [IO.File]::ReadAllText($sourcePath)
$fixedLoop = '$entry = if ($entry -is [IO.DirectoryInfo]) { $entry.Parent } elseif ($entry -is [IO.FileInfo]) { $entry.Directory } else { throw ''provenance-input-refused'' }'
$oldLoop = '$entry = if ($entry.PSIsContainer) { $entry.Parent } else { $entry.Directory }'
if (!$repaired.Contains($fixedLoop)) { throw 'provenance-control-source-unavailable' }
$oldSource = $repaired.Replace($fixedLoop, $oldLoop)
$base = [IO.Path]::GetFullPath($env:TEMP)
$owned = Join-Path $base ('aegis-public-strict-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'provenance-control-parse-failed' }
$save = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Save-CloudGuestClaudeBinary' }, $true)
if ($null -eq $save) { throw 'provenance-control-source-unavailable' }
$newHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
function Assert-CloudGuestRunner { }
function Invoke-TestNoDownload([string]$Path) { $script:downloadStubCalls++; if ($Path -cne $script:expectedBinary) { throw 'provenance-control-parameters' } }
function Get-Item {
    param([string]$LiteralPath, [switch]$Force)
    if ([IO.Path]::GetFileName($LiteralPath) -ceq 'official-manifest.json') { $script:metadataReached = $true; throw 'test-metadata-boundary' }
    if ($script:reparseControl -and $LiteralPath -ceq $script:expectedMetadata) { return [pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint } }
    if ($LiteralPath -ceq $script:expectedBinary) { $script:binaryObserved = $true }
    if ($LiteralPath -ceq $script:expectedMetadata) { $script:metadataObserved = $true }
    return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
}
$checks = [Collections.Generic.List[string]]::new()
foreach ($mode in @('original', 'repaired', 'reparse', 'wrong-pin')) {
    $caseRoot = Join-Path $owned $mode
    $metadata = Join-Path $caseRoot 'claude-public'; $transfer = Join-Path $caseRoot 'transfer'; $scratch = Join-Path $caseRoot 'scratch'
    foreach ($path in @($metadata, $transfer, $scratch)) { New-Item -ItemType Directory -Path $path | Out-Null }
    $selectedSource = if ($mode -ceq 'original') { $oldSource } else { $repaired }
    $selectedPath = Join-Path $metadata 'provenance.ps1'
    [IO.File]::WriteAllText($selectedPath, $selectedSource, [Text.UTF8Encoding]::new($false))
    $caseHash = (Get-FileHash -LiteralPath $selectedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($mode -ceq 'original' -and $caseHash -cne 'c0d0ff835af23fe4f67862887b610f193809f479666c6a7166c3711a6ea8f7fe') { throw 'provenance-control-original-not-exact' }
    $script:expectedBinary = Join-Path $transfer 'claude.exe'; $script:expectedMetadata = $metadata
    [IO.File]::WriteAllBytes($script:expectedBinary, [byte[]]@(1))
    $gpg = Join-Path $caseRoot 'gpg.exe'; [IO.File]::WriteAllBytes($gpg, [byte[]]@(1))
    # Actual Save function, retained-source dot invocation and parameter binding.
    # Only test-owned paths/download side effects are substituted; verifier source is exact.
    $wrapper = $save.Extent.Text.Replace('[CloudGuestClaudeDownload]::Download($binary)', 'Invoke-TestNoDownload $binary')
    $wrapper = $wrapper.Replace("Join-Path `$PSScriptRoot 'claude-public'", "'$($metadata.Replace("'", "''"))'")
    $wrapper = $wrapper.Replace("'C:\Program Files\Git\usr\bin\gpg.exe'", "'$($gpg.Replace("'", "''"))'")
    $wrapper = $wrapper.Replace($newHash, $(if ($mode -ceq 'wrong-pin') { '0' * 64 } else { $caseHash }))
    . ([scriptblock]::Create($wrapper))
    $script:metadataReached = $false; $script:binaryObserved = $false; $script:metadataObserved = $false
    $script:downloadStubCalls = 0; $script:reparseControl = $mode -ceq 'reparse'
    $kind = $null; $message = $null
    try { $null = Save-CloudGuestClaudeBinary $transfer $scratch; throw 'provenance-control-expected-boundary' }
    catch { $kind = $_.Exception.GetType().Name; $message = $_.Exception.Message }
    if ($mode -ceq 'original') {
        if ($kind -cne 'PropertyNotFoundException' -or $script:metadataReached) { throw 'provenance-control-original-not-reproduced' }
        $checks.Add('exact-original-captured-source-StrictMode-PropertyNotFoundException')
    } elseif ($mode -ceq 'repaired') {
        if ($message -cne 'test-metadata-boundary' -or !$script:metadataReached -or !$script:binaryObserved -or !$script:metadataObserved) { throw 'provenance-control-repaired-did-not-traverse' }
        $checks.Add('typed-ancestry-reaches-metadata-boundary-with-actual-parameters')
    } elseif ($mode -ceq 'reparse') {
        if ($message -cne 'provenance-reparse-refused' -or $script:metadataReached) { throw 'provenance-control-reparse-not-refused' }
        $checks.Add('reparse-ancestor-refused-before-metadata')
    } else {
        if ($message -cne 'claude-provenance-source-refused' -or $script:metadataReached) { throw 'provenance-control-pin-not-refused' }
        $checks.Add('captured-source-pin-mismatch-refused-before-verifier')
    }
    if ($script:downloadStubCalls -ne 1) { throw 'provenance-control-download-seam-not-traversed' }
}
$rawParent = (Microsoft.PowerShell.Management\Get-Item -LiteralPath $owned).Parent
$denied = $false; try { $null = $rawParent.PSIsContainer } catch { $denied = $_.Exception.GetType().Name -ceq 'PropertyNotFoundException' }
if (!$denied -or $rawParent -isnot [IO.DirectoryInfo]) { throw 'provenance-control-provider-decoration-not-reproduced' }
$checks.Add('raw-DirectoryInfo-parent-lacks-provider-decoration')
$report = @{ schemaVersion = 1; scope = 'pure-actual-Save-captured-verifier-StrictMode-controls'; checks = @($checks); passed = $checks.Count;
    shellVersion = $PSVersionTable.PSVersion.ToString(); nativeClientExecuted = $false; gpgExecuted = $false; downloads = 0;
    verifierSha256 = $newHash; ownedFixtureRoot = $owned; policyChanged = $false; globalKeyringChanged = $false }
[IO.File]::WriteAllText((Join-Path $owned 'result.json'), ($report | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Compress -Depth 4
# Exact finite closed files retained for review; no deletion retry/global cleanup.

# Source-backed projection and Stage catch controls; no staging effects execute.
function Test-CloudGuestStagingDiagnostics([string]$SupportRoot, [string]$SourceRoot, [string]$BaselineRoot = '') {
    function Read-StagingAst([string]$Path) {
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
        if ($errors.Count) { throw 'staging-control-parse-refused' }
        return $ast
    }
    function Load-StagingFunction($Ast, [string]$Name) {
        $found = @($Ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name }, $true))
        if ($found.Count -ne 1) { throw 'staging-control-source-refused' }
        return [scriptblock]::Create($found[0].Extent.Text)
    }
    $media = Read-StagingAst (Join-Path $SupportRoot 'cloud-guest-media.ps1')
    . (Load-StagingFunction $media 'Get-CloudGuestFailureDetails')
    $checks = 0; $codes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($relative in @('scripts/qualification/cloud-guest-claude-public.ps1', 'scripts/qualification/claude-public/provenance.ps1', 'scripts/qualification/CloudGuestClaudeDownload.cs')) {
        $source = [IO.File]::ReadAllText((Join-Path $SourceRoot $relative))
        foreach ($match in [regex]::Matches($source, 'throw (?:new InvalidOperationException\()?[''"]([a-z][a-z0-9-]+)[''"]')) { [void]$codes.Add($match.Groups[1].Value) }
    }
    if ($codes.Count -ne 22) { throw 'staging-control-code-corpus-refused' }
    foreach ($code in $codes) {
        if ((Get-CloudGuestFailureDetails ([InvalidOperationException]::new($code))).code -cne $code) { throw 'staging-control-code-lost' }; $checks++
        foreach ($altered in @($code.ToUpperInvariant(), ($code + ':5'), ($code + ':dummy-secret'))) {
            if ((Get-CloudGuestFailureDetails ([InvalidOperationException]::new($altered))).code -cne 'bounded-stage-failed') { throw 'staging-control-message-leaked' }; $checks++
        }
    }
    foreach ($message in @('unknown-refusal', 'dummy-password=user-path', 'manifest-signature-refused dummy-password', 'manifest-signature-refused:5:dummy-secret')) {
        if ((Get-CloudGuestFailureDetails ([InvalidOperationException]::new($message))).code -cne 'bounded-stage-failed') { throw 'staging-control-message-leaked' }; $checks++
    }
    # Existing numeric native diagnostics remain compatible.
    if ((Get-CloudGuestFailureDetails ([InvalidOperationException]::new('held-token-open:5'))).code -cne 'held-token-open:5') { throw 'staging-control-existing-code-lost' }; $checks++
    function Invoke-StagingCaller([string]$Root, [string]$Message, [bool]$Successful) {
        $lab = Read-StagingAst (Join-Path $Root 'cloud-guest-lab.ps1')
        . (Load-StagingFunction $lab 'Stage')
        $commands = @($lab.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Stage' -and $node.CommandElements.Count -eq 3 -and $node.CommandElements[1].Extent.Text -ceq "'stage-fixed-runtime-and-host-controls'" }, $true))
        if ($commands.Count -ne 1) { throw 'staging-control-caller-refused' }
        $statements = @($commands[0].CommandElements[2].ScriptBlock.EndBlock.Statements)
        $selected = @($statements | Where-Object { $_.Extent.Text -ceq "`$report['runtimeStagingPhase'] = 'ClaudeProvenance'" -or $_.Extent.Text.StartsWith('$report.claudeProvenance = Save-CloudGuestClaudeBinary ', [StringComparison]::Ordinal) })
        $saveCount = @($selected | Where-Object { $_.Extent.Text.StartsWith('$report.claudeProvenance = ', [StringComparison]::Ordinal) }).Count
        if ($saveCount -ne 1 -or $selected.Count -gt 2) { throw 'staging-control-caller-refused' }
        $operation = [scriptblock]::Create(($selected | ForEach-Object { $_.Extent.Text }) -join "`n")
        $report = @{ stages = [Collections.Generic.List[object]]::new(); failure = $null; claudeProvenance = $null }
        $OutputRoot = [IO.Path]::GetTempPath(); $transfer = Join-Path $OutputRoot 'staging-control-no-files'
        $called = 0
        function Save-CloudGuestClaudeBinary([string]$Transfer, [string]$Scratch) {
            $script:stagingControlCalled++
            if ($Successful) { return @{ observation = 'fixed-control-only' } }
            throw [InvalidOperationException]::new($Message)
        }
        $script:stagingControlCalled = 0; $caught = $false; $sameFailure = $false
        try { Stage 'stage-fixed-runtime-and-host-controls' $operation | Out-Null }
        catch { $caught = $true; $sameFailure = $_.Exception.Message -ceq $Message }
        if ($script:stagingControlCalled -ne 1 -or $report.stages.Count -ne 1) { throw 'staging-control-caller-not-traversed' }
        return @{ report = $report; caught = $caught; primaryFailureRetained = $sameFailure }
    }
    $fixed = Invoke-StagingCaller $SupportRoot 'manifest-signature-refused' $false
    if (!$fixed.caught -or !$fixed.primaryFailureRetained -or $fixed.report.failure.code -cne 'manifest-signature-refused' -or $fixed.report.runtimeStagingPhase -cne 'ClaudeProvenance' -or $null -ne $fixed.report.claudeProvenance) { throw 'staging-control-connected-failure-lost' }; $checks++
    $unknown = Invoke-StagingCaller $SupportRoot 'dummy-password=user-path' $false
    if (!$unknown.caught -or !$unknown.primaryFailureRetained -or $unknown.report.failure.code -cne 'bounded-stage-failed' -or ($unknown.report | ConvertTo-Json -Depth 5) -match 'dummy-password|user-path') { throw 'staging-control-connected-message-leaked' }; $checks++
    $success = Invoke-StagingCaller $SupportRoot '' $true
    if ($success.caught -or $null -ne $success.report.failure -or !$success.report.stages[0].passed -or $success.report.runtimeStagingPhase -cne 'ClaudeProvenance') { throw 'staging-control-success-changed' }; $checks++
    $baseline = $null
    if ($BaselineRoot) {
        . (Load-StagingFunction (Read-StagingAst (Join-Path $BaselineRoot 'cloud-guest-media.ps1')) 'Get-CloudGuestFailureDetails')
        $before = Invoke-StagingCaller $BaselineRoot 'manifest-signature-refused' $false
        if (!$before.caught -or !$before.primaryFailureRetained -or $before.report.failure.code -cne 'bounded-stage-failed' -or $before.report.ContainsKey('runtimeStagingPhase')) { throw 'staging-control-baseline-not-reproduced' }
        $baseline = @{ code = $before.report.failure.code; checkpointAbsent = $true; originalFailureRetained = $true }; $checks++
    }
    return @{ scope = 'pure-source-extracted-Stage-and-fixed-refusal-projection'; checks = $checks; passed = $true; shellVersion = $PSVersionTable.PSVersion.ToString(); baseline = $baseline; candidate = @{ code = $fixed.report.failure.code; checkpoint = $fixed.report.runtimeStagingPhase; originalFailureRetained = $true }; nativeExecuted = $false; downloads = 0; vmEffects = $false }
}
Test-CloudGuestStagingDiagnostics $PSScriptRoot $ProjectRoot | ConvertTo-Json -Depth 5 -Compress
