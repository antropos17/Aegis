function Invoke-AllUsersQualification([string]$Candidate) {
  if($env:RUNNER_ENVIRONMENT -ne 'github-hosted-hyperv-guest' -or $env:USERNAME -ne 'AegisSetup' -or $qa -ine 'C:\aegis-installer-qa\all-users') { throw 'All-users requires the owned cloud guest' }
  Add-Type -Path (Join-Path $supportRoot 'InstallerProcessObservation.cs')
  $result.launcherToken=[InstallerProcessObservation]::Inspect($PID)
  if($result.launcherToken.elevated -ne 0 -or $result.launcherToken.integritySid -ne 'S-1-16-8192') { throw 'All-users launcher must be a limited interactive user' }
  $policyPath='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
  $before=Get-ItemProperty $policyPath | Select-Object EnableLUA,ConsentPromptBehaviorAdmin,PromptOnSecureDesktop
  if($before.EnableLUA -ne 1 -or $before.PromptOnSecureDesktop -ne 1 -or $before.ConsentPromptBehaviorAdmin -notin @(2,5)) { throw 'Expected unchanged UAC secure-desktop consent policy' }
  $result.uacPolicyBefore=$before
  if(Test-Path -LiteralPath $installRoot) { throw 'Refusing a preexisting machine install directory' }
  $process=Start-Process -FilePath $Candidate -WindowStyle Normal -PassThru
  $identity=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.Id)
  $request=@{action='install';file=$Candidate;pid=$process.Id;created=$identity.CreationDate.ToUniversalTime().ToString('o');sourceSha=$env:GITHUB_SHA}
  $request | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qa 'request.tmp') -Encoding utf8
  Move-Item -LiteralPath (Join-Path $qa 'request.tmp') -Destination (Join-Path $qa 'request.json')
  $receipt=Join-Path $qa 'evidence/wizard-fresh.json'
  $deadline=[DateTime]::UtcNow.AddSeconds(240)
  do {
    Start-Sleep -Seconds 1
    $proof=if(Test-Path -LiteralPath $receipt) { try { Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json } catch { $null } } else { $null }
    if($proof -and $proof.status -in @('PASS','FAIL')) { break }
  } while([DateTime]::UtcNow -lt $deadline)
  if(-not $proof -or $proof.status -ne 'PASS' -or -not $proof.finishLaunch -or -not $proof.finishCheckboxChecked) { throw ('All-users wizard/Finish failed: '+$proof.error) }
  WaitNoProcesses
  $result.allUsersWizard=$proof
  $entries=@(Registrations)
  if($entries.Count -ne 1 -or $entries[0].PSPath -notlike '*HKEY_LOCAL_MACHINE*' -or $entries[0].DisplayVersion -ne $currentVersion -or [string]$entries[0].InstallLocation -ine $installRoot) { throw 'Machine-wide registration/version/location mismatch' }
  $result.machineRegistration=$entries | Select-Object PSPath,DisplayName,DisplayVersion,InstallLocation,UninstallString
  $common=@(Shortcuts)
  $shell=New-Object -ComObject WScript.Shell
  try {
    $result.commonShortcuts=@($common | ForEach-Object { $link=$shell.CreateShortcut($_.FullName);@{path=$_.FullName;target=$link.TargetPath} })
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
  if($common.Count -lt 1 -or @($result.commonShortcuts | Where-Object target -ine $appExe).Count) { throw 'Common shortcut missing or target mismatch' }
  $result.candidatePayload=@(Payload)
  $result.installAcl=(Get-Acl -LiteralPath $installRoot).Sddl
  $result.phases+=@{phase='all-users-install-and-finish';status='PASS';defaultProgramFiles=$true;hklmRegistration=$true;commonShortcuts=$true;scalePercent=100}
  SaveResult
  $uninstaller=@(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if($uninstaller.Count -ne 1) { throw 'Owned machine uninstaller missing' }
  @{action='uninstall';file=$uninstaller[0].FullName;sourceSha=$env:GITHUB_SHA} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qa 'request.tmp') -Encoding utf8
  Move-Item -LiteralPath (Join-Path $qa 'request.tmp') -Destination (Join-Path $qa 'request.json') -Force
  $receipt=Join-Path $qa 'evidence/wizard-final-uninstall.json'
  $deadline=[DateTime]::UtcNow.AddSeconds(220)
  do {
    Start-Sleep -Seconds 1
    $proof=if(Test-Path -LiteralPath $receipt) { try { Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json } catch { $null } } else { $null }
    if($proof -and $proof.status -in @('PASS','FAIL')) { break }
  } while([DateTime]::UtcNow -lt $deadline)
  if(-not $proof -or $proof.status -ne 'PASS') { throw ('Machine uninstall cleanup failed: '+$proof.error) }
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  while((Test-Path -LiteralPath $installRoot) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  WaitNoProcesses
  if((Test-Path -LiteralPath $installRoot) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Machine installation residue remained' }
  $after=Get-ItemProperty $policyPath | Select-Object EnableLUA,ConsentPromptBehaviorAdmin,PromptOnSecureDesktop
  $result.uacPolicyAfter=$after
  if(($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) { throw 'UAC policy changed' }
  $result.phases+=@{phase='machine-uninstall-cleanup';status='PASS';applicationRemoved=$true;hklmRemoved=$true;commonShortcutsRemoved=$true;processesRemaining=0;uacPolicyUnchanged=$true}
}
