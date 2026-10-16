param([string]$Project, [string]$Assembly, [string]$Source, [string]$Manifest, [string]$Scratch, [string]$Evidence)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'authority-fixture.ps1')
$stage = $null; $process = $null; $failure = $null
$receipt = @{ passed = $false; phase = 'stage'; modeledAuthority = $true; guiEnrollment = $false; launchAllowed = $false }
try {
    $stage = New-ProtectedInstallStage $context 1 ('1' * 32); $context.stage = $stage
    Move-ProtectedInstallStage $stage $script:ProtectedInstallRoot; $stage.published = $true
    Close-ProtectedGuiCandidate $context.guiInput; $context.guiInput = $null
    $receipt.phase = 'start'
    $receipt.start = Start-ProtectedInstallationGui $context
    $process = $context.guiProcess
    Need ($receipt.start.rootAlive -eq $true -and $receipt.start.released -and !$receipt.start.cleanupUnknown)
    $receipt.phase = 'visible-window'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $window = [DesktopObservation]::Observe($process, $null)
        if ($window.Visible) { break }
        Need ($watch.ElapsedMilliseconds -lt 30000)
        Start-Sleep -Milliseconds 250
    } while ($true)
    $receipt.window = [DesktopObservation]::Observe($process, (Join-Path $Evidence 'window.png'))
    $receipt.query = Get-ProtectedInstallationGuiState $context
    Need ($receipt.window.Visible -and $receipt.query.rootAlive -eq $true -and $receipt.query.activeProcesses -ge 2 -and !$receipt.query.cleanupUnknown)
    $profile = $process.ProfilePathForTest
    $receipt.profileRelative = $profile.Substring($Scratch.Length + 1)
    # These stores exist during execution; Chromium can defer Local State until
    # graceful exit, while this contract deliberately terminates the owned Job.
    Need (Test-Path -LiteralPath (Join-Path $profile 'Code Cache/js/index') -PathType Leaf)
    Need (Test-Path -LiteralPath (Join-Path $profile 'audit-index/audit-index.sqlite') -PathType Leaf)
    $receipt.chromiumProfileCreated = $true
    $receipt.phase = 'stop'
    $receipt.stop = Stop-ProtectedInstallationGui $context
    $receipt.afterStop = Get-ProtectedInstallationGuiState $context
    Need ($receipt.afterStop.rootAlive -eq $false -and $receipt.afterStop.activeProcesses -eq 0 -and !$receipt.afterStop.cleanupUnknown)
    Need ($receipt.afterStop.profileDataRetained -and (Test-Path -LiteralPath $profile -PathType Container))
    $receipt.phase = 'retry-refusal'
    $retryRefused = $false
    try { Start-ProtectedInstallationGui $context | Out-Null }
    catch { $retryRefused = $_.Exception.Message -ceq 'protected-gui-process-attempt-consumed' }
    Need $retryRefused
    $receipt.sameEpochRetryRefused = $true
    $receipt.passed = $true; $receipt.phase = 'complete'
} catch {
    $failure = $_
    $receipt.failureCode = Get-SafeFailureCode $_
    $receipt.failureType = $_.Exception.GetType().Name
    if ($context.ContainsKey('guiProcess')) {
        try { $receipt.lastObservation = Get-ProtectedInstallationGuiState $context } catch { }
    }
    if ($null -ne $process) { $receipt.failurePhase = $process.FailurePhaseForTest }
} finally {
    # Even a failed Start may have retained an owner before throwing.
    if ($context.ContainsKey('guiProcess')) { $process = $context.guiProcess }
    if ($null -ne $process) {
        try {
            $receipt.finalStop = Stop-ProtectedInstallationGui $context
            $receipt.closureConfirmed = ($receipt.finalStop.rootAlive -eq $false -and $receipt.finalStop.activeProcesses -eq 0 -and !$receipt.finalStop.cleanupUnknown)
            Need $receipt.closureConfirmed
            $process.Dispose()
        } catch {
            $receipt.passed = $false; $receipt.closureConfirmed = $false
            $receipt.closureCode = Get-SafeFailureCode $_
            $receipt.closurePhase = $process.FailurePhaseForTest
        }
    } else { $receipt.closureConfirmed = $false }
    # Retain package, profile and failed evidence; no recursive cleanup.
    if ($receipt.closureConfirmed) { $principal.Dispose(); $parent.Dispose() }
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Evidence 'desktop.json') -Encoding UTF8
}
if (!$receipt.passed -or !$receipt.closureConfirmed) {
    if ($null -ne $failure) { throw ('packaged-desktop-failed:' + $receipt.phase + ':' + $receipt.failureCode) }
    throw 'packaged-desktop-closure-unconfirmed'
}
