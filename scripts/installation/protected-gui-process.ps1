Set-StrictMode -Version Latest

# The retained installer association is the only administrative selector.
function Enter-ProtectedGuiProcessLifecycle($Context) {
    if ($null -ne $Context -and $Context.ContainsKey('guiPrincipal') -and $null -ne $Context.guiPrincipal) {
        return $Context.guiPrincipal.EnterLifecycle()
    }
    return $null
}
function Assert-ProtectedGuiProcessIdle($Context) {
    if ($null -eq $Context) { return }
    if ($Context.ContainsKey('cleanupUnknown') -and $Context.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
    if ($Context.ContainsKey('guiProcess') -and $null -ne $Context.guiProcess -and !$Context.guiProcess.IsSettled) { throw 'protected-gui-process-active' }
    if ($Context.ContainsKey('guiPrincipal') -and $null -ne $Context.guiPrincipal) { $Context.guiPrincipal.AssertProcessIdle() }
}
function Get-ProtectedGuiProcessObservation($Association) {
    $owner = $Association.guiProcess
    $state = $owner.GetState()
    if ($state.CleanupUnknown) { $Association.cleanupUnknown = $true }
    return @{ state = if ($Association.cleanupUnknown) { 'cleanup-unknown' } else { $state.State }
        rootAlive = $state.RootAlive; activeProcesses = $state.ActiveProcesses; released = $state.Released
        cleanupUnknown = [bool]($Association.cleanupUnknown -or $state.CleanupUnknown)
        profileDataRetained = $state.ProfileDataRetained; principalRole = 'installer-linked-limited'
        guiEnrollment = $false; launchAllowed = $false }
}
function Start-ProtectedInstallationGui($Association) {
    Assert-ProtectedInstallAdministrator
    if ($Association -isnot [hashtable] -or !$Association.ContainsKey('guiPrincipal') -or
        $Association.guiPrincipal -isnot [ProtectedGuiIdentity]) { throw 'protected-gui-process-association-refused' }
    $gate = Enter-ProtectedGuiProcessLifecycle $Association
    try {
        Assert-ProtectedGuiProcessIdle $Association
        Assert-ProtectedInstallation $Association
        $stage = $Association.stage
        if ($null -eq $stage -or !$stage.ContainsKey('gui') -or $null -eq $stage.gui -or
            ![object]::ReferenceEquals($stage.gui.principal, $Association.guiPrincipal) -or
            ![object]::ReferenceEquals($stage.context, $Association) -or ![object]::ReferenceEquals($stage.parent, $Association.parent) -or
            !$stage.published -or $null -ne $Association.rollback -or
            ($Association.ContainsKey('failedStage') -and $null -ne $Association.failedStage)) { throw 'protected-gui-process-association-refused' }
        if ($Association.ContainsKey('guiAttemptEpoch') -and $Association.guiAttemptEpoch -ceq $stage.epoch) { throw 'protected-gui-process-attempt-consumed' }
        # Consume before creating a profile, changing pins or creating a process.
        $Association.guiAttemptEpoch = $stage.epoch
        $owner = [ProtectedGuiProcessLease]::Create($stage.gui.bundle, $stage.root, $stage.parent, $Association.guiPrincipal, $Association.installId, $Association)
        $Association.guiProcess = $owner
        try { $owner.Prepare(); $owner.Release() }
        catch { if ($owner.CleanupUnknown) { $Association.cleanupUnknown = $true }; throw }
        Get-ProtectedGuiProcessObservation $Association
    } finally { if ($null -ne $gate) { $gate.Dispose() } }
}
function Get-ProtectedInstallationGuiState($Association) {
    Assert-ProtectedInstallAdministrator
    if ($Association -isnot [hashtable] -or !$Association.ContainsKey('guiProcess') -or
        $Association.guiProcess -isnot [ProtectedGuiProcessLease] -or !$Association.guiProcess.OwnsAssociation($Association)) { throw 'protected-gui-process-association-refused' }
    $gate = Enter-ProtectedGuiProcessLifecycle $Association
    try { Get-ProtectedGuiProcessObservation $Association }
    finally { if ($null -ne $gate) { $gate.Dispose() } }
}
function Stop-ProtectedInstallationGui($Association) {
    Assert-ProtectedInstallAdministrator
    if ($Association -isnot [hashtable] -or !$Association.ContainsKey('guiProcess') -or
        $Association.guiProcess -isnot [ProtectedGuiProcessLease] -or !$Association.guiProcess.OwnsAssociation($Association)) { throw 'protected-gui-process-association-refused' }
    $gate = Enter-ProtectedGuiProcessLifecycle $Association
    try {
        try { $Association.guiProcess.Stop() }
        catch { $Association.cleanupUnknown = $true; throw }
        Get-ProtectedGuiProcessObservation $Association
    } finally { if ($null -ne $gate) { $gate.Dispose() } }
}
