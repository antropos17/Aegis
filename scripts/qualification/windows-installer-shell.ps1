function Dismiss-InstallerGuestShell([IntPtr]$Window,[string]$Title) {
  if(-not $AllUsers -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted-hyperv-guest' -or $env:USERNAME -ne 'AegisSetup') { throw 'Guest shell interaction scope refused' }
  if($Title -notin @('Search','Start') -or [WizardDesktop]::ClassName($Window) -ne 'Windows.UI.Core.CoreWindow') { return }
  if($proof.guestShellDismissals.Count -ge 2 -or @($proof.guestShellDismissals | Where-Object handle -eq $Window.ToInt64()).Count) { return }
  $shellPid=[WizardDesktop]::WindowProcess($Window)
  $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$shellPid)
  if(-not $owner -or $owner.SessionId -ne $proof.sessionId -or $owner.ExecutablePath -notmatch '^C:\\Windows\\SystemApps\\[^\\]+\\(SearchHost|StartMenuExperienceHost)\.exe$') { throw 'Unexpected foreground shell owner' }
  $signature=Get-AuthenticodeSignature -LiteralPath $owner.ExecutablePath
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'Guest shell signature mismatch' }
  [WizardDesktop]::EscapeForeground($Window,[uint32]$shellPid)
  $proof.guestShellDismissals+=@{handle=$Window.ToInt64();title=$Title;pid=$shellPid;path=$owner.ExecutablePath;sessionId=$owner.SessionId;signature='Valid Microsoft';interaction='Escape on verified foreground guest shell';at=[DateTime]::UtcNow.ToString('o')}
}
