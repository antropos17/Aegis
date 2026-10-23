function Invoke-AllUsersGuestStep($Session,[string]$Root,$State,[string]$Id,[string]$Name,[string]$VmRoot) {
  $signal=Invoke-Command -Session $Session -ScriptBlock {
    $qa='C:\aegis-installer-qa\all-users'
    $request=if(Test-Path -LiteralPath ($qa+'\request.json')) { Get-Content -LiteralPath ($qa+'\request.json') -Raw | ConvertFrom-Json } else { $null }
    $consent=@(Get-CimInstance Win32_Process -Filter "Name='consent.exe'")
    return @{request=$request;consent=@($consent | Select-Object ProcessId,SessionId,ExecutablePath);consentRequested=(Test-Path -LiteralPath ($qa+'\consent-request.json'))}
  }
  if($signal.request -and $signal.request.action -notin $State.started) {
    $action=[string]$signal.request.action
    if($action -notin @('install','uninstall') -or $signal.request.sourceSha -ne $env:GITHUB_SHA -or ($action -eq 'uninstall' -and -not $State.consent)) { throw 'Unexpected all-users desktop action' }
    $task=Invoke-Command -Session $Session -ArgumentList $action -ScriptBlock {
      param($Action)
      $script='C:\aegis-installer-qa\input\source\scripts\qualification\windows-all-users-worker.ps1'
      $command="& ([scriptblock]::Create([IO.File]::ReadAllText('"+$script+"')))"
      $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
      $taskName='AegisAllUsers-'+$Action
      if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Task already exists' }
      $operation=New-ScheduledTaskAction -Execute ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -STA -WindowStyle Hidden -EncodedCommand '+$encoded)
      $principal=New-ScheduledTaskPrincipal -UserId 'AegisSetup' -LogonType Interactive -RunLevel Highest
      $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
      Register-ScheduledTask -TaskName $taskName -Action $operation -Principal $principal -Settings $settings | Out-Null
      Start-ScheduledTask -TaskName $taskName
      return @{action=$Action;task=$taskName;purpose='Elevated observer drives the separately launched limited installer; uninstall task performs owned cleanup.'}
    }
    $State.started+=@($action);$State.tasks+=@($task)
  }
  if($signal.consentRequested -and -not $State.consent -and $signal.consent.Count) {
    if($signal.consent.Count -ne 1 -or $signal.consent[0].SessionId -le 0 -or $signal.consent[0].ExecutablePath -ine 'C:\Windows\System32\consent.exe') { throw 'Unexpected consent process' }
    $verified=Invoke-Command -Session $Session -ArgumentList ([int]$signal.consent[0].ProcessId) -ScriptBlock {
      param($ConsentPid)
      $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ConsentPid)
      $policy=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
      $signature=Get-AuthenticodeSignature -LiteralPath $process.ExecutablePath
      if($process.ExecutablePath -ine 'C:\Windows\System32\consent.exe' -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft' -or $policy.EnableLUA -ne 1 -or $policy.PromptOnSecureDesktop -ne 1) { throw 'Secure consent observation failed' }
      return @{pid=$ConsentPid;sessionId=$process.SessionId;path=$process.ExecutablePath;signature='Valid Microsoft';secureDesktopPolicy=1;enableLUA=1}
    }
    $capture=Save-InstallerSetupDiagnostic $Id $Name $VmRoot (Join-Path $Root 'evidence') 50
    if($capture.status -ne 'CAPTURED') { throw 'UAC screenshot unavailable' }
    $vm=Get-VM -Id ([guid]$Id)
    if($vm.Name -ne $Name -or $vm.State -ne 'Running' -or -not $vm.ConfigurationLocation.StartsWith($VmRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Consent keyboard VM ownership changed' }
    $keyboard=@(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_Keyboard -Filter ("SystemName='"+$Id+"'"))
    if($keyboard.Count -ne 1 -or $keyboard[0].SystemCreationClassName -ne 'Msvm_ComputerSystem' -or $keyboard[0].CreationClassName -ne 'Msvm_Keyboard') { throw 'Exact guest keyboard unavailable' }
    $codes=@()
    try {
      $codes+=([uint32]$keyboard[0].PressKey([uint32]18).ReturnValue)
      if($codes[0] -ne 0) { throw 'Guest Alt press failed' }
      $codes+=([uint32]$keyboard[0].TypeKey([uint32]89).ReturnValue)
    } finally { $codes+=([uint32]$keyboard[0].ReleaseKey([uint32]18).ReturnValue) }
    if(@($codes | Where-Object { $_ -ne 0 }).Count) { throw 'Guest consent keyboard operation failed' }
    $State.consent=@{observation=$verified;capture=$capture;interaction='Alt+Y on exact owned VM keyboard; UAC policy unchanged';returnCodes=$codes;at=[DateTime]::UtcNow.ToString('o')}
  }
  $State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $Root 'evidence/all-users-host.json') -Encoding UTF8
}
