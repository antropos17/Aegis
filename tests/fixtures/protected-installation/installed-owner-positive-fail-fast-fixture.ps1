# Execute the actual qualification failure handler and cleanup with pure mocks.
# No accounts, services, native actors, protected paths or ACL effects.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'positive-fixture-source-parse-failed' }
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-InstalledOwnerQualification' }, $true)
$outer = @($function.Body.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })[0]
$body = $outer.Body.Extent.Text
$start = $body.IndexOf("$" + "stage = 'actual-installed-positive'")
$end = $body.IndexOf("$" + "stage = 'actual-upgrade-rollback'")
if ($start -lt 0 -or $end -le $start) { throw 'positive-fixture-source-slice-refused' }
$run = [scriptblock]::Create('try { ' + $body.Substring($start, $end - $start) + ' } ' + $outer.CatchClauses[0].Extent.Text + ' finally ' + $outer.Finally.Extent.Text)
Add-Type 'public static class ProtectedInstallService { public static bool Absent() { return true; } }'
function Invoke-InstalledOwnerAttempt($Association, $ExpectedPositive) {
    if (!$ExpectedPositive) { throw 'fixture-positive-expected' }
    if ($script:refusal) {
        $Association.attemptDiagnostic = @{ failure = @{ diagnosticCode = $script:refusal; operation = 'attempt' }; checkpoint = $script:checkpoint }
        throw $script:refusal
    }
    return @{ passed = $true }
}
function New-ProtectedInstallAcl { $script:resourceAttempts++; throw 'fixture-control-resource-boundary' }
function Invoke-InstalledOwnerMutations { $script:actorAttempts++; throw 'fixture-actor-must-not-run' }
function Get-ProtectedInstallFailure($ErrorRecord, $Operation) { return @{ diagnosticCode = $ErrorRecord.Exception.Message; operation = $Operation } }
function Get-ChildItem { return @() }
function Test-Path { return $false }
function Get-LocalUser { return @() }
function Remove-ProtectedInstallation($Association) {
    $script:cleanupAttempts++
    if ($Association.cleanupUnknown) { throw 'fixture-cleanup-unknown' }
}
function Get-ProtectedInstallJournalReceipt($Journal) { return $Journal }
function Require([bool]$Value) { if (!$Value) { throw 'positive-fail-fast-fixture-failed' } }
$script:ProtectedInstallParent = 'X:\fixture-never-created'
$cases = 0
foreach ($checkpoint in @('attempt-validate-behavior', 'attempt-validate-closure', 'attempt-read-result')) {
    foreach ($unknown in @($false, $true)) {
        $script:checkpoint = $checkpoint; $script:refusal = 'fixture-original-' + $checkpoint
        $script:resourceAttempts = 0; $script:actorAttempts = 0; $script:cleanupAttempts = 0
        $association = @{ cleanupUnknown = $unknown; operatorSid = 'S-1-5-21-1'; receipts = @{ PathName = 'fixture-receipts' }; attemptedReceiptPaths = @(); receiptRows = @() }
        $report = @{ positive = $null; mutation = $null; mutationFailure = $null; failure = $null; failedAttempt = $null; cleanupFailure = $null; uninstall = $null; installation = $null }
        $payload = @{ files = @() }; $PayloadRoot = 'fixture-payload'; $installJournal = @{}; $scratchParent = $null; $scratch = $null; $password = $null; $stage = 'preflight'
        & $run
        Require ($report.failure.diagnosticCode -ceq $script:refusal -and $report.failure.stage -ceq 'actual-installed-positive')
        Require ($report.failedAttempt.checkpoint -ceq $checkpoint -and $null -eq $report.positive -and $null -eq $report.mutation)
        Require ($script:resourceAttempts -eq 0 -and $script:actorAttempts -eq 0 -and $script:cleanupAttempts -eq 1 -and $null -eq $scratch)
        if ($unknown) { Require ($report.cleanupFailure.diagnosticCode -ceq 'fixture-cleanup-unknown') }
        else { Require ($report.uninstall.passed -and $null -eq $report.cleanupFailure) }
        $cases++
    }
}
# Successful positives must still enter the existing mutation-resource path.
$script:refusal = $null; $script:resourceAttempts = 0; $script:cleanupAttempts = 0
$association = @{ cleanupUnknown = $false; operatorSid = 'S-1-5-21-1'; receipts = @{ PathName = 'fixture-receipts' }; attemptedReceiptPaths = @(); receiptRows = @() }
$report = @{ positive = $null; failure = $null; cleanupFailure = $null; uninstall = $null; installation = $null }
$installJournal = @{}
& $run
Require ($report.positive.passed -and $script:resourceAttempts -eq 1 -and $script:cleanupAttempts -eq 1 -and $report.failure.stage -ceq 'ordinary-token-mutation')
@{ refusedCases = $cases; resourcesSkipped = $true; originalRefusalRetained = $true; exactCleanupReached = $true; successfulPositiveReachesControls = $true; nativeQualification = $false } | ConvertTo-Json -Compress
