param([string]$Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-install-transaction.ps1')
$events = [Collections.Generic.List[string]]::new()
$ops = @{}
foreach ($name in @('validate', 'stage', 'publish', 'register', 'verify', 'unregister', 'remove', 'stop', 'saveOld', 'commit', 'unpublish', 'restore', 'restart', 'account')) {
    $selected = $name
    $ops[$name] = { $events.Add($selected); if ($selected -eq 'stage') { return 'held-stage' }; if ($selected -eq 'register') { return 'held-service' } }.GetNewClosure()
}
$refused = $false; $failure = $null
try {
    if ($Mode -eq 'uninstall-foreign') {
        $ops.validate = { $events.Add('validate'); throw 'foreign-service-association' }.GetNewClosure()
        Invoke-ProtectedUninstallTransaction $ops @{ service = 'foreign'; stage = 'foreign' }
    }
    elseif ($Mode -eq 'uninstall-unknown-receipt') {
        . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
        $receipts = [pscustomobject]@{ events = $events; PathName = 'C:\fixture\receipts' }
        $receipts | Add-Member -MemberType ScriptMethod -Name Recheck -Value { $this.events.Add('receipts-recheck') }
        $context = @{ cleanupUnknown = $false; control = $null; receipts = $receipts; receiptRows = @(@{ path = 'C:\fixture\receipts\owned.json' }) }
        function Get-ChildItem { param([string]$LiteralPath, [switch]$Force); return @([pscustomobject]@{ FullName = 'C:\fixture\receipts\foreign.json' }) }
        $ops.validate = { $events.Add('validate'); Assert-ProtectedInstallAncillary $context }.GetNewClosure()
        Invoke-ProtectedUninstallTransaction $ops @{ service = 'held-service'; stage = 'held-old' }
    }
    elseif ($Mode -eq 'upgrade-running') {
        $live = [pscustomobject]@{ events = $events }
        $live | Add-Member -MemberType ScriptMethod -Name Status -Value { $this.events.Add('status'); return @(4, 123) }
        $live | Add-Member -MemberType ScriptMethod -Name WaitExited -Value { $this.events.Add('wait-exited') }
        $ops.validate = { $events.Add('validate'); Assert-ProtectedInstallIdleUpgrade $live }.GetNewClosure()
        Invoke-ProtectedUpgradeTransaction $ops @{ service = $live; stage = 'held-old' } | Out-Null
    }
    elseif ($Mode -eq 'upgrade-after-publication') {
        $ops.verify = { $events.Add('verify'); throw 'new-root-verification-failed' }.GetNewClosure()
        Invoke-ProtectedUpgradeTransaction $ops @{ service = 'held-service'; stage = 'held-old' } | Out-Null
    }
    elseif ($Mode -eq 'partial-register') {
        $ops.register = { $events.Add('register'); throw 'scm-create-refused' }.GetNewClosure()
        Invoke-ProtectedInstallTransaction $ops | Out-Null
    }
    elseif ($Mode -eq 'upgrade-rollback-unknown') {
        $ops.verify = { $events.Add('verify'); throw 'new-root-verification-failed' }.GetNewClosure()
        $ops.restore = { $events.Add('restore'); throw 'original-restore-unknown' }.GetNewClosure()
        Invoke-ProtectedUpgradeTransaction $ops @{ service = 'held-service'; stage = 'held-old' } | Out-Null
    }
    elseif ($Mode -eq 'upgrade-commit-unknown') {
        $ops.commit = { $events.Add('commit'); throw 'old-revision-deletion-unknown' }.GetNewClosure()
        Invoke-ProtectedUpgradeTransaction $ops @{ service = 'held-service'; stage = 'held-old' } | Out-Null
    }
    else { throw 'fixture-mode-refused' }
}
catch {
    $refused = $true; $cause = $_.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause.InnerException; $depth++) { $cause = $cause.InnerException }
    $failure = $cause.Message
}
@{ refused = $refused; failure = $failure; events = @($events) } | ConvertTo-Json -Compress
