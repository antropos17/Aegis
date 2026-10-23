param([ValidateSet('later','install','relaunch')][string]$Action,[int]$AppPid,[string]$Exe,[string]$QaRoot)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted-hyperv-guest' -or $env:RUNNER_ARCH -ne 'X64' -or $env:USERNAME -ne 'AegisSetup' -or -not [Environment]::UserInteractive) { throw 'Owned interactive cloud guest required' }
$qa=[IO.Path]::GetFullPath($QaRoot).TrimEnd('\')
$exePath=[IO.Path]::GetFullPath($Exe)
if(-not $qa.StartsWith('C:\aegis-installer-qa\',[StringComparison]::OrdinalIgnoreCase) -or -not $exePath.StartsWith($qa+'\install\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Desktop witness paths escaped guest scratch' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
$source=[IO.File]::ReadAllText((Join-Path $env:GITHUB_WORKSPACE 'scripts/qualification/windows-installer-wizard.ps1'))
$native=[regex]::Match($source,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if(-not $native.Success) { throw 'Reviewed desktop primitive unavailable' }
Add-Type -TypeDefinition $native.Groups[1].Value
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class UpdaterWindows {
  private delegate bool EnumWindow(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  public static IntPtr[] ForProcess(uint expectedProcess) {
    if (expectedProcess == 0) throw new ArgumentOutOfRangeException("expectedProcess");
    var windows = new List<IntPtr>();
    EnumWindows((window, parameter) => {
      uint process; GetWindowThreadProcessId(window, out process);
      if (process == expectedProcess) windows.Add(window);
      return true;
    }, IntPtr.Zero);
    if (windows.Count > 32) throw new InvalidOperationException("Owned window budget exceeded");
    return windows.ToArray();
  }
}
'@
[void][WizardDesktop]::SetProcessDPIAware()
$proof=[ordered]@{status='RUNNING';action=$Action;oldPid=$AppPid;sourceSha=$env:GITHUB_SHA;steps=@();error=$null}
$receipt=Join-Path $qa ('evidence/updater-desktop-'+$Action+'.json')
function SaveProof { [IO.File]::WriteAllText($receipt, ($proof | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false)) }
function OwnedWindows([int]$ProcessId) {
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if(-not $p -or $p.ExecutablePath -ine $exePath) { throw 'Desktop process ownership changed' }
  $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$ProcessId)
  $desktopChildren=@([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition) | ForEach-Object { $_.Current.NativeWindowHandle })
  # An owned modal HWND need not be a direct child in UIA's desktop tree.
  # Enumerate native top-level windows, then bind UIA to each verified owner.
  $elements=@(foreach($handle in [UpdaterWindows]::ForProcess([uint32]$ProcessId)) {
    if([WizardDesktop]::IsWindowVisible($handle)) {
      $element=[Windows.Automation.AutomationElement]::FromHandle($handle)
      if($element.Current.ProcessId -ne $ProcessId) { throw 'Native/UIA window owner mismatch' }
      $element
    }
  })
  $proof.lastWindows=@($elements | ForEach-Object { @{pid=$_.Current.ProcessId;handle=$_.Current.NativeWindowHandle;title=$_.Current.Name;class=$_.Current.ClassName;desktopChild=($_.Current.NativeWindowHandle -in $desktopChildren)} })
  return $elements
}
function Capture($Window,[string]$Step) {
  $handle=[IntPtr]$Window.Current.NativeWindowHandle
  [void][WizardDesktop]::ActivateOwned($handle,[uint32]$Window.Current.ProcessId)
  Start-Sleep -Milliseconds 250
  if([WizardDesktop]::GetForegroundWindow() -ne $handle) { throw 'Owned update window not foreground' }
  $rect=$Window.Current.BoundingRectangle
  if($rect.Width -lt 100 -or $rect.Height -lt 80 -or $rect.Width -gt 3000 -or $rect.Height -gt 2500) { throw 'Invalid update window dimensions' }
  $name='updater-'+$Action+'-'+$Step+'.png'
  $bitmap=New-Object Drawing.Bitmap ([int]$rect.Width),([int]$rect.Height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size);$bitmap.Save((Join-Path $qa ('evidence/'+$name)),[Drawing.Imaging.ImageFormat]::Png) }
  finally { $graphics.Dispose();$bitmap.Dispose() }
  $proof.steps+=@{step=$Step;pid=$Window.Current.ProcessId;title=$Window.Current.Name;screenshot=$name;foregroundMatched=$true}
  SaveProof
}
function ClickLabel($Window,[string]$Label) {
  $condition=[Windows.Automation.AndCondition]::new(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Label))
  $buttons=@($Window.FindAll([Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
  if($buttons.Count -ne 1) { throw ('Expected one visible owned button: '+$Label+'; found='+$buttons.Count) }
  $r=$buttons[0].Current.BoundingRectangle;$x=[int]($r.X+$r.Width/2);$y=[int]($r.Y+$r.Height/2)
  $root=[IntPtr]$Window.Current.NativeWindowHandle
  if([WizardDesktop]::GetForegroundWindow() -ne $root -or [WizardDesktop]::GetAncestor([WizardDesktop]::WindowFromPoint([WizardDesktop+Point]::new($x,$y)),2) -ne $root) { throw 'Update click is obscured' }
  [WizardDesktop]::Click($x,$y)
}
try {
  $deadline=[DateTime]::UtcNow.AddSeconds($(if($Action -eq 'relaunch'){180}else{60}))
  $window=$null
  do {
    if($Action -eq 'relaunch') {
      $candidates=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $AppPid -and $_.ExecutablePath -ieq $exePath -and $_.CommandLine -notmatch '--type=' })
      foreach($candidate in $candidates) {
        $found=@(OwnedWindows $candidate.ProcessId | Where-Object { $_.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $_.Current.BoundingRectangle.Width -gt 200 })
        if($found.Count -eq 1) { $window=$found[0];$proof.relaunchedProcess=@{pid=$candidate.ProcessId;path=$candidate.ExecutablePath;created=$candidate.CreationDate.ToUniversalTime().ToString('o');commandLine=$candidate.CommandLine};break }
      }
    } else { $found=@(OwnedWindows $AppPid | Where-Object { $_.Current.Name -eq 'Update AEGIS' });if($found.Count -eq 1){$window=$found[0]} }
    if(-not $window) { Start-Sleep -Milliseconds 250 }
  } while(-not $window -and [DateTime]::UtcNow -lt $deadline)
  if(-not $window) { throw 'Expected updater dialog/relaunch did not appear' }
  if($Action -eq 'relaunch') {
    if(Get-Process -Id $AppPid -ErrorAction SilentlyContinue) { throw 'Old process still running after update' }
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($exePath).ProductVersion
    if($version -ne '0.20.1-beta') { throw 'Relaunched executable version mismatch' }
    $proof.productVersion=$version
    Start-Sleep -Seconds 4
    Capture $window 'observed'
    # A second controlled launch verifies retained settings; record the explicit stop separately.
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$proof.relaunchedProcess.pid)
    if($current.ExecutablePath -ine $exePath -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $proof.relaunchedProcess.created) { throw 'Relaunched identity changed before test shutdown' }
    Stop-Process -Id $current.ProcessId -Force
    $proof.testShutdown='Owned automatically relaunched main process stopped after native window/version evidence; subsequent controlled launches verify profile retention.'
  } else {
    $labels=@($window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })
    if(-not ($labels -contains 'Install AEGIS 0.20.1-beta and restart?')) { throw 'Wrong update confirmation version' }
    Capture $window 'confirmation'
    $label=if($Action -eq 'later'){'Later'}else{'Restart and install'}
    ClickLabel $window $label;$proof.clicked=$label
  }
  $proof.status='PASS'
} catch { $proof.status='FAIL';$proof.error=$_.Exception.Message;throw }
finally { SaveProof }
