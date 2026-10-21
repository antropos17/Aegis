param(
  [Parameter(Mandatory)][ValidateSet('install','uninstall','cancel','desktop')][string]$Action,
  [Parameter(Mandatory)][string]$InstallerFile,
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$QaRoot,
  [Parameter(Mandatory)][ValidateSet('cancel','fresh','upgrade','reinstall','first-uninstall','final-uninstall','desktop')][string]$Phase
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Wizard qualification requires a disposable GitHub-hosted Windows guest.'
}
$qa = [IO.Path]::GetFullPath($QaRoot).TrimEnd('\')
$allowed = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$file = [IO.Path]::GetFullPath($InstallerFile)
$install = [IO.Path]::GetFullPath($InstallRoot)
if (-not $qa.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or -not $file.StartsWith($qa+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $install.StartsWith($qa+'\install\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Wizard paths escape guest qualification scratch' }
$os = Get-CimInstance Win32_OperatingSystem
if ($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $env:RUNNER_ARCH -ne 'ARM64') { throw 'Wizard requires the declared Windows 11 ARM64 guest' }
if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) { throw 'No interactive desktop session; GUI acceptance cannot run' }
# Parent pwsh can put Core-only modules ahead of the inbox Desktop modules.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
$clientProviders = [Reflection.Assembly]::Load('UIAutomationClientsideProviders, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
[System.Windows.Automation.ClientSettings]::RegisterClientSideProviderAssembly($clientProviders.GetName())
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WizardDesktop {
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
$desktop = [WizardDesktop]::OpenInputDesktop(0,$false,1)
if ($desktop -eq [IntPtr]::Zero) { throw 'Input desktop is unavailable or locked' }
[void][WizardDesktop]::CloseDesktop($desktop)
[void][WizardDesktop]::SetProcessDPIAware()
$evidence = Join-Path $qa 'evidence'
$proofPath = Join-Path $evidence ('wizard-'+$Phase+'.json')
if (Test-Path -LiteralPath $proofPath) { throw 'Refusing to overwrite a wizard receipt' }
$proof = [ordered]@{ status='RUNNING'; action=$Action; phase=$Phase; sourceSha=$env:GITHUB_SHA; interactive=$true; sessionId=(Get-Process -Id $PID).SessionId; os=$os.Caption; runnerArchitecture=$env:RUNNER_ARCH; installer=$file; installRoot=$install; steps=@(); error=$null }
$proof.clientProviders = $clientProviders.FullName
$proof.desktopSessions = (& (Join-Path $env:SystemRoot 'System32/qwinsta.exe') 2>&1 | Out-String).Trim()
$script:ownedIds = @()
$script:process = $null
$deadline = [DateTime]::UtcNow.AddSeconds(180)
function SaveProof { $proof | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $proofPath -Encoding UTF8 }
function CheckDeadline { if ([DateTime]::UtcNow -gt $deadline) { throw 'Wizard exceeded its total deadline' } }
function Windows {
  CheckDeadline
  $processes = @(Get-CimInstance Win32_Process)
  for ($pass=0; $pass -lt 8; $pass++) {
    $children = @($processes | Where-Object { $_.ParentProcessId -in $script:ownedIds } | ForEach-Object { [int]$_.ProcessId })
    $expanded = @(@($script:ownedIds) + $children | Select-Object -Unique)
    if ($expanded.Count -eq $script:ownedIds.Count) { break }
    $script:ownedIds = $expanded
  }
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  foreach ($root in $roots) {
    try { if ($root.Current.ProcessId -in $script:ownedIds -and $root.Current.ClassName -eq '#32770' -and -not $root.Current.IsOffscreen -and $root.Current.IsEnabled) { $root } }
    catch [System.Windows.Automation.ElementNotAvailableException] { }
  }
}
function Controls($Window) {
  @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { -not $_.Current.IsOffscreen })
}
function Name($Element) { ($Element.Current.Name -replace '&','').Trim() }
function WaitPage([string]$Text) {
  do {
    foreach ($window in @(Windows)) {
      $labels = @((Controls $window) | ForEach-Object { Name $_ })
      if (@($labels | Where-Object { $_ -match $Text }).Count) { return $window }
    }
    Start-Sleep -Milliseconds 200
  } while ($true)
}
function Button($Window,[string]$Text) {
  $found = @((Controls $Window) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.AutomationId -match '^\d+$' -and $_.Current.IsEnabled -and (Name $_) -match $Text })
  if ($found.Count -ne 1) { throw ('Expected one enabled button: '+$Text+'; found='+$found.Count) }
  $found[0]
}
function InvokeButton($Window,[string]$Text) {
  $button = Button $Window $Text
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
}
function Snapshot($Window,[string]$Step) {
  $controls = @((Controls $Window) | Select-Object -First 150 | ForEach-Object { [ordered]@{name=(Name $_);id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled} })
  $rect = $Window.Current.BoundingRectangle
  if ($rect.Width -lt 100 -or $rect.Height -lt 100 -or $rect.Width -gt 4000 -or $rect.Height -gt 3000) { throw 'Invalid wizard window bounds' }
  $imageName = 'wizard-'+$Phase+'-'+$proof.steps.Count+'-'+$Step+'.png'
  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  [void][WizardDesktop]::ShowWindowAsync($handle,9)
  [void][WizardDesktop]::BringWindowToTop($handle)
  $focusDeadline = [DateTime]::UtcNow.AddSeconds(3)
  do {
    [void][WizardDesktop]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 150
  } while ([WizardDesktop]::GetForegroundWindow() -ne $handle -and [DateTime]::UtcNow -lt $focusDeadline)
  $foreground = [WizardDesktop]::GetForegroundWindow()
  $foregroundTitle = New-Object System.Text.StringBuilder 512
  [void][WizardDesktop]::GetWindowText($foreground,$foregroundTitle,512)
  $bitmap = New-Object System.Drawing.Bitmap ([int]$rect.Width),([int]$rect.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size) }
  finally { $graphics.Dispose() }
  try { $bitmap.Save((Join-Path $evidence $imageName),[System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $bitmap.Dispose() }
  $proof.steps += [ordered]@{step=$Step;title=$Window.Current.Name;processId=$Window.Current.ProcessId;screenshot=$imageName;capture='screen-region';foregroundMatched=($foreground -eq $handle);foregroundHandle=$foreground.ToInt64();foregroundTitle=$foregroundTitle.ToString();controls=$controls}
  SaveProof
  if ($foreground -ne $handle) { throw 'Wizard is not foreground; diagnostic screenshot is not passing visual evidence' }
}
function WaitClosed {
  do { if (@(Windows).Count -eq 0 -and $script:process.HasExited) { return }; Start-Sleep -Milliseconds 200 } while ($true)
}
function SelectCurrentUser($Window) {
  $radio = @((Controls $Window) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton -and (Name $_) -match '^Only for me' })
  if ($radio.Count -ne 1) { throw 'Current-user radio is missing or ambiguous' }
  $selection = $radio[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $selection.Select()
  if (-not $selection.Current.IsSelected) { throw 'Current-user radio did not select' }
}
function PrepareGuestDesktop {
  $proof.guestDesktopClosures = @()
  for ($attempt=0; $attempt -lt 3; $attempt++) {
  $foreground = [WizardDesktop]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return }
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId='+$window.Current.ProcessId)
  $proof.foregroundOwner = @{ name=$owner.Name; path=$owner.ExecutablePath; processId=$owner.ProcessId }
  $title = Name $window
  $privacyHost = $title -eq 'Microsoft account' -and [string]::Equals($owner.ExecutablePath,(Join-Path $env:SystemRoot 'System32/WWAHost.exe'),[StringComparison]::OrdinalIgnoreCase)
  $shellHost = $title -in @('Search','Start') -and $owner.Name -in @('SearchHost.exe','StartMenuExperienceHost.exe') -and $owner.ExecutablePath.StartsWith((Join-Path $env:SystemRoot 'SystemApps\'),[StringComparison]::OrdinalIgnoreCase)
  if (-not $privacyHost -and -not $shellHost) { SaveProof; return }
  $signature = Get-AuthenticodeSignature -LiteralPath $owner.ExecutablePath
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'Guest setup host is not Microsoft-signed' }
  Snapshot $window ('guest-overlay-before-close-'+$attempt)
  if ([WizardDesktop]::GetForegroundWindow() -ne $foreground) { throw 'Guest overlay changed before dismissal' }
  if ($shellHost) {
    # The Start/Search popup uses the standard Escape dismissal interaction.
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    $dismissal = 'Escape'
  } else {
    if (-not [WizardDesktop]::PostMessage($foreground,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Guest first-logon window refused the normal close request' }
    $dismissal = 'WM_CLOSE'
  }
  $closeDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([WizardDesktop]::GetForegroundWindow() -eq $foreground -and [DateTime]::UtcNow -lt $closeDeadline) { Start-Sleep -Milliseconds 200 }
  if ([WizardDesktop]::GetForegroundWindow() -eq $foreground) { throw 'Guest desktop overlay retained foreground after dismissal' }
  $proof.guestSetupWindowDismissed = $true
  $proof.guestDesktopClosures += @{title=$title;process=$owner.Name;interaction=$dismissal;noLongerForeground=$true;signature='Valid Microsoft';windowStyleVisible=[WizardDesktop]::IsWindowVisible($foreground)}
  SaveProof
  }
}
try {
  SaveProof
  PrepareGuestDesktop
  if ($Action -eq 'desktop') {
    $proof.status='PASS'; SaveProof
    exit 0
  }
  # Start only the verified guest-owned file. No /S, /currentuser or /D bypasses the UI.
  $script:process = Start-Process -FilePath $file -WindowStyle Normal -PassThru
  $script:ownedIds = @($script:process.Id)
  if ($Action -eq 'uninstall') {
    $window = WaitPage '^Uninstall AEGIS$'
    Snapshot $window 'uninstall-welcome'
    InvokeButton $window '^(Uninstall|Continue|Next >)$'
    $window = WaitPage '^AEGIS was uninstalled$'
    Snapshot $window 'uninstall-finished'
    InvokeButton $window '^(Finish|Close)$'
    WaitClosed
  } else {
    $window = WaitPage '^Install AEGIS$'
    Snapshot $window 'welcome'
    if ($Action -eq 'cancel') {
      InvokeButton $window '^Cancel$'
      do {
        $windows = @(Windows)
        if ($windows.Count -eq 0 -and $script:process.HasExited) { break }
        foreach ($modal in $windows) {
          $yes = @((Controls $modal) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and (Name $_) -eq 'Yes' })
          if ($yes.Count -eq 1) { Snapshot $modal 'cancel-confirmation'; InvokeButton $modal '^Yes$' }
        }
        Start-Sleep -Milliseconds 200
      } while ($true)
    } else {
      InvokeButton $window '^(Continue|Next >)$'
      $window = WaitPage '^Only for me'
      SelectCurrentUser $window
      Snapshot $window 'current-user'
      InvokeButton $window '^(Continue|Next >)$'
      $window = WaitPage '^Choose a location$'
      Snapshot $window 'directory'
      if ($Phase -eq 'fresh') {
        InvokeButton $window '^(< Back|Back)$'
        $window = WaitPage '^Only for me'
        SelectCurrentUser $window
        Snapshot $window 'back-to-scope'
        InvokeButton $window '^(Continue|Next >)$'
        $window = WaitPage '^Choose a location$'
      }
      $edits = @((Controls $window) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.IsEnabled })
      if ($edits.Count -ne 1) { throw 'Directory editor is missing or ambiguous' }
      $value = $edits[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value.SetValue($install)
      if ($value.Current.Value -ne $install) { throw 'Directory selection did not persist' }
      Snapshot $window 'chosen-directory'
      InvokeButton $window '^(Install|Continue|Next >)$'
      $window = WaitPage '^AEGIS is ready$'
      Snapshot $window 'ready'
      $checkbox = @((Controls $window) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and (Name $_) -eq 'Open AEGIS' })
      if ($checkbox.Count -ne 1) { throw 'Open AEGIS checkbox is missing or ambiguous' }
      $toggle = $checkbox[0].GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { throw 'Open AEGIS should default to checked' }
      $toggle.Toggle()
      if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { throw 'Open AEGIS did not uncheck' }
      Snapshot $window 'ready-no-auto-launch'
      InvokeButton $window '^(Finish|Close)$'
      WaitClosed
    }
  }
  $script:process.Refresh()
  if ($Action -ne 'cancel' -and $script:process.ExitCode -ne 0) { throw ('Wizard process exit='+$script:process.ExitCode) }
  $proof.exitCode=$script:process.ExitCode
  $proof.status='PASS'; SaveProof
} catch {
  $proof.status='FAIL'; $proof.error=$_.Exception.Message
  try { foreach ($window in @(Windows)) { Snapshot $window 'failure' } } catch { }
  SaveProof
  throw
} finally {
  if ($script:process -and -not $script:process.HasExited) { Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue }
}
