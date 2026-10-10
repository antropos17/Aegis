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
    $Operations.validate.Invoke() | Out-Null
    try {
        $stage = $Operations.stage.Invoke()
        $Operations.publish.Invoke($stage) | Out-Null; $published = $true
        $service = $Operations.register.Invoke()
        $Operations.verify.Invoke($stage, $service) | Out-Null
        return @{ stage = $stage; service = $service; published = $true }
    }
    catch {
        $original = $_; $settled = $true
        if ($null -ne $service) {
            try { $Operations.unregister.Invoke($service) | Out-Null } catch { $settled = $false }
        }
        if ($null -ne $stage -and $settled) {
            try { $Operations.remove.Invoke($stage, $published) | Out-Null } catch { $settled = $false }
        }
        if (!$settled) { throw 'protected-partial-install-cleanup-unknown' }
        throw $original
    }
}

function Invoke-ProtectedUpgradeTransaction([hashtable]$Operations, $Association) {
    $stage = $null; $oldMoved = $false; $newMoved = $false; $stopped = $false; $commitStarted = $false
    # Refuse a changed exact SCM/root/account association before staging or Stop.
    $Operations.validate.Invoke($Association) | Out-Null
    try {
        $stage = $Operations.stage.Invoke()
        $Operations.stop.Invoke($Association) | Out-Null; $stopped = $true
        $Operations.saveOld.Invoke($Association) | Out-Null; $oldMoved = $true
        $Operations.publish.Invoke($stage) | Out-Null; $newMoved = $true
        $Operations.verify.Invoke($stage, $Association.service) | Out-Null
        # The verified publication is now authoritative. Partial deletion of the
        # old revision cannot safely be undone or treated as a rollback.
        $commitStarted = $true; $Operations.commit.Invoke($Association, $stage) | Out-Null
        return $stage
    }
    catch {
        $original = $_; $settled = $true
        if ($commitStarted) { throw 'protected-upgrade-commit-cleanup-unknown' }
        try {
            if ($stopped) { $Operations.stop.Invoke($Association) | Out-Null }
            if ($newMoved) { $Operations.unpublish.Invoke($stage) | Out-Null }
            if ($oldMoved) { $Operations.restore.Invoke($Association) | Out-Null }
            if ($stopped) { $Operations.restart.Invoke($Association) | Out-Null }
            if ($null -ne $stage) { $Operations.remove.Invoke($stage, $false) | Out-Null }
        } catch { $settled = $false }
        if (!$settled) { throw 'protected-upgrade-rollback-unknown' }
        throw $original
    }
}

function Invoke-ProtectedUninstallTransaction([hashtable]$Operations, $Association) {
    # The complete finite resource set is validated before the first mutation.
    $Operations.validate.Invoke($Association) | Out-Null
    $Operations.stop.Invoke($Association) | Out-Null
    $Operations.unregister.Invoke($Association.service) | Out-Null
    $Operations.remove.Invoke($Association.stage, $true) | Out-Null
    $Operations.account.Invoke($Association) | Out-Null
}
