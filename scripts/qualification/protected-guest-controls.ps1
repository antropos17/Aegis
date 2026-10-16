Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../installation/protected-guest.ps1')

# Called only after the earlier fixed lab's exact VM absence and media cleanup.
# The input is an offline, held, hashed copy of that actual installed Windows disk.
function Invoke-ProtectedGuestQualification([string]$OutputRoot, $DiskRequest, [pscredential]$Admin, [pscredential]$Agent, [string]$SourceSha) {
    Assert-CloudGuestRunner; Assert-ProtectedInstallAdministrator
    $report = @{ schemaVersion = 1; scope = 'protected-created-vm-guest-agent'; sourceSha = $SourceSha; passed = $false;
        sourceHashes = @{}; wrongDigestRefused = $false; replayRefused = $false; off = $false; removed = $false; stage = 'input'; failure = $null; launchAllowed = $false }
    $context = $null; $journal = @{}
    try {
        if ([long](Get-PSDrive C).Free -lt ($DiskRequest.bytes + 4GB)) { throw 'protected-guest-disk-headroom-refused' }
        $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
        foreach ($relative in @('scripts/installation/protected-guest.ps1', 'scripts/installation/protected-guest-agent.ps1',
            'scripts/installation/ProtectedGuestVm.cs', 'scripts/installation/ProtectedGuestAgent.cs', 'scripts/installation/ProtectedGuestDesktop.cs',
            'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/protected-vm-provider.ps1', 'sidecar/session/GuestJobNative.cs',
            'sidecar/session/OwnedVmLifecycle.cs', 'sidecar/session/VmManagementNative.cs', 'scripts/qualification/protected-guest-controls.ps1')) {
            $report.sourceHashes[$relative] = (Get-FileHash -LiteralPath (Join-Path $project $relative)).Hash.ToLowerInvariant()
        }
        $payloadRoot = Join-Path $OutputRoot 'transfer/installed-owner'
        $manifest = Get-InstalledOwnerBinaryManifest (Test-InstalledOwnerPayload $payloadRoot $SourceSha) $false
        $iso = Join-Path $OutputRoot 'protected-inert.iso'
        New-CloudGuestAnswerIso (Join-Path $OutputRoot 'protected-iso-content') $iso '<AEGISFixture />' | Out-Null
        $image = @{ path = $iso; bytes = [long](Get-Item -LiteralPath $iso).Length; sha256 = (Get-FileHash -LiteralPath $iso).Hash.ToLowerInvariant() }
        $report.stage = 'private-create'
        $context = New-ProtectedInstallation (Join-Path $payloadRoot 'binaries') $manifest ('AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12)) ('Ae!9-' + [guid]::NewGuid().ToString('N')) $false $journal '' $image
        $report.vmId = $context.vmProvision.vmId
        $report.stage = 'hydrate'; Set-ProtectedGuestDisk $context $DiskRequest
        $report.imageSha256 = $DiskRequest.sha256
        $report.stage = 'start'; Start-ProtectedGuest $context
        $report.liveDiskId = $context.vmProvision.disk.FileId
        $report.stage = 'agent-build'
        $fixture = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
public static class ProtectedGuestControl {
 public static int Main(string[] args) {
  if (args.Length == 1 && args[0] == "child") { System.Threading.Thread.Sleep(60000); return 0; }
  if (args.Length != 2 || args[0] != "a b" || args[1] != "c\"d\\") return 10;
  if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return 11;
  if (Environment.GetEnvironmentVariable("AEGIS_GUEST_ADMIN_CANARY") != null) return 12;
  string image = Process.GetCurrentProcess().MainModule.FileName;
  try { using (var f = File.Open(image, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) {} return 13; } catch (UnauthorizedAccessException) {} catch (IOException) {}
  File.WriteAllText(Path.Combine(Environment.GetEnvironmentVariable("TEMP"), "standard-write.txt"), "bounded-control");
  string quotaFile = Path.Combine(Environment.GetEnvironmentVariable("TEMP"), "quota-control.bin");
  bool quotaRefused = false; long written = 0;
  try { using (var f = File.Create(quotaFile)) { byte[] block = new byte[1048576]; for (int i = 0; i < 600; i++) { f.Write(block, 0, block.Length); written += block.Length; } f.Flush(true); } }
  catch (IOException) { quotaRefused = written >= 400L * 1048576 && written <= 512L * 1048576; }
  finally { File.Delete(quotaFile); }
  if (!quotaRefused) return 15;
  var child = Process.Start(new ProcessStartInfo(image, "child") { UseShellExecute = false, CreateNoWindow = true });
  if (child == null || child.HasExited) return 14;
  return 0;
 }
}
'@
        $executable = Join-Path $OutputRoot 'protected-agent-control.exe'
        Add-Type -TypeDefinition $fixture -OutputAssembly $executable -OutputType ConsoleApplication
        $package = @{ path = $executable; bytes = [long](Get-Item -LiteralPath $executable).Length; sha256 = (Get-FileHash -LiteralPath $executable).Hash.ToLowerInvariant() }
        $bad = $package.Clone(); $bad.sha256 = '0' * 64
        try { Invoke-ProtectedGuestAgent $context $Admin $Agent $bad | Out-Null } catch { $report.wrongDigestRefused = !$context.vmProvision.guest.agentConsumed }
        if (!$report.wrongDigestRefused) { throw 'protected-guest-bad-digest-control-failed' }
        $report.stage = 'agent-release'
        $report.agent = Invoke-ProtectedGuestAgent $context $Admin $Agent $package @('a b', 'c"d\') 30000
        if ($report.agent.exitCode -ne 0 -or !$report.agent.jobClosed -or !$report.agent.standardToken) { throw 'protected-guest-agent-control-failed' }
        try { Invoke-ProtectedGuestAgent $context $Admin $Agent $package | Out-Null } catch { $report.replayRefused = $true }
        $report.stage = 'stop'; Stop-ProtectedGuest $context; $report.off = $context.vmProvision.guest.state -ceq 'closed'
        $report.sameDiskId = $report.liveDiskId -ceq $context.vmProvision.disk.FileId
        $report.stage = 'uninstall'; Remove-ProtectedInstallation $context; $context = $null
        $report.removed = @(Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter ("Name='" + $report.vmId + "'") -OperationTimeoutSec 5).Count -eq 0 -and !(Test-Path -LiteralPath $script:ProtectedInstallParent)
        $report.passed = $report.wrongDigestRefused -and $report.replayRefused -and $report.sameDiskId -and $report.off -and $report.removed
        $report.stage = 'complete'
    } catch {
        $report.failure = Get-ProtectedInstallFailure $_ 'protected-guest'; $report.failure.stage = $report.stage
        if ($null -ne $context -and $context.vmProvision.ContainsKey('guest')) { $report.failure.checkpoint = $context.vmProvision.guest.checkpoint }
    } finally {
        if ($null -ne $context) {
            try {
                if ($context.vmProvision.ContainsKey('guest') -and !$context.vmProvision.unknown -and $context.vmProvision.guest.state -ceq 'running') { Stop-ProtectedGuest $context }
                if (!$context.vmProvision.unknown) { Remove-ProtectedInstallation $context }
            } catch { $report.cleanupUnknown = $true }
        }
    }
    return $report
}
