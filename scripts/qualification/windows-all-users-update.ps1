function Invoke-AllUsersUpdateQualification([string]$Previous) {
  if($env:RUNNER_ENVIRONMENT -ne 'github-hosted-hyperv-guest' -or $env:USERNAME -ne 'AegisSetup' -or $qa -ine 'C:\aegis-installer-qa\all-users-update' -or $installRoot -ine 'C:\Program Files\aegis') { throw 'All-users update requires the exact owned cloud guest case' }
  Add-Type -Path (Join-Path $supportRoot 'InstallerProcessObservation.cs')
  $result.launcherToken=[InstallerProcessObservation]::Inspect($PID)
  if($result.launcherToken.elevated -ne 0 -or $result.launcherToken.integritySid -ne 'S-1-16-8192') { throw 'Application/update driver must remain a limited interactive user' }
  $policyPath='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
  $before=Get-ItemProperty $policyPath | Select-Object EnableLUA,ConsentPromptBehaviorAdmin,PromptOnSecureDesktop
  if($before.EnableLUA -ne 1 -or $before.PromptOnSecureDesktop -ne 1 -or $before.ConsentPromptBehaviorAdmin -notin @(2,5)) { throw 'Expected unchanged UAC secure-desktop consent policy' }
  $result.uacPolicyBefore=$before
  function MachineAction([string]$Action,[string]$File) {
    @{action=$Action;file=$File;sourceSha=$env:GITHUB_SHA} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qa 'request.tmp') -Encoding utf8
    Move-Item -LiteralPath (Join-Path $qa 'request.tmp') -Destination (Join-Path $qa 'request.json') -Force
    $receipt=Join-Path $qa ('evidence/machine-'+$Action+'.json')
    $deadline=[DateTime]::UtcNow.AddSeconds(220)
    do {
      Start-Sleep -Milliseconds 500
      $proof=if(Test-Path -LiteralPath $receipt) { try { Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json } catch { $null } } else { $null }
      if($proof -and $proof.status -in @('PASS','FAIL')) { break }
    } while([DateTime]::UtcNow -lt $deadline)
    if(-not $proof -or $proof.status -ne 'PASS' -or $proof.sourceSha -ne $env:GITHUB_SHA -or $proof.action -ne $Action) { throw ('Machine operation failed: '+$Action+'; '+$proof.error) }
    return $proof
  }
  function MachineState([string]$Version) {
    CheckRegistration $Version
    $entries=@(Registrations)
    if($entries[0].PSPath -notlike '*HKEY_LOCAL_MACHINE*' -or $entries[0].PSChildName -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Update must preserve a single HKLM installation' }
    $registryRoot=if($entries[0].PSPath -match 'WOW6432Node') { 'HKLM:\Software\WOW6432Node\' } else { 'HKLM:\Software\' }
    $key=$registryRoot+$entries[0].PSChildName
    $location=Get-ItemProperty -LiteralPath $key
    if($location.InstallLocation -ine $installRoot) { throw 'Machine installation location changed' }
    $shell=New-Object -ComObject WScript.Shell
    try { $links=@(Shortcuts | ForEach-Object { $link=$shell.CreateShortcut($_.FullName);@{path=$_.FullName;target=$link.TargetPath} }) }
    finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
    if($links.Count -lt 1 -or @($links | Where-Object target -ine $appExe).Count) { throw 'Common shortcut target mismatch' }
    return @{version=$Version;registration=$entries | Select-Object PSPath,DisplayName,DisplayVersion,UninstallString;installKey=$key;installLocation=$location.InstallLocation;commonShortcuts=$links;payload=@(Payload);acl=(Get-Acl -LiteralPath $installRoot).Sddl}
  }
  SaveResult
  $result.baselineInstall=MachineAction 'baseline-install' $Previous
  $result.machineBefore=MachineState $previousVersion
  ProfileCheck 'baseline' $previousVersion
  $autoDriver=Join-Path $supportRoot 'windows-auto-update.cjs'
  RunOwned (Get-Command node).Source @(('"'+$autoDriver+'"'),'--exe',('"'+$appExe+'"'),'--root',('"'+$qa+'"')) 900000
  $result.automaticUpdate=Get-Content -LiteralPath (Join-Path $qa 'evidence/auto-update.json') -Raw | ConvertFrom-Json
  if($result.automaticUpdate.status -ne 'PASS' -or $result.automaticUpdate.installScope -ne 'all-users') { throw 'All-users automatic update receipt failed' }
  WaitNoProcesses
  $result.machineAfter=MachineState $currentVersion
  if($result.machineBefore.installKey -ne $result.machineAfter.installKey -or $result.machineBefore.installLocation -ne $result.machineAfter.installLocation) { throw 'Machine update migrated the installation' }
  $result.candidatePayload=$result.machineAfter.payload
  SaveResult
  $settings=Join-Path $profile 'settings.json';$sentinel=Join-Path $profile 'qualification-sentinel.txt'
  $settingsHash=(Get-FileHash -LiteralPath $settings).Hash;$sentinelHash=(Get-FileHash -LiteralPath $sentinel).Hash
  $uninstaller=@(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if($uninstaller.Count -ne 1) { throw 'Machine uninstaller unavailable' }
  $result.machineUninstall=MachineAction 'final-uninstall' $uninstaller[0].FullName
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  while((Test-Path -LiteralPath $installRoot) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  WaitNoProcesses
  if((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $result.machineAfter.installKey) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Machine installation residue remained' }
  if((Get-FileHash -LiteralPath $settings).Hash -ne $settingsHash -or (Get-FileHash -LiteralPath $sentinel).Hash -ne $sentinelHash) { throw 'Uninstall modified retained synthetic settings/data' }
  $result.uacPolicyAfter=Get-ItemProperty $policyPath | Select-Object EnableLUA,ConsentPromptBehaviorAdmin,PromptOnSecureDesktop
  if(($before | ConvertTo-Json -Compress) -ne ($result.uacPolicyAfter | ConvertTo-Json -Compress)) { throw 'UAC policy changed' }
  $result.phases+=@{phase='all-users-automatic-update-and-cleanup';status='PASS';scalePercent=100;machineInstallPreserved=$true;hklmRemoved=$true;commonShortcutsRemoved=$true;processesRemaining=0;settingsRetained=$true;sentinelRetained=$true;uacPolicyUnchanged=$true}
}
