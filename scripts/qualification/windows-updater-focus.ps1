function Focus-UpdaterWindow([IntPtr]$Handle,[uint32]$Owner,[string]$Step,[ValidateRange(1,10000)][int]$BudgetMilliseconds=10000) {
  $deadline=[DateTime]::UtcNow.AddMilliseconds($BudgetMilliseconds)
  do {
    [void][WizardDesktop]::ShowWindowAsync($Handle,9)
    [void][WizardDesktop]::SetForegroundWindow($Handle)
    if([WizardDesktop]::GetForegroundWindow() -eq $Handle) { break }
    try { [void][WizardDesktop]::ActivateOwned($Handle,$Owner) }
    catch {
      $native=$_.Exception
      while($native.InnerException -and $native -isnot [ComponentModel.Win32Exception]) { $native=$native.InnerException }
      if(-not $allUsers -or $native -isnot [ComponentModel.Win32Exception] -or $native.NativeErrorCode -ne 5) { throw }
      $foreground=[WizardDesktop]::GetForegroundWindow()
      $title=New-Object System.Text.StringBuilder 512
      [void][WizardDesktop]::GetWindowText($foreground,$title,512)
      $proof.foregroundTransitions+=@{step=$Step;nativeError=5;at=[DateTime]::UtcNow.ToString('o');foregroundHandle=$foreground.ToInt64();foregroundTitle=$title.ToString();foregroundClass=[WizardDesktop]::ClassName($foreground)}
      # The shared helper dismisses only a verified Microsoft-signed Search/Start
      # foreground window in this disposable session, using ordinary Escape.
      Dismiss-InstallerGuestShell $foreground $title.ToString()
    }
    if([WizardDesktop]::GetForegroundWindow() -ne $Handle) { Start-Sleep -Milliseconds 150 }
  } while([WizardDesktop]::GetForegroundWindow() -ne $Handle -and [DateTime]::UtcNow -lt $deadline)
  if([WizardDesktop]::GetForegroundWindow() -ne $Handle) { throw 'Owned update window not foreground' }
}
