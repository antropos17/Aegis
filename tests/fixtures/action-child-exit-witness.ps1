param([Parameter(Mandatory = $true)][int]$ChildId)
$ErrorActionPreference = 'Stop'
# Read-only witness: retain an OS handle before the owner is killed. Never kill by PID.
$observedChild = [System.Diagnostics.Process]::GetProcessById($ChildId)
try {
    $null = $observedChild.Handle
    if ($observedChild.HasExited) { exit 2 }
    [Console]::WriteLine('ready')
    if (-not $observedChild.WaitForExit(3000)) { exit 3 }
    # Job termination can report zero too. The caller separately rejects the
    # fixture's own deadline marker; an exit code alone cannot distinguish it.
    [Console]::WriteLine('terminated')
} finally {
    $observedChild.Dispose()
}
