param([string]$Mode)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-guest.ps1')
if ($Mode -ceq 'quote') {
    Add-Type -Path @((Join-Path $PSScriptRoot '../../../scripts/installation/ProtectedGuestAgent.cs'),
        (Join-Path $PSScriptRoot '../../../scripts/installation/ProtectedGuestDesktop.cs'), (Join-Path $PSScriptRoot '../../../sidecar/session/GuestJobNative.cs'))
    $values = @('', 'a b', 'c"d\', 'back\slash', '"')
    $quotes = @($values | ForEach-Object { [ProtectedGuestAgent]::Quote($_) })
    $nulRefused = $false
    try { [ProtectedGuestAgent]::Quote("bad`0value") | Out-Null } catch { $nulRefused = $true }
    return (@{ quotes = $quotes; nulRefused = $nulRefused } | ConvertTo-Json -Compress)
}
Add-Type -TypeDefinition @'
using System;
public sealed class ProtectedGuestVm : IDisposable {
 public static bool Unknown;
 public bool PendingUnknown { get { return Unknown; } }
 public ProtectedGuestVm(string id, string digest) {}
 public bool Start() { return !Unknown; }
 public void Dispose() {}
}
public sealed class ProtectedInstallFile {
 public string PathName = "C:\\private\\disk.vhdx", FileId = "original", Volume = "volume", Sddl = "private";
 public bool Closed;
 public static ProtectedInstallFile OpenMetadata(string path, bool directory) { return new ProtectedInstallFile(); }
 public void Dispose() { Closed = true; }
}
'@
$script:events = [Collections.Generic.List[string]]::new()
function Assert-ProtectedInstallAdministrator {}
function Initialize-ProtectedGuestNative {}
function Assert-ProtectedInstallation($Context) { if ($Context.vmProvision.unknown) { throw 'unknown' } }
function Assert-ProtectedGuestConfiguration($Owned, [string]$State) {
    $script:events.Add('configuration-' + $State)
    if ($Mode -ceq 'configuration') { throw 'changed' }
}
function Write-ProtectedVmJournal($Owned, [string]$Name, $Record) {
    $script:events.Add($Name)
    if (!$Owned.unknown) { throw 'intent-not-latched' }
    if ($Mode -ceq 'journal') { throw 'journal-failed' }
}
$prior = [ProtectedInstallFile]::new()
$owned = @{ hydrated = $true; unknown = $false; disk = $prior; vmId = '11111111-2222-3333-4444-555555555555'; binding = @{ identitySha256 = 'a' * 64 } }
$context = @{ vmProvision = $owned }
[ProtectedGuestVm]::Unknown = $Mode -ceq 'provider'
$refused = $false; $replay = $false
try { Start-ProtectedGuest $context } catch { $refused = $true }
if ($Mode -ceq 'positive') { try { Start-ProtectedGuest $context } catch { $replay = $true } }
@{ refused = $refused; unknown = $owned.unknown; priorClosed = $prior.Closed; replayRefused = $replay; events = @($script:events) } | ConvertTo-Json -Compress
