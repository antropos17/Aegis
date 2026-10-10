Set-StrictMode -Version Latest

# Each installed epoch is a one-shot inspection. Upgrade is permitted only after
# the exact previous owner exited; a live revision cannot be restarted by rollback.
function Assert-ProtectedInstallIdleUpgrade($Service) {
    if ($Service.Status()[0] -ne 1) { throw 'protected-upgrade-idle-owner-required' }
    $Service.WaitExited()
}

# All mutating callbacks receive the actual held association selected by validation.
# These transactions also have a synthetic fixture seam; it never selects native
# authority from environment variables, renderer data or service-name prefixes.
function Invoke-ProtectedInstallTransaction([hashtable]$Operations) {
    $stage = $null; $service = $null; $published = $false
    (& $Operations.validate) | Out-Null
    try {
        $outputs = @(& $Operations.stage); if ($outputs.Count -ne 1 -or $null -eq $outputs[0]) { throw 'protected-operation-output-refused' }; $stage = $outputs[0]
        (& $Operations.publish $stage) | Out-Null; $published = $true
        $outputs = @(& $Operations.register); if ($outputs.Count -ne 1) { throw 'protected-operation-output-refused' }; $service = $outputs[0]
        (& $Operations.verify $stage $service) | Out-Null
        return @{ stage = $stage; service = $service; published = $true }
    }
    catch {
        $original = $_; $settled = $true
        if ($null -ne $service) {
            try { (& $Operations.unregister $service) | Out-Null } catch { $settled = $false }
        }
        if ($null -ne $stage -and $settled) {
            try { (& $Operations.remove $stage $published) | Out-Null } catch { $settled = $false }
        }
        if (!$settled) { throw 'protected-partial-install-cleanup-unknown' }
        throw $original
    }
}

function Invoke-ProtectedUpgradeTransaction([hashtable]$Operations, $Association) {
    $stage = $null; $oldMoved = $false; $newMoved = $false; $stopped = $false; $commitStarted = $false
    # Refuse a changed exact SCM/root/account association before staging or Stop.
    (& $Operations.validate $Association) | Out-Null
    try {
        $outputs = @(& $Operations.stage); if ($outputs.Count -ne 1 -or $null -eq $outputs[0]) { throw 'protected-upgrade-stage-cleanup-unknown' }; $stage = $outputs[0]
        (& $Operations.stop $Association) | Out-Null; $stopped = $true
        (& $Operations.saveOld $Association) | Out-Null; $oldMoved = $true
        (& $Operations.publish $stage) | Out-Null; $newMoved = $true
        (& $Operations.verify $stage $Association.service) | Out-Null
        # The verified publication is now authoritative. Partial deletion of the
        # old revision cannot safely be undone or treated as a rollback.
        $commitStarted = $true; (& $Operations.commit $Association $stage) | Out-Null
        return $stage
    }
    catch {
        $original = $_; $settled = $true
        if ($commitStarted) { throw 'protected-upgrade-commit-cleanup-unknown' }
        try {
            if ($stopped) { (& $Operations.stop $Association) | Out-Null }
            if ($newMoved) { (& $Operations.unpublish $stage) | Out-Null }
            if ($oldMoved) { (& $Operations.restore $Association) | Out-Null }
            if ($stopped) { (& $Operations.restart $Association) | Out-Null }
            if ($null -ne $stage) { (& $Operations.remove $stage $false) | Out-Null }
        } catch { $settled = $false }
        if (!$settled) { throw 'protected-upgrade-rollback-unknown' }
        throw $original
    }
}

function Invoke-ProtectedUninstallTransaction([hashtable]$Operations, $Association) {
    # The complete finite resource set is validated before the first mutation.
    (& $Operations.validate $Association) | Out-Null
    (& $Operations.stop $Association) | Out-Null
    (& $Operations.unregister $Association.service) | Out-Null
    (& $Operations.remove $Association.stage $true) | Out-Null
    (& $Operations.account $Association) | Out-Null
}

Set-StrictMode -Version Latest

# Diagnostics are finite identifiers, never exception text, command text or data.
function Get-ProtectedInstallFailure($ErrorRecord, [string]$Operation) {
    $operations = @('administrator', 'native-initialize', 'input', 'ancestor', 'fresh-association', 'validate', 'account-create', 'account-membership', 'account-users-query', 'account-users-add', 'account-verify', 'account-administrators-query', 'account-users-verify', 'parent-create', 'receipts-create', 'credential-protect', 'stage-create', 'publish', 'service-create', 'verify', 'service-remove', 'stage-remove', 'ancillary-remove', 'absence-confirm', 'qualification',
        'protected-file-create-directory', 'protected-file-open-directory', 'protected-file-open-leaf', 'protected-file-query-attributes', 'protected-file-query-identity', 'protected-file-final-path', 'protected-file-query-security', 'protected-file-rename-directory', 'protected-file-delete',
        'service-manager-open', 'service-open', 'service-security-set', 'service-config-query', 'service-security-query', 'service-status-query', 'service-start', 'service-process-open', 'service-process-image', 'service-process-times', 'service-token-open', 'service-token-query', 'service-stop', 'service-delete', 'service-handle-close', 'service-process-wait')
    $codes = @('protected-operation-output-refused', 'protected-upgrade-stage-cleanup-unknown', 'protected-qualified-partial-fault', 'protected-installer-elevated-windows51-x64-required', 'protected-install-input-refused', 'protected-input-manifest-refused', 'protected-input-digest-refused', 'protected-ancestor-acl-refused', 'protected-install-parent-preexisting', 'protected-install-service-preexisting', 'protected-install-account-preexisting', 'protected-owned-account-association-refused', 'protected-operator-administrator-refused', 'protected-operator-users-membership-required', 'protected-file-native-refused', 'protected-file-refused', 'protected-directory-creation-cleanup-unknown', 'protected-file-handoff-cleanup-unknown', 'protected-file-repin-cleanup-unknown', 'protected-service-native-refused', 'protected-service-refused', 'protected-service-create-refused', 'protected-service-creation-cleanup-unknown', 'protected-partial-install-cleanup-unknown', 'protected-installation-cleanup-unknown', 'protected-owned-cleanup-unknown', 'protected-account-removal-unconfirmed', 'protected-uninstall-absence-unconfirmed')
    $failure = @{ operation = $(if ($Operation -cin $operations) { $Operation } else { 'qualification' }); diagnosticCode = 'protected-operation-refused'; nativeWin32 = $null; hResult = $ErrorRecord.Exception.HResult }
    $cause = $ErrorRecord.Exception; $semanticCode = $null
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
        if ($cause.Message -cin $codes) { $failure.diagnosticCode = $cause.Message }
        # Classify only known exception types. Never project command names,
        # parameter text, FQIDs or an opaque Win32Exception's ambient last error.
        if ($null -eq $semanticCode) {
            if ($cause -is [Management.Automation.CommandNotFoundException]) { $semanticCode = 'protected-command-not-found' }
            elseif ($cause -is [Management.Automation.ParameterBindingException]) { $semanticCode = 'protected-parameter-binding-refused' }
            elseif ($cause -is [ComponentModel.Win32Exception]) { $semanticCode = 'protected-win32-refused' }
        }
        # Only native helpers set these fields immediately after a failed P/Invoke.
        if ($cause.Data.Contains('protectedOperation') -and $cause.Data['protectedOperation'] -is [string] -and $cause.Data['protectedOperation'] -cin $operations) {
            $failure.operation = $cause.Data['protectedOperation']; $failure.nativeWin32 = $null
            if ($cause.Data.Contains('protectedNativeWin32') -and $cause.Data['protectedNativeWin32'] -is [int] -and $cause.Data['protectedNativeWin32'] -ge 0) { $failure.nativeWin32 = $cause.Data['protectedNativeWin32'] }
        }
        $cause = $cause.InnerException
    }
    if ($failure.diagnosticCode -ceq 'protected-operation-refused' -and $null -ne $semanticCode) { $failure.diagnosticCode = $semanticCode }
    return $failure
}
function Set-ProtectedInstallFailure([hashtable]$Journal, $ErrorRecord) {
    if ($null -eq $Journal.failure) { $Journal.failure = Get-ProtectedInstallFailure $ErrorRecord $Journal.operation }
}
function Test-ProtectedInstallCleanupUnknown($ErrorRecord) {
    $cause = $ErrorRecord.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
        if (($cause.Data.Contains('protectedCleanupUnknown') -and $cause.Data['protectedCleanupUnknown'] -is [bool] -and $cause.Data['protectedCleanupUnknown']) -or
            $cause.Message -cin @('protected-directory-creation-cleanup-unknown', 'protected-file-handoff-cleanup-unknown', 'protected-file-repin-cleanup-unknown', 'protected-service-creation-cleanup-unknown', 'protected-partial-install-cleanup-unknown', 'protected-installation-cleanup-unknown')) { return $true }
        $cause = $cause.InnerException
    }
    return $false
}
function Get-ProtectedInstallJournalReceipt([hashtable]$Journal) {
    # Explicit projection excludes the held association, password, inputs and DPAPI bytes.
    return @{ schemaVersion = 1; operation = $Journal.operation; failure = $Journal.failure; cleanup = $Journal.cleanup;
        createdSid = $Journal.createdSid; createdRoots = $Journal.createdRoots; service = $Journal.service; published = $Journal.published }
}
