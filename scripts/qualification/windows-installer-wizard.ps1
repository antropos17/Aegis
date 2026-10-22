param(
  [Parameter(Mandatory)][ValidateSet('install','uninstall','cancel','desktop')][string]$Action,
  [Parameter(Mandatory)][string]$InstallerFile,
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$QaRoot,
  [Parameter(Mandatory)][ValidateSet('cancel','fresh','upgrade','reinstall','first-uninstall','final-uninstall','desktop')][string]$Phase,
  [ValidateSet('ARM64','X64')][string]$ExpectedArchitecture = 'ARM64'
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -notin @('github-hosted','github-hosted-hyperv-guest') -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Wizard qualification requires a disposable GitHub-hosted Windows guest.'
}
$qa = [IO.Path]::GetFullPath($QaRoot).TrimEnd('\')
$allowed = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$file = [IO.Path]::GetFullPath($InstallerFile)
$install = [IO.Path]::GetFullPath($InstallRoot)
if (-not $qa.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or -not $file.StartsWith($qa+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $install.StartsWith($qa+'\install\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Wizard paths escape guest qualification scratch' }
$os = Get-CimInstance Win32_OperatingSystem
if ($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $env:RUNNER_ARCH -ne $ExpectedArchitecture) { throw 'Wizard requires the declared Windows 11 guest architecture' }
if ($ExpectedArchitecture -eq 'X64' -and ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or @(Get-CimInstance Win32_Processor | Where-Object Architecture -ne 9).Count)) { throw 'Native x64 guest required' }
if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) { throw 'No interactive desktop session; GUI acceptance cannot run' }
# Parent pwsh can put Core-only modules ahead of the inbox Desktop modules.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WizardDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public MouseInput Mouse; }
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr window, uint message, IntPtr wParam, string text);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] static extern IntPtr ReadText(IntPtr window, uint message, IntPtr wParam, System.Text.StringBuilder text);
  public static string ClassName(IntPtr window) { var text=new System.Text.StringBuilder(256); GetClassName(window,text,256); return text.ToString(); }
  public static void SetText(IntPtr window, string value) { if (SendText(window,12,IntPtr.Zero,value)==IntPtr.Zero) throw new InvalidOperationException("Directory text rejected"); }
  public static string Text(IntPtr window) { var text=new System.Text.StringBuilder(4096); ReadText(window,13,(IntPtr)4096,text); return text.ToString(); }
  public static bool ActivateOwned(IntPtr window, uint expectedProcess) {
    uint process; GetWindowThreadProcessId(window,out process);
    if (process!=expectedProcess || process==0) throw new InvalidOperationException("Activation owner changed");
    var foreground=GetForegroundWindow();
    if (foreground==window) return true;
    uint ignored; uint current=GetCurrentThreadId();
    uint other=GetWindowThreadProcessId(foreground,out ignored);
    bool attached=false;
    try {
      if (other!=0 && other!=current) {
        if (!AttachThreadInput(current,other,true)) throw new System.ComponentModel.Win32Exception();
        attached=true;
      }
      ShowWindowAsync(window,9); BringWindowToTop(window); SetForegroundWindow(window);
    } finally {
      if (attached && !AttachThreadInput(current,other,false)) throw new System.ComponentModel.Win32Exception();
    }
    return GetForegroundWindow()==window;
  }
  public static void Click(int x,int y) {
    if (!SetCursorPos(x,y)) throw new System.ComponentModel.Win32Exception();
    var inputs=new Input[2]; inputs[0].Mouse.Flags=2; inputs[1].Mouse.Flags=4;
    if (SendInput(2,inputs,Marshal.SizeOf(typeof(Input)))!=2) throw new System.ComponentModel.Win32Exception();
  }
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
$proof.clientBitness = [IntPtr]::Size * 8
$proof.interaction = 'Native Win32 control classes/state, SendInput clicks, UIA text discovery and foreground screenshots; assistive-technology semantics are not qualified.'
$nativeSystem = if ([IntPtr]::Size -eq 4) { Join-Path $env:SystemRoot 'Sysnative' } else { Join-Path $env:SystemRoot 'System32' }
$proof.desktopSessions = (& (Join-Path $nativeSystem 'qwinsta.exe') 2>&1 | Out-String).Trim()
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
function NativeClass($Element) { [WizardDesktop]::ClassName([IntPtr]$Element.Current.NativeWindowHandle) }
function ClickControl($Window,$Element) {
  $handle = [IntPtr]$Element.Current.NativeWindowHandle
  $root = [IntPtr]$Window.Current.NativeWindowHandle
  if ([WizardDesktop]::GetAncestor($handle,2) -ne $root -or [WizardDesktop]::GetForegroundWindow() -ne $root -or -not [WizardDesktop]::IsWindowEnabled($handle) -or -not [WizardDesktop]::IsWindowVisible($handle)) { throw 'Control is not enabled/visible in the foreground owned dialog' }
  $bounds = New-Object WizardDesktop+Rect
  if (-not [WizardDesktop]::GetWindowRect($handle,[ref]$bounds)) { throw 'Control bounds unavailable' }
  $x = [int](($bounds.Left+$bounds.Right)/2); $y = [int](($bounds.Top+$bounds.Bottom)/2)
  if ([WizardDesktop]::WindowFromPoint([WizardDesktop+Point]::new($x,$y)) -ne $handle) { throw 'Control click point is obscured' }
  [WizardDesktop]::Click($x,$y)
  Start-Sleep -Milliseconds 150
}
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
  $found = @((Controls $Window) | Where-Object { (NativeClass $_) -eq 'Button' -and $_.Current.AutomationId -match '^\d+$' -and $_.Current.IsEnabled -and (Name $_) -match $Text })
  if ($found.Count -ne 1) { throw ('Expected one enabled button: '+$Text+'; found='+$found.Count) }
  $found[0]
}
function InvokeButton($Window,[string]$Text) {
  $button = Button $Window $Text
  ClickControl $Window $button
}
function Snapshot($Window,[string]$Step) {
  $controls = @((Controls $Window) | Select-Object -First 150 | ForEach-Object {
    $bounds = New-Object WizardDesktop+Rect
    $native = [IntPtr]$_.Current.NativeWindowHandle
    $hasBounds = $native -ne [IntPtr]::Zero -and [WizardDesktop]::GetWindowRect($native,[ref]$bounds)
    [ordered]@{name=(Name $_);id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled;nativeClass=(NativeClass $_);bounds=$(if ($hasBounds) { @{left=$bounds.Left;top=$bounds.Top;right=$bounds.Right;bottom=$bounds.Bottom} } else { $null })}
  })
  $rect = $Window.Current.BoundingRectangle
  if ($rect.Width -lt 100 -or $rect.Height -lt 100 -or $rect.Width -gt 4000 -or $rect.Height -gt 3000) { throw 'Invalid wizard window bounds' }
  $imageName = 'wizard-'+$Phase+'-'+$proof.steps.Count+'-'+$Step+'.png'
  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  [void][WizardDesktop]::ShowWindowAsync($handle,9)
  [void][WizardDesktop]::BringWindowToTop($handle)
  $focusDeadline = [DateTime]::UtcNow.AddSeconds(3)
  do {
    [void][WizardDesktop]::SetForegroundWindow($handle)
    if ([WizardDesktop]::GetForegroundWindow() -ne $handle -and $Window.Current.ProcessId -in $script:ownedIds) {
      # Scheduled tasks do not inherit foreground activation rights. Attach only
      # for this owned dialog activation and always detach; no OS policy changes.
      [void][WizardDesktop]::ActivateOwned($handle,[uint32]$Window.Current.ProcessId)
    }
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
  if ($Step -in @('welcome','ready','ready-no-auto-launch','uninstall-welcome','uninstall-finished')) {
    $sidebar = @($controls | Where-Object { $_.id -eq '1200' -and $_.nativeClass -eq 'Static' })
    $content = @($controls | Where-Object { $_.id -in @('1201','1202') -or $_.name -eq 'Open AEGIS' })
    if ($sidebar.Count -ne 1 -or -not $sidebar[0].bounds -or $content.Count -lt 2) { throw 'Sidebar/content geometry is missing or ambiguous' }
    $overlap = @($content | Where-Object { -not $_.bounds -or ($_.bounds.top -lt $sidebar[0].bounds.bottom -and $_.bounds.bottom -gt $sidebar[0].bounds.top -and $_.bounds.left -lt $sidebar[0].bounds.right) })
    $proof.steps[-1].layout = @{status=$(if ($overlap.Count) { 'FAIL' } else { 'PASS' });sidebarRight=$sidebar[0].bounds.right;contentLeft=@($content | ForEach-Object { $_.bounds.left });checkedControls=$content.Count;overlappingControls=@($overlap | ForEach-Object { $_.id })}
    SaveProof
    if ($overlap.Count) { throw ('Sidebar overlaps wizard content on '+$Step) }
  }
}
function WaitClosed {
  do { if (@(Windows).Count -eq 0 -and $script:process.HasExited) { return }; Start-Sleep -Milliseconds 200 } while ($true)
}
function SelectCurrentUser($Window) {
  $radio = @((Controls $Window) | Where-Object { (NativeClass $_) -eq 'Button' -and (Name $_) -match '^Only for me' })
  if ($radio.Count -ne 1) { throw 'Current-user radio is missing or ambiguous' }
  ClickControl $Window $radio[0]
  if ([WizardDesktop]::SendMessage([IntPtr]$radio[0].Current.NativeWindowHandle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32() -ne 1) { throw 'Current-user radio did not select' }
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
  $signaturePath = $owner.ExecutablePath
  if ([IntPtr]::Size -eq 4 -and $signaturePath.StartsWith((Join-Path $env:SystemRoot 'System32\'),[StringComparison]::OrdinalIgnoreCase)) { $signaturePath = Join-Path $nativeSystem ([IO.Path]::GetFileName($signaturePath)) }
  $signature = Get-AuthenticodeSignature -LiteralPath $signaturePath
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
          $yes = @((Controls $modal) | Where-Object { (NativeClass $_) -eq 'Button' -and (Name $_) -eq 'Yes' })
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
      $edits = @((Controls $window) | Where-Object { (NativeClass $_) -eq 'Edit' -and $_.Current.IsEnabled })
      if ($edits.Count -ne 1) { throw 'Directory editor is missing or ambiguous' }
      $editHandle = [IntPtr]$edits[0].Current.NativeWindowHandle
      [WizardDesktop]::SetText($editHandle,$install)
      if ([WizardDesktop]::Text($editHandle) -ne $install) { throw 'Directory selection did not persist' }
      Snapshot $window 'chosen-directory'
      InvokeButton $window '^(Install|Continue|Next >)$'
      $window = WaitPage '^AEGIS is ready$'
      Snapshot $window 'ready'
      $checkbox = @((Controls $window) | Where-Object { (NativeClass $_) -eq 'Button' -and (Name $_) -eq 'Open AEGIS' })
      if ($checkbox.Count -ne 1) { throw 'Open AEGIS checkbox is missing or ambiguous' }
      $checkboxHandle = [IntPtr]$checkbox[0].Current.NativeWindowHandle
      if ([WizardDesktop]::SendMessage($checkboxHandle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32() -ne 1) { throw 'Open AEGIS should default to checked' }
      ClickControl $window $checkbox[0]
      if ([WizardDesktop]::SendMessage($checkboxHandle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32() -ne 0) { throw 'Open AEGIS did not uncheck' }
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
