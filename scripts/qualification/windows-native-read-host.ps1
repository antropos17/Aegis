# Pure literal transform; String.Split(string) is not a literal-string overload in Windows PowerShell 5.1.
function Set-NativeReadSecondLogon([string]$AnswerText) {
  $marker='<LogonCount>1</LogonCount>'
  if([regex]::Matches($AnswerText,[regex]::Escape($marker)).Count -ne 1 -or
    [regex]::Matches($AnswerText,'<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?LogonCount(?:\s|>)').Count -ne 1 -or
    [regex]::Matches($AnswerText,'</(?:[A-Za-z_][A-Za-z0-9_.-]*:)?LogonCount\s*>').Count -ne 1) {
    throw 'Second lab logon seam changed'
  }
  return $AnswerText.Replace($marker,'<LogonCount>2</LogonCount>')
}

# Fixed current-run native-read lab captures; the installer capture scope is unchanged.
function Save-NativeReadCapture([string]$Id,[string]$Name,[string]$VmRoot,[string]$Evidence,[int]$Index,[ValidateSet('setup','prepare','resume','admission')][string]$Purpose) {
  Assert-CloudGuestRunner
  $expected='D:\aegis-native-read-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT
  $valid=if($Purpose -ceq 'setup') { $Index -ge 1 -and $Index -le 4 } else { $Index -ge 100 -and $Index -le 111 }
  if(-not $valid -or $Id -cnotmatch '^[a-f0-9-]{36}$' -or $Name -cnotmatch '^aegis-cloud-[0-9]+-[0-9]+-[a-f0-9]{32}$' -or [IO.Path]::GetFullPath($VmRoot).TrimEnd('\') -ine ($expected+'\vm') -or [IO.Path]::GetFullPath($Evidence).TrimEnd('\') -ine ($expected+'\evidence')) { throw 'Native-read capture scope refused' }
  $job=Start-Job -ArgumentList $Id,$Name,$VmRoot,$Evidence,$Index,$Purpose -ScriptBlock {
    param($Id,$Name,$VmRoot,$Evidence,$Index,$Purpose)
    $ErrorActionPreference='Stop';$result=@{index=$Index;purpose=$Purpose;at=[DateTime]::UtcNow.ToString('o');status='UNKNOWN';vmId=$Id}
    try {
      $vm=Get-VM -Id ([guid]$Id)
      $actual=[IO.Path]::GetFullPath($vm.ConfigurationLocation).TrimEnd('\');$expected=[IO.Path]::GetFullPath($VmRoot).TrimEnd('\')
      if($vm.Id.ToString() -cne $Id -or $vm.Name -cne $Name -or ($actual -ine $expected -and -not $actual.StartsWith($expected+'\',[StringComparison]::OrdinalIgnoreCase)) -or $vm.State -ne 'Running') { throw 'Native-read capture VM mismatch' }
      $namespace='root\virtualization\v2'
      $system=Get-WmiObject -Namespace $namespace -Class Msvm_ComputerSystem -Filter ("Name='"+$Id+"'")
      if($system.Name -ine $Id -or $system.CreationClassName -cne 'Msvm_ComputerSystem') { throw 'Native-read capture system mismatch' }
      $settings=@($system.psbase.GetRelated('Msvm_VirtualSystemSettingData') | Where-Object { $_.VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized' -and $_.VirtualSystemIdentifier -eq $Id })
      if($settings.Count -ne 1) { throw 'Native-read capture settings mismatch' }
      $service=Get-WmiObject -Namespace $namespace -Class Msvm_VirtualSystemManagementService
      $thumbnailParameters=$service.psbase.GetMethodParameters('GetVirtualSystemThumbnailImage')
      $thumbnailParameters.TargetSystem=$settings[0].psbase.Path.Path;$thumbnailParameters.WidthPixels=[uint16]640;$thumbnailParameters.HeightPixels=[uint16]480
      $capture=$service.psbase.InvokeMethod('GetVirtualSystemThumbnailImage',$thumbnailParameters,$null);$bytes=$capture.ImageData
      if([uint32]$capture.ReturnValue -ne 0 -or $bytes -isnot [byte[]] -or $bytes.Length -lt 614400 -or $bytes.Length -gt 614404) { throw 'Native-read thumbnail unavailable' }
      $file='native-'+$Purpose+'-'+$Index+'.rgb565';$target=Join-Path $Evidence $file
      if(Test-Path -LiteralPath $target) { throw 'Fresh native-read capture required' }
      [IO.File]::WriteAllBytes($target,$bytes)
      $result.file=$file;$result.width=640;$result.height=480;$result.bytes=$bytes.Length;$result.sha256=(Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant();$result.status='CAPTURED'
    } catch { $result.errorKind=$_.Exception.GetType().Name;$result.hresult=$_.Exception.HResult }
    return $result
  }
  try {
    if($null -eq (Wait-Job $job -Timeout 15)) { return @{index=$Index;status='DIAGNOSTIC_TIMEOUT'} }
    $values=@(Receive-Job $job -ErrorAction Stop)
    if($values.Count -ne 1) { throw 'Unexpected native-read capture result' };return $values[0]
  } finally { if($job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue };Remove-Job $job -Force -ErrorAction SilentlyContinue }
}

function Initialize-NativeReadGuest($Session, $Bundle) {
  Invoke-Command -Session $Session -ScriptBlock {
    $root='C:\aegis-native-read'
    if(Test-Path -LiteralPath $root) { throw 'Fresh native-read guest root required' }
    New-Item -ItemType Directory -Path $root | Out-Null
    $acl=Get-Acl -LiteralPath $root
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $root -AclObject $acl
  }
  Copy-Item -LiteralPath $Bundle.path -Destination 'C:\aegis-native-read\input.zip' -ToSession $Session
  return Invoke-Command -Session $Session -ArgumentList $Bundle.sha256,$Bundle.bytes,$env:GITHUB_SHA -ScriptBlock {
    param($Hash,$Bytes,$SourceSha)
    $root='C:\aegis-native-read';$guestInputRoot=Join-Path $root 'input';$zip=Join-Path $root 'input.zip'
    if((Get-Item -LiteralPath $zip).Length -ne $Bytes -or (Get-FileHash -LiteralPath $zip).Hash -ine $Hash) { throw 'Input transfer mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($zip)
    try {
      foreach($entry in $archive.Entries) {
        $target=[IO.Path]::GetFullPath((Join-Path $guestInputRoot $entry.FullName))
        if(-not $target.StartsWith($guestInputRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Input archive escaped owned root' }
      }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,$guestInputRoot)
    $manifest=Join-Path $guestInputRoot 'input-manifest.json'
    if((Get-Item -LiteralPath $manifest).Length -gt 8MB) { throw 'Input manifest budget' }
    $files=@(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
    if($files.Count -gt 30000) { throw 'Input file count budget' }
    foreach($file in $files) {
      $target=[IO.Path]::GetFullPath((Join-Path $guestInputRoot $file.path))
      if(-not $target.StartsWith($guestInputRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $target).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $target).Hash -ine $file.sha256) { throw 'Input manifest mismatch' }
    }
    if(@(Get-ChildItem -LiteralPath $guestInputRoot -Recurse -Force -Attributes ReparsePoint).Count) { throw 'Guest input links refused' }
    $context=Get-Content -LiteralPath (Join-Path $guestInputRoot 'context.json') -Raw | ConvertFrom-Json
    if($context.sourceSha -cne $SourceSha -or $context.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or $context.coreAutoCrlf -notin @('true','false','input') -or $context.coreEol -notin @('native','lf','crlf')) { throw 'Guest source context mismatch' }
    $env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $root 'absent-global-gitconfig'
    $git=Join-Path $guestInputRoot 'runtime/git/cmd/git.exe';$repository=Join-Path $root 'repository.git';$source=Join-Path $root 'source'
    New-Item -ItemType Directory -Path (Join-Path $root 'empty-template') | Out-Null
    & $git -c init.defaultBranch=qualification init --bare --template=(Join-Path $root 'empty-template') $repository | Out-Null
    if($LASTEXITCODE -ne 0) { throw 'Guest Git initialization failed' }
    Copy-Item -LiteralPath (Join-Path $guestInputRoot 'gitstore/objects') -Destination $repository -Recurse -Force
    if(Test-Path -LiteralPath (Join-Path $guestInputRoot 'gitstore/shallow')) { Copy-Item -LiteralPath (Join-Path $guestInputRoot 'gitstore/shallow') -Destination $repository }
    & $git --git-dir=$repository config core.autocrlf $context.coreAutoCrlf
    if($LASTEXITCODE -ne 0) { throw 'Guest source conversion configuration failed' }
    & $git --git-dir=$repository config core.eol $context.coreEol
    if($LASTEXITCODE -ne 0) { throw 'Guest source line ending configuration failed' }
    & $git --git-dir=$repository update-ref refs/heads/qualification $SourceSha
    if($LASTEXITCODE -ne 0) { throw 'Guest source ref reconstruction failed' }
    & $git --git-dir=$repository worktree add --quiet --detach $source $SourceSha | Out-Null
    if($LASTEXITCODE -ne 0) { throw 'Guest isolated worktree checkout failed' }
    Copy-Item -LiteralPath (Join-Path $guestInputRoot 'dependencies/node_modules') -Destination $source -Recurse
    if((& $git -C $source rev-parse 'HEAD^{tree}') -cne $context.sourceTree -or (& $git -C $source status --porcelain --untracked-files=normal)) { throw 'Guest worktree tree/cleanliness mismatch' }
    if((& $git -C $source rev-parse --git-dir) -eq (& $git -C $source rev-parse --git-common-dir)) { throw 'Guest source isolation missing' }
    foreach($part in @('evidence','temp')) { New-Item -ItemType Directory -Path (Join-Path $root $part) | Out-Null }
    return @{transferVerified=$true;sourceReconstructed=$true;sourceSha=$SourceSha;sourceTree=$context.sourceTree;files=$files.Count;credentialMaterialTransferred=$false}
  }
}

function Test-NativeReadCapability($Session) {
  return Invoke-Command -Session $Session -ScriptBlock {
    $ErrorActionPreference='Stop';$root='C:\aegis-native-read'
    . ($root+'\source\scripts\qualification\cloud-guest-media.ps1')
    $env:TEMP=$root+'\temp';$env:TMP=$env:TEMP
    $dir=$root+'\evidence\capability';New-Item -ItemType Directory -Path $dir | Out-Null
    $helper=$root+'\input\candidate\resources\etw-file\EtwFile.exe'
    $stdout=$dir+'\stdout.log';$stderr=$dir+'\stderr.log'
    $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if(-not $admin) { throw 'Elevated guest setup preflight context unavailable' }
    $privileges=@(& ($env:SystemRoot+'\System32\whoami.exe') /priv /fo csv /nh)
    if($LASTEXITCODE -ne 0 -or ($privileges -join "`n").Length -gt 16KB) { throw 'Read-only token privilege observation failed' }
    $code=Invoke-CloudGuestNativeProcess $helper @('object-bridge-probe') $stdout $stderr 15000
    if((Get-Item -LiteralPath $stdout).Length -gt 4096 -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'Capability probe output shape/budget failed' }
    $value=Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
    if(@($value.PSObject.Properties).Count -ne 2 -or $value.profile -cne 'win11-x64-26300.9457-experimental' -or $value.qualified -isnot [bool]) { throw 'Capability probe response refused' }
    return @{status=$(if($code -eq 0 -and $value.qualified){'PASS'}else{'FAIL'});exitCode=$code;profile=$value.profile;qualified=$value.qualified;tokenContext='existing elevated PowerShell Direct setup session; collector probe still independently required';tokenPrivileges=@($privileges);tokenPrivilegesChanged=$false;helperSha256=(Get-FileHash -LiteralPath $helper).Hash.ToLowerInvariant();nativeDllSha256=(Get-FileHash -LiteralPath ($root+'\input\candidate\resources\etw-file\EtwFile.dll')).Hash.ToLowerInvariant()}
  }
}

function Confirm-NativeReadConsent($Session,[string]$Root,$State,[string]$Id,[string]$Name,[string]$VmRoot,[string]$Phase) {
  $consent=@(Invoke-Command -Session $Session -ScriptBlock {
    @(Get-CimInstance Win32_Process -Filter "Name='consent.exe'") | Select-Object ProcessId,SessionId,ExecutablePath,CreationDate
  })
  if(-not $consent.Count) { return }
  if($consent.Count -ne 1 -or $consent[0].SessionId -le 0 -or $consent[0].ExecutablePath -ine 'C:\Windows\System32\consent.exe') { throw 'Unexpected native-read consent process' }
  $verified=Invoke-Command -Session $Session -ArgumentList ([int]$consent[0].ProcessId) -ScriptBlock {
    param($ConsentPid)
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ConsentPid)
    $policy=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
    $signature=Get-AuthenticodeSignature -LiteralPath $process.ExecutablePath
    if($process.ExecutablePath -ine 'C:\Windows\System32\consent.exe' -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft' -or $policy.EnableLUA -ne 1 -or $policy.PromptOnSecureDesktop -ne 1) { throw 'Secure consent verification failed' }
    return @{pid=$ConsentPid;createdAt=$process.CreationDate.ToUniversalTime().ToString('o');sessionId=$process.SessionId;signature='Valid Microsoft';enableLUA=1;secureDesktopPolicy=1}
  }
  if($State.Count -ge 12) { throw 'Consent count budget exceeded' }
  $capture=Save-NativeReadCapture $Id $Name $VmRoot (Join-Path $Root 'evidence') (100+$State.Count) $Phase
  if($capture.status -ne 'CAPTURED') { throw 'Native-read consent screenshot unavailable' }
  $vm=Get-VM -Id ([guid]$Id)
  if($vm.Name -cne $Name -or $vm.State -ne 'Running' -or -not $vm.ConfigurationLocation.StartsWith($VmRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Consent VM ownership changed' }
  $keyboard=@(Get-WmiObject -Namespace root/virtualization/v2 -Class Msvm_Keyboard -Filter ("SystemName='"+$Id+"'"))
  if($keyboard.Count -ne 1 -or $keyboard[0].SystemCreationClassName -ne 'Msvm_ComputerSystem' -or $keyboard[0].CreationClassName -ne 'Msvm_Keyboard') { throw 'Owned VM keyboard unavailable' }
  $codes=@()
  try {
    $codes+=([uint32]$keyboard[0].PressKey([uint32]18).ReturnValue)
    if($codes[0] -ne 0) { throw 'Owned Alt press failed' }
    $codes+=([uint32]$keyboard[0].TypeKey([uint32]89).ReturnValue)
  } finally { $codes+=([uint32]$keyboard[0].ReleaseKey([uint32]18).ReturnValue) }
  if(@($codes | Where-Object { $_ -ne 0 }).Count) { throw 'Owned consent keyboard result failed' }
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  do {
    $present=Invoke-Command -Session $Session -ArgumentList ([int]$verified.pid),$verified.createdAt -ScriptBlock {
      param($ConsentPid,$Birth)
      $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ConsentPid)
      return [bool]($process -and $process.CreationDate.ToUniversalTime().ToString('o') -ceq $Birth)
    }
    if(-not $present) { break };Start-Sleep -Milliseconds 250
  } while([DateTime]::UtcNow -lt $deadline)
  [void]$State.Add(@{phase=$Phase;observation=$verified;capture=$capture;interaction='Alt+Y on exact owned cloud guest';returnCodes=$codes;closedObserved=(-not $present)})
  if($present) { throw 'Native-read consent did not close' }
}

function Invoke-NativeReadPhase($Session,[string]$Root,[string]$Phase,$Consent,[string]$Id,[string]$Name,[string]$VmRoot) {
  if($Phase -notin @('prepare','resume','admission')) { throw 'Unknown native-read phase' }
  Invoke-Command -Session $Session -ArgumentList $Phase -ScriptBlock {
    param($Phase)
    $root='C:\aegis-native-read';$task='AegisNativeRead-'+$Phase
    if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { throw 'Native-read phase task already exists' }
    $command="& 'C:\aegis-native-read\input\guest.ps1' -Phase '"+$Phase+"'"
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $action=New-ScheduledTaskAction -Execute ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -WindowStyle Hidden -EncodedCommand '+$encoded) -WorkingDirectory $root
    $principal=New-ScheduledTaskPrincipal -UserId 'AegisSetup' -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $task
  }
  $deadline=[DateTime]::UtcNow.AddMinutes(10);$done=$false
  do {
    Confirm-NativeReadConsent $Session $Root $Consent $Id $Name $VmRoot $Phase
    $done=Invoke-Command -Session $Session -ArgumentList $Phase -ScriptBlock { param($Phase);Test-Path -LiteralPath ('C:\aegis-native-read\'+$Phase+'-done.json') }
    if($done) { break };Sample ('native-'+$Phase);Start-Sleep -Seconds 1
  } while([DateTime]::UtcNow -lt $deadline)
  if(-not $done) { throw 'Native-read phase deadline exceeded' }
  $result=Invoke-Command -Session $Session -ArgumentList $Phase -ScriptBlock {
    param($Phase)
    $file='C:\aegis-native-read\'+$Phase+'-done.json'
    if((Get-Item -LiteralPath $file).Length -gt 64KB) { throw 'Native-read result budget' }
    $value=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $task='AegisNativeRead-'+$Phase
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do { $state=(Get-ScheduledTask -TaskName $task).State;if($state -ne 'Running') { break };Start-Sleep -Milliseconds 100 } while([DateTime]::UtcNow -lt $deadline)
    if($state -eq 'Running' -or (Get-ScheduledTaskInfo -TaskName $task).LastTaskResult -ne 0) { throw 'Native-read phase task closure failed' }
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
    return $value
  }
  if($result.status -cne 'PASS' -or $result.sourceSha -cne $env:GITHUB_SHA -or $result.sessionId -le 0 -or $result.integritySid -cne 'S-1-16-8192') { throw ('Native-read '+$Phase+' failed: '+$result.error) }
  return $result
}

function Copy-NativeReadEvidence($Session,[string]$Root) {
  $relative=@('capability/stdout.log','capability/stderr.log','prepare/receipt.json','prepare/scenario/receipt.json','resume/receipt.json','resume/scenario/receipt.json','admission/receipt.json','admission/view.png')
  foreach($phase in @('prepare','resume','admission')) { $relative+=($phase+'-done.json');$relative+=($phase+'.log') }
  foreach($file in $relative) {
    $source=if($file -like '*-done.json' -or $file -notmatch '/') { 'C:\aegis-native-read\'+$file } else { 'C:\aegis-native-read\evidence\'+$file.Replace('/','\') }
    $present=Invoke-Command -Session $Session -ArgumentList $source -ScriptBlock {
      param($File)
      if(-not (Test-Path -LiteralPath $File)) { return $false }
      $item=Get-Item -LiteralPath $File
      if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 2MB) { throw 'Native-read evidence leaf budget' }
      return $true
    }
    if($present) {
      $destination=Join-Path $Root ('evidence/guest/'+$file)
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination -FromSession $Session
    }
  }
}
