$ErrorActionPreference='Stop'
# Managed fake only: no Win32 imports, window input, installer, app or VM execution.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
public static class WizardDesktop {
  public static string Mode;
  public static int Calls;
  public static IntPtr Foreground;
  public static bool ShowWindowAsync(IntPtr window, int command) { return true; }
  public static bool SetForegroundWindow(IntPtr window) { if (Mode == "Direct") Foreground = window; return Foreground == window; }
  public static IntPtr GetForegroundWindow() { return Foreground; }
  public static bool ActivateOwned(IntPtr window, uint process) {
    Calls++;
    if (process != 7) throw new InvalidOperationException("Owner mismatch");
    if (Mode == "OtherError") throw new Win32Exception(87);
    if (Mode == "Transient" && Calls == 1) throw new Win32Exception(5);
    if (Mode == "Denied") throw new Win32Exception(5);
    if (Mode != "Never") Foreground = window;
    return Foreground == window;
  }
  public static int GetWindowText(IntPtr window, StringBuilder text, int count) { text.Append("Search"); return 6; }
  public static string ClassName(IntPtr window) { return "Windows.UI.Core.CoreWindow"; }
}
'@
function Dismiss-InstallerGuestShell([IntPtr]$Window,[string]$Title) { $script:dismissCalls++ }
function AssertNativeCode($Record,[int]$Code) {
  $native=$Record.Exception
  while($native.InnerException -and $native -isnot [ComponentModel.Win32Exception]) { $native=$native.InnerException }
  if($native -isnot [ComponentModel.Win32Exception] -or $native.NativeErrorCode -ne $Code) { throw $Record }
}
. (Join-Path $PSScriptRoot 'windows-updater-focus.ps1')
function ResetCase([string]$Mode) {
  [WizardDesktop]::Mode=$Mode;[WizardDesktop]::Calls=0;[WizardDesktop]::Foreground=[IntPtr]99
  $script:proof=@{foregroundTransitions=@()};$script:dismissCalls=0;$script:allUsers=$true
}
$cases=0
ResetCase 'Transient'
# Control: the single activation call that failed in cloud run 40036941422.
$handle=[IntPtr]42;$Window=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7}}
try { [void][WizardDesktop]::ActivateOwned($handle,[uint32]$Window.Current.ProcessId);throw 'Original failure did not reproduce' }
catch { AssertNativeCode $_ 5 };$cases++
ResetCase 'Transient'
Focus-UpdaterWindow ([IntPtr]42) 7 'relaunch'
if([WizardDesktop]::Foreground -ne [IntPtr]42 -or [WizardDesktop]::Calls -ne 2 -or $proof.foregroundTransitions.Count -ne 1 -or $dismissCalls -ne 1) { throw 'Access denial retry did not preserve actual foreground requirement' };$cases++
ResetCase 'Direct'
Focus-UpdaterWindow ([IntPtr]42) 7 'relaunch'
if([WizardDesktop]::Calls -ne 0 -or $dismissCalls -ne 0) { throw 'Unneeded thread attachment/dismissal' };$cases++
ResetCase 'Never'
try { Focus-UpdaterWindow ([IntPtr]42) 7 'relaunch' 1;throw 'Missing foreground accepted' }
catch { if($_.Exception.Message -ne 'Owned update window not foreground') { throw } };$cases++
ResetCase 'OtherError'
try { Focus-UpdaterWindow ([IntPtr]42) 7 'relaunch';throw 'Unexpected native failure swallowed' }
catch { AssertNativeCode $_ 87 };$cases++
ResetCase 'Denied';$allUsers=$false
try { Focus-UpdaterWindow ([IntPtr]42) 7 'relaunch';throw 'Current-user error swallowed' }
catch { AssertNativeCode $_ 5;if([WizardDesktop]::Calls -ne 1 -or $dismissCalls -ne 0) { throw 'Current-user handling changed' } };$cases++
ResetCase 'Transient'
try { Focus-UpdaterWindow ([IntPtr]42) 8 'relaunch';throw 'Wrong owner accepted' }
catch { if($_.Exception.Message -notmatch 'Owner mismatch') { throw } };$cases++
@{status='PASS';cases=$cases;oldRegressionReproduced=$true;nativeUiExecuted=$false} | ConvertTo-Json
