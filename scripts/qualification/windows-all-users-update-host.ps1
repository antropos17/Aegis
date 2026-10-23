function Invoke-AllUsersUpdateGuestStep($Session,[string]$Root,$State,[string]$Id,[string]$Name,[string]$VmRoot) {
  $signal=Invoke-Command -Session $Session -ScriptBlock {
    $qa='C:\aegis-installer-qa\all-users-update'
    $request=if(Test-Path -LiteralPath ($qa+'\request.json')) { Get-Content -LiteralPath ($qa+'\request.json') -Raw | ConvertFrom-Json } else { $null }
    $intent=if(Test-Path -LiteralPath ($qa+'\update-install-intent.json')) { Get-Content -LiteralPath ($qa+'\update-install-intent.json') -Raw | ConvertFrom-Json } else { $null }
    $consent=@(Get-CimInstance Win32_Process -Filter "Name='consent.exe'")
    return @{request=$request;intent=$intent;consent=@($consent | Select-Object ProcessId,SessionId,ExecutablePath)}
  }
  if($signal.request -and $signal.request.action -notin $State.started) {
    $action=[string]$signal.request.action
    if($action -notin @('baseline-install','final-uninstall') -or $signal.request.sourceSha -ne $env:GITHUB_SHA -or ($action -eq 'final-uninstall' -and -not $State.consent)) { throw 'Unexpected machine update setup/cleanup action' }
    $task=Invoke-Command -Session $Session -ArgumentList $action -ScriptBlock {
      param($Action)
      $script='C:\aegis-installer-qa\input\source\scripts\qualification\windows-all-users-update-worker.ps1'
      $command="& ([scriptblock]::Create([IO.File]::ReadAllText('"+$script+"')))"
      $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
      $taskName='AegisMachineUpdate-'+$Action
      if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Machine update task already exists' }
      $operation=New-ScheduledTaskAction -Execute ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -STA -WindowStyle Hidden -EncodedCommand '+$encoded)
      $principal=New-ScheduledTaskPrincipal -UserId 'AegisSetup' -LogonType Interactive -RunLevel Highest
      $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
      Register-ScheduledTask -TaskName $taskName -Action $operation -Principal $principal -Settings $settings | Out-Null
      Start-ScheduledTask -TaskName $taskName
      return @{action=$Action;task=$taskName;purpose='Elevated baseline setup or final cleanup only; application and automatic update driver stay limited.'}
    }
    $State.started+=@($action);$State.tasks+=@($task)
  }
  if($signal.intent -and -not $State.intent) {
    $State.intent=Invoke-Command -Session $Session -ArgumentList $env:GITHUB_SHA -ScriptBlock {
      param($Source)
      $qa='C:\aegis-installer-qa\all-users-update'
      $intent=Get-Content -LiteralPath ($qa+'\update-install-intent.json') -Raw | ConvertFrom-Json
      $proof=Get-Content -LiteralPath ($qa+'\evidence\auto-update.json') -Raw | ConvertFrom-Json
      if($intent.sourceSha -ne $Source -or $intent.oldPid -ne $proof.launches[0].pid -or $intent.exe -ine 'C:\Program Files\aegis\AEGIS - AI Monitoring & Threat Detection.exe' -or $intent.installer -ne $proof.downloaded.path -or $intent.token.elevated -ne 0 -or $intent.token.integritySid -ne 'S-1-16-8192') { throw 'Automatic update intent identity mismatch' }
      $config=Get-Content -LiteralPath 'C:\Program Files\aegis\resources\app-update.yml' -Raw
      $match=[regex]::Match($config,'(?m)^updaterCacheDirName:\s*([A-Za-z0-9._-]+)\s*$')
      if(-not $match.Success) { throw 'Pinned application update cache unavailable' }
      $pending=Join-Path $env:LOCALAPPDATA ($match.Groups[1].Value+'\pending')
      if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($intent.installer)) -ine $pending -or (Get-FileHash -LiteralPath $intent.installer).Hash -ne '6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339') { throw 'Downloaded automatic installer pin/path mismatch' }
      return $intent
    }
  }
  if($State.intent -and -not $State.consent -and $signal.consent.Count) {
    if($signal.consent.Count -ne 1 -or $signal.consent[0].SessionId -le 0 -or $signal.consent[0].ExecutablePath -ine 'C:\Windows\System32\consent.exe') { throw 'Unexpected update consent process' }
    $verified=Invoke-Command -Session $Session -ArgumentList ([int]$signal.consent[0].ProcessId) -ScriptBlock {
      param($ConsentPid)
      $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ConsentPid)
      $policy=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
      $signature=Get-AuthenticodeSignature -LiteralPath $process.ExecutablePath
      if($process.ExecutablePath -ine 'C:\Windows\System32\consent.exe' -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft' -or $policy.EnableLUA -ne 1 -or $policy.PromptOnSecureDesktop -ne 1) { throw 'Secure update consent observation failed' }
      return @{pid=$ConsentPid;created=$process.CreationDate.ToUniversalTime().ToString('o');sessionId=$process.SessionId;path=$process.ExecutablePath;signature='Valid Microsoft';secureDesktopPolicy=1;enableLUA=1}
    }
    $capture=Save-InstallerSetupDiagnostic $Id $Name $VmRoot (Join-Path $Root 'evidence') 60 'all-users-update-consent'
    if($capture.status -ne 'CAPTURED') { throw 'Update UAC screenshot unavailable' }
    $vm=Get-VM -Id ([guid]$Id)
    if($vm.Name -ne $Name -or $vm.State -ne 'Running' -or -not $vm.ConfigurationLocation.StartsWith($VmRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Update consent VM ownership changed' }
    $keyboard=@(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_Keyboard -Filter ("SystemName='"+$Id+"'"))
    if($keyboard.Count -ne 1 -or $keyboard[0].SystemCreationClassName -ne 'Msvm_ComputerSystem' -or $keyboard[0].CreationClassName -ne 'Msvm_Keyboard') { throw 'Exact update guest keyboard unavailable' }
    $codes=@()
    try {
      $codes+=([uint32]$keyboard[0].PressKey([uint32]18).ReturnValue)
      if($codes[0] -ne 0) { throw 'Guest update consent Alt press failed' }
      $codes+=([uint32]$keyboard[0].TypeKey([uint32]89).ReturnValue)
    } finally { $codes+=([uint32]$keyboard[0].ReleaseKey([uint32]18).ReturnValue) }
    if(@($codes | Where-Object { $_ -ne 0 }).Count) { throw 'Guest update consent keyboard operation failed' }
    $State.consent=@{observation=$verified;capture=$capture;interaction='Alt+Y on exact owned VM keyboard; UAC policy unchanged';returnCodes=$codes;at=[DateTime]::UtcNow.ToString('o')}
  }
  if($State.consent -and (-not $State.elevatedInstaller -or -not $State.consent.closedObserved)) {
    $observed=Invoke-Command -Session $Session -ArgumentList $State.intent.installer,$State.intent.at,([int]$State.consent.observation.pid) -ScriptBlock {
      param($File,$After,$ConsentPid)
      if(-not ('InstallerProcessObservation' -as [type])) { Add-Type -Path 'C:\aegis-installer-qa\input\source\scripts\qualification\InstallerProcessObservation.cs' }
      $matches=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -ieq $File -and $_.CreationDate.ToUniversalTime() -ge ([DateTime]::Parse($After).ToUniversalTime()) })
      $high=@(foreach($process in $matches) {
        $token=[InstallerProcessObservation]::Inspect([int]$process.ProcessId)
        if($token.elevated -eq 1 -and $token.integritySid -eq 'S-1-16-12288') { @{pid=$process.ProcessId;created=$process.CreationDate.ToUniversalTime().ToString('o');path=$process.ExecutablePath;token=$token;sha256=(Get-FileHash -LiteralPath $File).Hash.ToLowerInvariant()} }
      })
      return @{elevated=$high;consentClosed=(-not [bool](Get-CimInstance Win32_Process -Filter ('ProcessId='+$ConsentPid)))}
    }
    if($observed.elevated.Count) { $State.elevatedInstaller=@($observed.elevated) }
    $State.consent.closedObserved=$observed.consentClosed
  }
  $State | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath (Join-Path $Root 'evidence/all-users-update-host.json') -Encoding UTF8
}
