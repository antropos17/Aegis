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

# Return a wrapper object so PowerShell 5.1 cannot box the JSON array a second time.
function ConvertFrom-NativeReadManifest {
  param([string]$Json)
  $text=$Json.Trim()
  if($text.Length -lt 2 -or $text.Length -gt 8MB -or -not $text.StartsWith('[') -or -not $text.EndsWith(']')) { throw 'Native input manifest refused' }
  try { $parsed=ConvertFrom-Json -InputObject $text -ErrorAction Stop }
  catch { throw 'Native input manifest refused' }
  $rows=[Collections.Generic.List[object]]::new()
  foreach($row in $parsed) {
    if($null -eq $row -or $row -is [array] -or $row -isnot [pscustomobject]) { throw 'Native input manifest refused' }
    $names=@($row.PSObject.Properties | ForEach-Object { $_.Name })
    if($names.Count -ne 3 -or $names -cnotcontains 'path' -or $names -cnotcontains 'bytes' -or $names -cnotcontains 'sha256' -or
      $row.path -isnot [string] -or $row.path.Length -lt 1 -or $row.path.Length -gt 4096 -or
      ($row.bytes -isnot [long] -and $row.bytes -isnot [int]) -or $row.bytes -lt 0 -or $row.bytes -gt 300MB -or
      $row.sha256 -isnot [string] -or $row.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Native input manifest refused' }
    [void]$rows.Add($row)
    if($rows.Count -gt 30000) { throw 'Native input manifest refused' }
  }
  if($rows.Count -lt 1) { throw 'Native input manifest refused' }
  return [pscustomobject]@{files=$rows.ToArray()}
}

# Both the pre-VM host and the transferred guest consume this exact verifier body.
function Test-NativeReadInputFiles {
  param([string]$InputRoot,[string]$ManifestReader)
  if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $ManifestReader.Length -lt 1 -or $ManifestReader.Length -gt 16KB) { throw 'Native input verifier refused' }
  $inputDirectory=[IO.Path]::GetFullPath($InputRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $directory=Get-Item -LiteralPath $inputDirectory -Force
  if(-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Guest input links refused' }
  $manifest=Join-Path $inputDirectory 'input-manifest.json';$manifestFile=Get-Item -LiteralPath $manifest -Force
  if($manifestFile.PSIsContainer -or ($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $manifestFile.Length -gt 8MB) { throw 'Input manifest budget' }
  $parsed=& ([scriptblock]::Create($ManifestReader)) ([IO.File]::ReadAllText($manifest))
  $files=$parsed.files
  if($files -isnot [array] -or $files.Count -lt 1 -or $files.Count -gt 30000) { throw 'Input file count budget' }
  [long]$totalBytes=0
  foreach($file in $files) {
    $target=[IO.Path]::GetFullPath((Join-Path $inputDirectory $file.path))
    if(-not $target.StartsWith($inputDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Input manifest mismatch' }
    $item=Get-Item -LiteralPath $target -Force
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $target).Hash -ine $file.sha256) { throw 'Input manifest mismatch' }
    $totalBytes+=$item.Length
  }
  if(@(Get-ChildItem -LiteralPath $inputDirectory -Recurse -Force -Attributes ReparsePoint).Count) { throw 'Guest input links refused' }
  return [pscustomobject]@{files=$files.Count;bytes=$totalBytes}
}

# A terminal result is actionable only after a new run of the freshly registered task.
function Get-NativeReadTaskObservation {
  param([string]$State,[datetime]$LastRunUtc,[long]$LastTaskResult,[datetime]$LaunchNotBeforeUtc,[datetime]$BaselineLastRunUtc,[bool]$StartObserved,[bool]$StableState,[string]$PreviousTerminal)
  if($State -cnotin @('Unknown','Disabled','Queued','Ready','Running') -or $LastTaskResult -lt [int]::MinValue -or $LastTaskResult -gt [uint32]::MaxValue) { throw 'Native task observation refused' }
  $freshRun=$LastRunUtc.ToUniversalTime() -gt $BaselineLastRunUtc.ToUniversalTime() -and $LastRunUtc.ToUniversalTime() -ge $LaunchNotBeforeUtc.ToUniversalTime()
  $started=$StartObserved -or $freshRun
  $pendingResult=$LastTaskResult -in @(0x41301,0x41303,0x41325)
  $candidate=$freshRun -and $StableState -and -not $pendingResult -and $State -cnotin @('Running','Queued')
  $terminalKey=if($candidate){$LastRunUtc.ToUniversalTime().Ticks.ToString()+':'+$State+':'+$LastTaskResult}else{$null}
  $terminal=$candidate -and -not [string]::IsNullOrEmpty($PreviousTerminal) -and $PreviousTerminal -ceq $terminalKey
  return [pscustomobject]@{state=$State;stableState=$StableState;started=$started;freshRun=$freshRun;terminalCandidate=$candidate;terminalKey=$terminalKey;terminal=$terminal;lastRunUtc=$LastRunUtc.ToUniversalTime().ToString('o');lastTaskResult=$LastTaskResult}
}

# Closed native diagnostics contain only the profile, qualification bit and fixed code.
function ConvertFrom-NativeReadCapability {
  param([string]$Json,[int]$ExitCode)
  $text=$Json.Trim()
  if($text.Length -lt 2 -or $text.Length -gt 4096 -or -not $text.StartsWith('{') -or -not $text.EndsWith('}')) { throw 'Capability probe response refused' }
  try { $value=ConvertFrom-Json -InputObject $text -ErrorAction Stop }
  catch { throw 'Capability probe response refused' }
  $known=@('Qualified','PlatformRefused','ProfileRefused','ProcessOpenRefused','KnownOpenRefused','IndependentOpenRefused','FileTypeRefused','DuplicateRefused','DuplicateInvalid','DuplicateComparisonRefused','IndependentComparisonRefused','FileIdentityRefused','FileIdentityMismatch','InventoryLibraryRefused','InventoryExportRefused','InventoryQueryRefused','InventoryAccessRefused','InventorySizeRefused','InventoryLayoutRefused','InventoryObjectRefused','InventoryLimitRefused','InventoryKnownMissing','InventoryCopyMissing','InventoryIndependentMissing','InventorySameObjectMismatch','InventoryDistinctObjectMismatch','EntryPointUnavailable','LibraryUnavailable','NativeOperationRefused')
  $names=@($value.PSObject.Properties | ForEach-Object { $_.Name })
  if($value -isnot [pscustomobject] -or $names.Count -ne 3 -or $names -cnotcontains 'profile' -or $names -cnotcontains 'qualified' -or $names -cnotcontains 'code' -or
    $value.profile -isnot [string] -or $value.profile -cne 'win11-x64-26300.9457-experimental' -or $value.qualified -isnot [bool] -or $value.code -isnot [string] -or $value.code -cnotin $known -or
    $ExitCode -notin @(0,2) -or (($ExitCode -eq 0) -ne $value.qualified) -or (($value.code -ceq 'Qualified') -ne $value.qualified)) { throw 'Capability probe response refused' }
  return $value
}

# Transport only the three maintained bounded-process functions, never a guest PS1 file.
function Get-NativeReadProcessSource {
  $fixedPath=Join-Path $PSScriptRoot 'cloud-guest-media.ps1'
  $file=Get-Item -LiteralPath $fixedPath -Force
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 96KB) { throw 'Native process source refused' }
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($fixedPath,[ref]$tokens,[ref]$errors)
  if($errors.Count) { throw 'Native process source refused' }
  $parts=foreach($name in @('Start-CloudGuestNativeProcess','Invoke-CloudGuestNativeProcess','Wait-CloudGuestNativeProcess')) {
    $definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$false))
    if($definitions.Count -ne 1) { throw 'Native process source refused' }
    $definitions[0].Extent.Text
  }
  $text=$parts -join "`n"
  if($text.Length -lt 1 -or $text.Length -gt 16KB) { throw 'Native process source refused' }
  return $text
}

# Execute only the fixed transferred phase entry after hashing the same retained bytes.
# Restricted file execution policy, token privileges and UAC remain unchanged.
function Get-NativeReadPhaseInvocation {
  return {
    param([string]$Phase,[string]$ExpectedHash)
    $ErrorActionPreference='Stop'
    if($Phase -cnotin @('prepare','resume','admission') -or $ExpectedHash -cnotmatch '^[a-f0-9]{64}$' -or $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw 'Native phase entry refused' }
    $fixedPath='C:\aegis-native-read\input\guest.ps1'
    $file=Get-Item -LiteralPath $fixedPath -Force
    if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'Native phase entry refused' }
    $stream=[IO.File]::Open($fixedPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
      if($stream.Length -ne $file.Length -or $stream.Length -lt 1 -or $stream.Length -gt 64KB) { throw 'Native phase entry refused' }
      $bytes=[byte[]]::new([int]$stream.Length);$offset=0
      while($offset -lt $bytes.Length) {
        $count=$stream.Read($bytes,$offset,$bytes.Length-$offset)
        if($count -le 0) { throw 'Native phase entry refused' };$offset+=$count
      }
      if($stream.ReadByte() -ne -1) { throw 'Native phase entry refused' }
    } finally { $stream.Dispose() }
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $actualHash=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if($actualHash -cne $ExpectedHash) { throw 'Native phase entry refused' }
    $source=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
    & ([scriptblock]::Create($source)) -Phase $Phase
  }
}

function Get-NativeReadPhaseCommand([string]$Phase,[string]$ExpectedHash) {
  if($Phase -cnotin @('prepare','resume','admission') -or $ExpectedHash -cnotmatch '^[a-f0-9]{64}$') { throw 'Native phase entry refused' }
  $command='& {'+(Get-NativeReadPhaseInvocation).ToString()+"} -Phase '"+$Phase+"' -ExpectedHash '"+$ExpectedHash+"'"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  if($encoded.Length -gt 24KB) { throw 'Native phase command budget' }
  return $encoded
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
  $manifestReader=(Get-Command ConvertFrom-NativeReadManifest -CommandType Function).ScriptBlock.ToString()
  $inputVerifier=(Get-Command Test-NativeReadInputFiles -CommandType Function).ScriptBlock.ToString()
  if($manifestReader.Length -gt 16KB -or $inputVerifier.Length -gt 8KB) { throw 'Native input manifest reader budget' }
  Invoke-Command -Session $Session -ScriptBlock {
    $root='C:\aegis-native-read'
    if(Test-Path -LiteralPath $root) { throw 'Fresh native-read guest root required' }
    New-Item -ItemType Directory -Path $root | Out-Null
    $acl=Get-Acl -LiteralPath $root
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $root -AclObject $acl
  }
  Copy-Item -LiteralPath $Bundle.path -Destination 'C:\aegis-native-read\input.zip' -ToSession $Session
  return Invoke-Command -Session $Session -ArgumentList $Bundle.sha256,$Bundle.bytes,$env:GITHUB_SHA,$manifestReader,$inputVerifier -ScriptBlock {
    param($Hash,$Bytes,$SourceSha,[string]$ManifestReader,[string]$InputVerifier)
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
    $verified=& ([scriptblock]::Create($InputVerifier)) $guestInputRoot $ManifestReader
    $context=Get-Content -LiteralPath (Join-Path $guestInputRoot 'context.json') -Raw | ConvertFrom-Json
    if($context.sourceSha -cne $SourceSha -or $context.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or $context.coreAutoCrlf -notin @('true','false','input') -or $context.coreEol -notin @('native','lf','crlf')) { throw 'Guest source context mismatch' }
    foreach($part in @('evidence','temp')) { New-Item -ItemType Directory -Path (Join-Path $root $part) | Out-Null }
    $env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted-hyperv-guest'
    $node=Join-Path $guestInputRoot 'runtime/node.exe'
    $gitReceipt=Join-Path $root 'evidence/git-reconstruction.json'
    & $node (Join-Path $guestInputRoot 'runtime/cloud-native-read-git.mjs') --bundle $guestInputRoot --output $root --receipt $gitReceipt | Out-Null
    if($LASTEXITCODE -ne 0) { throw 'Guest copied Git reconstruction failed' }
    if((Get-Item -LiteralPath $gitReceipt).Length -gt 16KB) { throw 'Guest Git receipt budget' }
    $gitProof=Get-Content -LiteralPath $gitReceipt -Raw | ConvertFrom-Json
    if($gitProof.status -cne 'PASS' -or $gitProof.sourceHead -cne $SourceSha -or $gitProof.sourceTree -cne $context.sourceTree -or $gitProof.originalPathFallback -ne $false) { throw 'Guest copied Git proof mismatch' }
    $env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $root 'absent-global-gitconfig';$env:GIT_CONFIG_COUNT='0'
    $env:GIT_EXEC_PATH=Join-Path $guestInputRoot 'runtime/git/libexec/git-core'
    $env:PATH=(Join-Path $guestInputRoot 'runtime/git/bin')+';'+$env:SystemRoot+'\System32'
    $git=Join-Path $guestInputRoot 'runtime/git/bin/git.exe';$source=Join-Path $root 'source'
    Copy-Item -LiteralPath (Join-Path $guestInputRoot 'dependencies/node_modules') -Destination $source -Recurse
    if((& $git -C $source rev-parse 'HEAD^{tree}') -cne $context.sourceTree -or (& $git -C $source status --porcelain --untracked-files=normal)) { throw 'Guest worktree tree/cleanliness mismatch' }
    if((& $git -C $source rev-parse --git-dir) -eq (& $git -C $source rev-parse --git-common-dir)) { throw 'Guest source isolation missing' }
    return @{transferVerified=$true;sourceReconstructed=$true;sourceSha=$SourceSha;sourceTree=$context.sourceTree;files=$verified.files;credentialMaterialTransferred=$false;git=$gitProof}
  }
}

function Test-NativeReadCapability($Session) {
  $nativeSource=Get-NativeReadProcessSource
  $capabilityReader=(Get-Command ConvertFrom-NativeReadCapability -CommandType Function).ScriptBlock.ToString()
  if($capabilityReader.Length -gt 8KB) { throw 'Capability reader budget' }
  return Invoke-Command -Session $Session -ArgumentList $nativeSource,$capabilityReader -ScriptBlock {
    param([string]$NativeProcessSource,[string]$CapabilityReader)
    $ErrorActionPreference='Stop';$root='C:\aegis-native-read'
    $policyBefore=(Get-ExecutionPolicy).ToString()
    if($NativeProcessSource.Length -lt 1 -or $NativeProcessSource.Length -gt 16KB) { throw 'Native process source refused' }
    . ([scriptblock]::Create($NativeProcessSource))
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
    $value=& ([scriptblock]::Create($CapabilityReader)) ([IO.File]::ReadAllText($stdout)) $code
    return @{status=$(if($code -eq 0 -and $value.qualified){'PASS'}else{'FAIL'});exitCode=$code;profile=$value.profile;qualified=$value.qualified;code=$value.code;executionPolicyBefore=$policyBefore;executionPolicyAfter=(Get-ExecutionPolicy).ToString();tokenContext='existing elevated PowerShell Direct setup session; collector probe still independently required';tokenPrivileges=@($privileges);tokenPrivilegesChanged=$false;helperSha256=(Get-FileHash -LiteralPath $helper).Hash.ToLowerInvariant();nativeDllSha256=(Get-FileHash -LiteralPath ($root+'\input\candidate\resources\etw-file\EtwFile.dll')).Hash.ToLowerInvariant()}
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
  $guestHash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'windows-native-read-guest.ps1')).Hash.ToLowerInvariant()
  $encoded=Get-NativeReadPhaseCommand $Phase $guestHash
  $taskLaunch=Invoke-Command -Session $Session -ArgumentList $Phase,$encoded -ScriptBlock {
    param($Phase,[string]$Encoded)
    $root='C:\aegis-native-read';$task='AegisNativeRead-'+$Phase
    if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { throw 'Native-read phase task already exists' }
    $action=New-ScheduledTaskAction -Execute ($env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -WindowStyle Hidden -EncodedCommand '+$Encoded) -WorkingDirectory $root
    $principal=New-ScheduledTaskPrincipal -UserId 'AegisSetup' -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings | Out-Null
    $baseline=(Get-ScheduledTaskInfo -TaskName $task).LastRunTime.ToUniversalTime()
    $requested=[DateTime]::UtcNow
    # Task Scheduler reports LastRunTime at second precision. The registration baseline
    # also has to advance, so a stale/default result cannot satisfy this boundary.
    $notBefore=$requested.AddTicks(-($requested.Ticks % [TimeSpan]::TicksPerSecond))
    Start-ScheduledTask -TaskName $task
    return @{notBeforeUtc=$notBefore.ToString('o');baselineLastRunUtc=$baseline.ToString('o')}
  }
  $deadline=[DateTime]::UtcNow.AddMinutes(10);$done=$false;$started=$false;$previousTerminal=$null
  $watch=[Diagnostics.Stopwatch]::StartNew();$nextHeartbeat=0
  do {
    Confirm-NativeReadConsent $Session $Root $Consent $Id $Name $VmRoot $Phase
    $observed=Invoke-Command -Session $Session -ArgumentList $Phase -ScriptBlock {
      param($Phase)
      $task='AegisNativeRead-'+$Phase;$before=(Get-ScheduledTask -TaskName $task).State.ToString();$info=Get-ScheduledTaskInfo -TaskName $task;$after=(Get-ScheduledTask -TaskName $task).State.ToString()
      return @{done=(Test-Path -LiteralPath ('C:\aegis-native-read\'+$Phase+'-done.json'));state=$after;stableState=($before -ceq $after);lastRunUtc=$info.LastRunTime.ToUniversalTime().ToString('o');lastTaskResult=[long]$info.LastTaskResult}
    }
    $taskState=Get-NativeReadTaskObservation $observed.state ([datetime]$observed.lastRunUtc) $observed.lastTaskResult ([datetime]$taskLaunch.notBeforeUtc) ([datetime]$taskLaunch.baselineLastRunUtc) $started $observed.stableState $previousTerminal
    $started=$taskState.started;$previousTerminal=$taskState.terminalKey;$done=$observed.done;$report.phaseTasks[$Phase]=$taskState
    if($done) { break }
    if($taskState.terminal) { SaveReport;throw ('Native-read phase ended without receipt: '+$Phase+'; task result '+$taskState.lastTaskResult) }
    if($watch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
      Write-Host ('Native phase '+$Phase+': elapsed='+[int]$watch.Elapsed.TotalSeconds+'s; state='+$taskState.state+'; started='+$started+'; result='+$taskState.lastTaskResult)
      $nextHeartbeat=$watch.Elapsed.TotalSeconds+30
    }
    Sample ('native-'+$Phase);Start-Sleep -Seconds 1
  } while([DateTime]::UtcNow -lt $deadline)
  if(-not $done) { throw 'Native-read phase deadline exceeded' }
  $taskReader=(Get-Command Get-NativeReadTaskObservation -CommandType Function).ScriptBlock.ToString()
  $completed=Invoke-Command -Session $Session -ArgumentList $Phase,$taskLaunch,$taskReader -ScriptBlock {
    param($Phase,$Launch,[string]$TaskReader)
    $file='C:\aegis-native-read\'+$Phase+'-done.json'
    if((Get-Item -LiteralPath $file).Length -gt 64KB) { throw 'Native-read result budget' }
    $value=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $task='AegisNativeRead-'+$Phase
    $deadline=[DateTime]::UtcNow.AddSeconds(10);$previous=$null;$sample=$null
    do {
      $before=(Get-ScheduledTask -TaskName $task).State.ToString();$info=Get-ScheduledTaskInfo -TaskName $task;$after=(Get-ScheduledTask -TaskName $task).State.ToString()
      $sample=& ([scriptblock]::Create($TaskReader)) $after ($info.LastRunTime.ToUniversalTime()) ([long]$info.LastTaskResult) ([datetime]$Launch.notBeforeUtc) ([datetime]$Launch.baselineLastRunUtc) $true ($before -ceq $after) $previous
      $previous=$sample.terminalKey
      if($sample.terminal) { break };Start-Sleep -Milliseconds 100
    } while([DateTime]::UtcNow -lt $deadline)
    $closed=$sample.terminal -and $sample.lastTaskResult -eq 0
    if($closed) { Unregister-ScheduledTask -TaskName $task -Confirm:$false }
    return @{value=$value;task=$sample;closureConfirmed=$closed}
  }
  $report.phaseTasks[$Phase]=$completed.task;SaveReport
  if(-not $completed.closureConfirmed) { throw 'Native-read phase task closure failed' }
  $result=$completed.value
  if($result.status -cne 'PASS' -or $result.sourceSha -cne $env:GITHUB_SHA -or $result.sessionId -le 0 -or $result.integritySid -cne 'S-1-16-8192') { throw ('Native-read '+$Phase+' failed: '+$result.error) }
  return $result
}

function Copy-NativeReadEvidence($Session,[string]$Root) {
  $relative=@('capability/stdout.log','capability/stderr.log','prepare/receipt.json','prepare/scenario/receipt.json','prepare/scenario/lost/window-observation.json','prepare/scenario/lost/startup-failure.json','resume/receipt.json','resume/scenario/receipt.json','resume/scenario/recovery/window-observation.json','resume/scenario/recovery/startup-failure.json','resume/scenario/normal/window-observation.json','admission/receipt.json','admission/window-observation.json','admission/view.png')
  $gitProof=Invoke-Command -Session $Session -ScriptBlock {
    $file='C:\aegis-native-read\evidence\git-reconstruction.json'
    if(-not (Test-Path -LiteralPath $file)) { return $false }
    $item=Get-Item -LiteralPath $file
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 16KB) { throw 'Guest Git evidence budget/layout refused' }
    return $true
  }
  if($gitProof) { Copy-Item -LiteralPath 'C:\aegis-native-read\evidence\git-reconstruction.json' -Destination (Join-Path $Root 'evidence/guest-git-reconstruction.json') -FromSession $Session }
  foreach($phase in @('prepare','resume','admission')) { $relative+=($phase+'-done.json');$relative+=($phase+'.log') }
  foreach($file in $relative) {
    $source=if($file -like '*-done.json' -or $file -notmatch '/') { 'C:\aegis-native-read\'+$file } else { 'C:\aegis-native-read\evidence\'+$file.Replace('/','\') }
    $leafBudget=if($file -like '*/window-observation.json'){4096}elseif($file -like '*/startup-failure.json'){16384}else{2MB}
    $present=Invoke-Command -Session $Session -ArgumentList $source,$leafBudget -ScriptBlock {
      param($File,$Budget)
      if(-not (Test-Path -LiteralPath $File)) { return $false }
      $item=Get-Item -LiteralPath $File
      if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt $Budget) { throw 'Native-read evidence leaf budget' }
      return $true
    }
    if($present) {
      $destination=Join-Path $Root ('evidence/guest/'+$file)
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination -FromSession $Session
    }
  }
}
