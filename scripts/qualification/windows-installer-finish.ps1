function Observe-InstallerFinish {
  $exe=Join-Path $install 'AEGIS - AI Monitoring & Threat Detection.exe'
  $limit=[DateTime]::UtcNow.AddSeconds(90)
  $observed=$null;$appWindow=$null
  do {
    CheckDeadline
    $candidates=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -ieq $exe -and $_.CommandLine -notmatch '--type=' -and $_.CreationDate.ToUniversalTime() -ge $script:finishAt })
    if($candidates.Count -gt 1) { throw 'Ambiguous Finish application process' }
    if($candidates.Count -eq 1) {
      $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$candidates[0].ProcessId)
      $windows=@([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition) | Where-Object { $_.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $_.Current.BoundingRectangle.Width -gt 200 })
      if($windows.Count -eq 1) { $observed=$candidates[0];$appWindow=$windows[0];break }
    }
    Start-Sleep -Milliseconds 250
  } while([DateTime]::UtcNow -lt $limit)
  if(-not $observed) { throw 'Finish did not produce an owned application window' }
  $token=[InstallerProcessObservation]::Inspect([int]$observed.ProcessId)
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
  $proof.finishLaunch=@{pid=$observed.ProcessId;parentPid=$observed.ParentProcessId;path=$observed.ExecutablePath;commandLine=$observed.CommandLine;created=$observed.CreationDate.ToUniversalTime().ToString('o');finishClickedAt=$script:finishAt.ToString('o');token=$token;productVersion=$version.ProductVersion;fileVersion=$version.FileVersion;testStartedApp=$false}
  SaveProof
  if($token.elevated -ne 0 -or $token.integritySid -ne 'S-1-16-8192' -or $version.ProductVersion -ne '0.20.1.0' -or $version.FileVersion -ne '0.20.1-beta') { throw 'Finish application token/version mismatch' }
  if($token.userSid -ne $proof.initialToken.userSid) { throw 'Finish application changed user' }
  $script:ownedIds+=([int]$observed.ProcessId)
  Start-Sleep -Seconds 5
  Snapshot $appWindow 'finish-launched-app'
  $proof.finishLaunch.profileCreated=Test-Path -LiteralPath (Join-Path $env:APPDATA 'aegis/settings.json')
  if(-not $proof.finishLaunch.profileCreated) { throw 'Finish application did not initialize its guest user profile' }
  # Capture the actual Finish launch first; stop only this owned main process for cleanup.
  Stop-Process -Id $observed.ProcessId -Force
  $proof.finishLaunch.testShutdown='Owned automatically launched main process stopped after foreground/token/version evidence.'
  SaveProof
}
