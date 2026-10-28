param(
  [Parameter(Mandatory)][ValidateSet('fresh','upgrade','auto-update','all-users','all-users-update')][string]$Scenario,
  [Parameter(Mandatory)][string]$QaRoot,
  [ValidateSet('silent','wizard')][string]$Mode = 'silent',
  [string]$CandidateDirectory,
  [string]$ReleaseDirectory,
  [ValidateSet('ARM64','X64')][string]$ExpectedArchitecture = 'ARM64',
  [switch]$Pr1048Candidate,
  [switch]$Master813804e2Candidate,
  [switch]$G1ACandidate
)
$ErrorActionPreference = 'Stop'
if (@($Pr1048Candidate,$Master813804e2Candidate,$G1ACandidate).Where({ $_ }).Count -gt 1) { throw 'Select exactly one frozen candidate profile' }
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -notin @('github-hosted','github-hosted-hyperv-guest') -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Installer lifecycle requires a disposable GitHub-hosted Windows runner.'
}
$qa = [IO.Path]::GetFullPath($QaRoot)
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if ($ReleaseDirectory -and ($env:RUNNER_ENVIRONMENT -ne 'github-hosted-hyperv-guest' -or $CandidateDirectory -or -not [IO.Path]::GetFullPath($ReleaseDirectory).StartsWith($runnerTemp,[StringComparison]::OrdinalIgnoreCase))) { throw 'Offline releases require owned Hyper-V guest scratch' }
if($Scenario -in @('auto-update','all-users-update') -and (-not $ReleaseDirectory -or $Mode -ne 'wizard' -or $ExpectedArchitecture -ne 'X64')) { throw 'Auto-update requires the owned native x64 Hyper-V guest' }
if($Scenario -eq 'all-users' -and (-not $ReleaseDirectory -or $Mode -ne 'wizard' -or $ExpectedArchitecture -ne 'X64')) { throw 'All-users requires the owned native x64 Hyper-V guest' }
if (-not $qa.StartsWith($runnerTemp, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $qa)) { throw 'Refusing reused or non-runner output' }
New-Item -ItemType Directory -Path $qa | Out-Null
foreach ($part in @('evidence','candidate','previous','temp','cache')) { New-Item -ItemType Directory -Path (Join-Path $qa $part) | Out-Null }
$env:TEMP = Join-Path $qa 'temp'; $env:TMP = $env:TEMP
$installRoot = Join-Path $qa 'install'
if ($Mode -eq 'wizard') { $installRoot = Join-Path $installRoot 'AEGIS - AI Monitoring & Threat Detection' }
if ($Scenario -in @('all-users','all-users-update')) { $installRoot = Join-Path $env:ProgramFiles 'aegis' }
$profile = Join-Path $env:APPDATA 'aegis'
$appExe = Join-Path $installRoot 'AEGIS - AI Monitoring & Threat Detection.exe'
$supportRoot = Join-Path $env:GITHUB_WORKSPACE 'scripts/qualification'
$checker = Join-Path $supportRoot 'windows-installer-profile.cjs'
$currentVersion = '0.20.1-beta'
$previousVersion = '0.20.0-beta'
$candidateSource = $env:GITHUB_SHA
$expectedTree = $null
$reviewedCandidate = $null
$previousCommit = 'd3d277d789da4ca3e38cac54176b6a983a14a3b5'
$previousHash = '9494799164b2c73a195b4fbe6c243a697025a3b119350488828e8288117d72b3'
if ($Pr1048Candidate -or $Master813804e2Candidate) {
  if (-not $CandidateDirectory -or $ReleaseDirectory -or $Scenario -notin @('fresh','upgrade') -or $Mode -ne 'silent' -or $ExpectedArchitecture -ne 'X64') { throw 'Frozen candidate requires fresh/upgrade, silent native x64 and an unpublished build artifact' }
  $currentVersion = '0.21.0-beta'
  $previousVersion = '0.20.1-beta'
  $candidateSource = '5526376f39d01305f98e707e8e2ea9807f68a33b'
  $expectedTree = '0a704c1c2843c7d1ebde9c2eae073ec80d301b3a'
  if ($Master813804e2Candidate) {
    $candidateSource = '813804e2aae1c020f4b17cb7a30f053a210185ef'
    $expectedTree = 'b1710a41cd7eba38ed60dffd6bd8bc3b4fa37d58'
  }
  $previousCommit = '274d65711ac858c9d309c73f1f7c9c4e52872ed1'
  $previousHash = '6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339'
}
function GetG1ACandidate {
  @{
    sourceSha='fb16bc01389ba203b0f99c632f9719bc7dadaf0d'; sourceTree='689e627b243df37e3a7044402c96c58003754ec7'
    version='0.21.0-beta'; filename='AEGIS - AI Monitoring & Threat Detection Setup 0.21.0-beta.exe'
    bytes=188066953; sha256='5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952'
    assetsSha256='e5d68c0d75115c00914aff50c7d2c00fe0bbf570a7958734eeadba87db9d7b59'
  }
}
# The manual G1 lane extracts only these definitions, never this script's main.
function AssertG1ReleaseSelection($Release, [string]$ReleaseId, [string]$InstallerId, [string]$IdentityId) {
  foreach ($id in @($ReleaseId,$InstallerId,$IdentityId)) { if ($id -cnotmatch '^[1-9][0-9]{0,18}$') { throw 'G1 numeric asset selection refused' } }
  if ($InstallerId -eq $IdentityId -or "$($Release.id)" -cne $ReleaseId -or $Release.draft -isnot [bool] -or $Release.draft -cne $true -or $Release.prerelease -isnot [bool] -or $Release.prerelease -cne $false -or $Release.tag_name -cne 'qualification-fb16-delivery-20261028' -or $Release.target_commitish -cne 'fb16bc01389ba203b0f99c632f9719bc7dadaf0d' -or $null -ne $Release.published_at) { throw 'G1 draft release refused' }
  $pin = GetG1ACandidate
  $selected = @()
  foreach ($entry in @(
    @{ id=$InstallerId; name='AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.21.0-beta.exe'; bytes=$pin.bytes; sha256=$pin.sha256; relative=('candidate/'+$pin.filename) },
    @{ id=$IdentityId; name='candidate-identity.json'; bytes=2325; sha256='9e98ab68ec362e52da79bae79d3ba93266e6e02b3a5395a8308b5c7d6eb8b606'; relative='candidate-identity.json' }
  )) {
    $assets = @($Release.assets | Where-Object { "$($_.id)" -ceq $entry.id })
    $url = 'https://api.github.com/repos/antropos17/Aegis/releases/assets/'+$entry.id
    if ($assets.Count -ne 1 -or $assets[0].name -cne $entry.name -or $assets[0].size -ne $entry.bytes -or $assets[0].state -cne 'uploaded' -or $assets[0].url -cne $url -or $assets[0].digest -cne ('sha256:'+$entry.sha256)) { throw 'G1 release asset metadata refused' }
    $selected += $entry
  }
  return $selected
}

function ReceiveG1Candidate([string]$ReleaseId, [string]$InstallerId, [string]$IdentityId, [string]$StageRoot, [string]$Token) {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or $env:GITHUB_REPOSITORY -cne 'antropos17/Aegis' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or !$Token) { throw 'G1 transport host refused' }
  foreach ($id in @($ReleaseId,$InstallerId,$IdentityId)) { if ($id -cnotmatch '^[1-9][0-9]{0,18}$') { throw 'G1 numeric asset selection refused' } }
  $destination = [IO.Path]::GetFullPath($StageRoot)
  $prefix = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
  if (!$destination.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $destination)) { throw 'G1 fresh staging refused' }
  $ancestor = Get-Item -LiteralPath (Split-Path -Parent $destination)
  while ($null -ne $ancestor) { if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'G1 linked staging refused' }; $ancestor=$ancestor.Parent }
  $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect=$false
  $client = [Net.Http.HttpClient]::new($handler); $client.Timeout=[TimeSpan]::FromSeconds(120)
  function ReadG1Response([string]$Url, [string]$Accept, [long]$Limit, [string]$File) {
    $cancel=[Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(120))
    $request=$null; $response=$null; $stream=$null; $output=$null
    try {
      $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$Url)
      [void]$request.Headers.TryAddWithoutValidation('Accept',$Accept)
      [void]$request.Headers.TryAddWithoutValidation('User-Agent','AEGIS-G1-qualification')
      [void]$request.Headers.TryAddWithoutValidation('Authorization','Bearer '+$Token)
      $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
      if ($File -and [int]$response.StatusCode -in @(301,302,303,307,308)) {
        $redirect=$response.Headers.Location
        if (!$redirect.IsAbsoluteUri -or $redirect.Scheme -cne 'https' -or $redirect.Host -cne 'release-assets.githubusercontent.com' -or $redirect.UserInfo) { throw 'G1 asset redirect refused' }
        $response.Dispose(); $request.Dispose()
        # A separate request deliberately carries no Authorization header.
        $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$redirect)
        $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
      }
      if ([int]$response.StatusCode -ne 200 -or ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $Limit)) { throw 'G1 asset HTTP refused' }
      $stream=$response.Content.ReadAsStreamAsync($cancel.Token).GetAwaiter().GetResult()
      $output=if ($File) { [IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) } else { [IO.MemoryStream]::new() }
      $buffer=[byte[]]::new(65536); [long]$bytes=0
      while ($true) { $count=$stream.ReadAsync($buffer,0,$buffer.Length,$cancel.Token).GetAwaiter().GetResult(); if (!$count) { break }; if (($bytes+$count) -gt $Limit) { throw 'G1 asset byte budget exceeded' }; $output.Write($buffer,0,$count); $bytes+=$count }
      if ($File) { if ($bytes -ne $Limit) { throw 'G1 asset incomplete' }; $output.Flush(); return }
      return [Text.Encoding]::UTF8.GetString($output.ToArray())
    } finally {
      if ($output) { $output.Dispose() }; if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }; if ($request) { $request.Dispose() }; $cancel.Dispose()
    }
  }
  try {
    $api='https://api.github.com/repos/antropos17/Aegis'
    $release=ReadG1Response ($api+'/releases/'+$ReleaseId) 'application/vnd.github+json' 65536 '' | ConvertFrom-Json
    $assets=@(AssertG1ReleaseSelection $release $ReleaseId $InstallerId $IdentityId)
    New-Item -ItemType Directory -Path $destination | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $destination 'candidate') | Out-Null
    foreach ($asset in $assets) {
      $file=Join-Path $destination $asset.relative
      ReadG1Response ($api+'/releases/assets/'+$asset.id) 'application/octet-stream' $asset.bytes $file
      if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $asset.sha256) { throw 'G1 downloaded asset pin mismatch' }
    }
  } finally { $client.Dispose(); $handler.Dispose() }
}
if ($G1ACandidate) {
  if (-not $CandidateDirectory -or $ReleaseDirectory -or $Scenario -ne 'fresh' -or $Mode -ne 'silent' -or $ExpectedArchitecture -ne 'X64') { throw 'G1 candidate requires fresh, silent native x64 and an unpublished reviewed artifact' }
  $reviewedCandidate = GetG1ACandidate
  $candidateSource = $reviewedCandidate.sourceSha; $expectedTree = $reviewedCandidate.sourceTree
  $currentVersion = $reviewedCandidate.version
}
$result = [ordered]@{ schema='aegis-installer-lifecycle/1'; status='RUNNING'; scenario=$Scenario; sourceSha=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; capturedAt=[DateTime]::UtcNow.ToString('o'); host=$null; artifacts=@(); phases=@(); limits=@('Silent current-user installation on a disposable GitHub-hosted Windows Server image; interactive wizard and Windows 11 consumer-host behavior are not qualified.','No privileged ETW, provider/VM, protection, Authenticode signing or full W10 acceptance.'); error=$null }
$result.candidateSourceSha = $candidateSource
$result.candidateVersion = $currentVersion
$result.previousVersion = $previousVersion
$result.mode = $Mode
if ($Mode -eq 'wizard') { $result.limits[0] = 'Windows 11 interactive current-user wizard on the recorded architecture. ARM64 runs use x64 emulation; X64 runs require native x64 OS/process observations. All-users elevation, Finish auto-launch and automatic-update delivery are not qualified.' }
function SaveResult { $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $qa 'evidence/result.json') -Encoding utf8 }
function Registrations {
  @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') | ForEach-Object {
    Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'AEGIS*' }
  }
}
function Shortcuts {
  $folders=if($Scenario -in @('all-users','all-users-update')) { @([Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('CommonPrograms')) } else { @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs')) }
  foreach ($folder in $folders) {
    if (Test-Path -LiteralPath $folder) { Get-ChildItem -LiteralPath $folder -Filter '*AEGIS*.lnk' -File -Recurse -ErrorAction Stop }
  }
}
function Sample([string]$phase) {
  $disk = Get-PSDrive -Name ((Split-Path -Qualifier $qa).TrimEnd(':'))
  if ($disk.Free -lt 2GB) { throw 'Less than 2 GiB free on the qualification volume' }
  $result.phases += @{ phase=$phase; capturedAt=[DateTime]::UtcNow.ToString('o'); freeBytes=$disk.Free }
  SaveResult
}
$script:ownedIndex = 0
function RunOwned([string]$File,[string[]]$Arguments,[int]$DeadlineMs) {
  $script:ownedIndex++
  $logPrefix = Join-Path $qa ('evidence/process-' + $script:ownedIndex)
  $p = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput ($logPrefix + '.stdout.log') -RedirectStandardError ($logPrefix + '.stderr.log')
  if (-not $p.WaitForExit($DeadlineMs)) { if (-not $p.HasExited) { $p.Kill($true); [void]$p.WaitForExit(5000) }; throw ('Owned process exceeded deadline: ' + [IO.Path]::GetFileName($File)) }
  $p.Refresh()
  foreach ($log in @(($logPrefix + '.stdout.log'), ($logPrefix + '.stderr.log'))) {
    if ((Get-Item -LiteralPath $log).Length -gt 8MB) { throw 'Owned process diagnostic output exceeded 8 MiB per stream' }
  }
  if ($p.ExitCode -ne 0) {
    Get-Content -LiteralPath ($logPrefix + '.stderr.log') -Tail 80 | Out-Host
    throw ('Owned process failed: ' + [IO.Path]::GetFileName($File) + '; exit=' + $p.ExitCode)
  }
}
function CheckRegistration([string]$Version) {
  $entries = @(Registrations)
  if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne $Version) { throw 'Installed registration/version mismatch' }
  if (@(Shortcuts).Count -lt 1) { throw 'Installation created no expected AEGIS shortcut' }
}
function WaitNoProcesses {
  $prefix = $installRoot.TrimEnd('\') + '\'
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $owned = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })
    if ($owned.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Installed application/helper process remained after shutdown'
}
function ProfileCheck([string]$Phase,[string]$Version) {
  if ($ReleaseDirectory) { $script:driverReady = $true } # Host-pinned driver closure was verified before guest execution.
  if ($Mode -eq 'wizard' -and -not $script:driverReady) {
    # Validate the actual wizard before the costly driver bootstrap in fresh jobs.
    $npmCli = Join-Path (Split-Path (Get-Command node).Source) 'node_modules/npm/bin/npm-cli.js'
    RunOwned (Get-Command node).Source @(('"'+$npmCli+'"'),'ci','--ignore-scripts','--no-audit','--no-fund','--loglevel=error') 300000
    $script:driverReady = $true
  }
  $driverArguments = @(('"'+$checker+'"'),'--exe',('"'+$appExe+'"'),'--root',('"'+$qa+'"'),'--phase',$Phase,'--version',$Version)
  if ($G1ACandidate) { $driverArguments += @('--assets-sha256',$reviewedCandidate.assetsSha256) }
  RunOwned (Get-Command node).Source $driverArguments 150000
  $evidence = Get-Content -LiteralPath (Join-Path $qa ('evidence/'+$Phase+'.json')) -Raw | ConvertFrom-Json
  if ($evidence.status -ne 'PASS' -or $evidence.version -ne $Version) { throw 'Missing matching profile receipt' }
  WaitNoProcesses
}
function Wizard([string]$Action,[string]$File,[string]$Phase) {
  $driver = Join-Path $supportRoot 'windows-installer-wizard.ps1'
  $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $arguments = @('-NoProfile','-STA','-File',('"'+$driver+'"'),'-Action',$Action,'-InstallerFile',('"'+$File+'"'),'-InstallRoot',('"'+$installRoot+'"'),'-QaRoot',('"'+$qa+'"'),'-Phase',$Phase,'-ExpectedArchitecture',$ExpectedArchitecture)
  if ($ReleaseDirectory) {
    # Execute the verified test source as a command in the disposable guest; no execution-policy setting is changed.
    $command = "& ([scriptblock]::Create([IO.File]::ReadAllText('"+$driver.Replace("'","''")+"'))) -Action '"+$Action+"' -InstallerFile '"+$File.Replace("'","''")+"' -InstallRoot '"+$installRoot.Replace("'","''")+"' -QaRoot '"+$qa.Replace("'","''")+"' -Phase '"+$Phase+"' -ExpectedArchitecture '"+$ExpectedArchitecture+"'"
    $arguments = @('-NoProfile','-STA','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))
  }
  RunOwned $powershell $arguments 200000
  $proof = Get-Content -Raw -LiteralPath (Join-Path $qa ('evidence/wizard-'+$Phase+'.json')) | ConvertFrom-Json
  if ($proof.status -ne 'PASS' -or $proof.action -ne $Action -or $proof.phase -ne $Phase) { throw 'Wizard receipt mismatch' }
}
function Install([string]$File,[string]$Version) {
  Sample ('before-install-'+$Version)
  if ($Mode -eq 'wizard' -and $Version -eq $currentVersion) {
    $phase = if ($result.phases.phase -contains 'first-uninstall') { 'reinstall' } elseif ($Scenario -eq 'fresh') { 'fresh' } else { 'upgrade' }
    Wizard 'install' $File $phase
  } else { RunOwned $File @('/S','/currentuser',('/D='+$installRoot)) 180000 }
  if (-not (Test-Path -LiteralPath $appExe)) { throw 'Installed executable missing' }
  CheckRegistration $Version
  Sample ('installed-'+$Version)
}
function Payload {
  $relative = @('AEGIS - AI Monitoring & Threat Detection.exe','resources/app.asar','resources/sidecar/aegis-procsnap.exe')
  @($relative | ForEach-Object { $file=Join-Path $installRoot $_; if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('Installed payload missing: '+$_) }; [ordered]@{ path=$_; bytes=(Get-Item -LiteralPath $file).Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() } })
}
function Uninstall([string]$Phase) {
  WaitNoProcesses
  $settings = Join-Path $profile 'settings.json'; $sentinel = Join-Path $profile 'qualification-sentinel.txt'
  $settingsHash = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
  $sentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) { throw 'Expected exactly one uninstaller' }
  if ($Mode -eq 'wizard') { Wizard 'uninstall' $uninstallers[0].FullName $Phase }
  else { RunOwned $uninstallers[0].FullName @('/S') 180000 }
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while (((Test-Path -LiteralPath $installRoot) -or @(Registrations).Count -or @(Shortcuts).Count) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if ((Test-Path -LiteralPath $installRoot) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Install directory, uninstall registration or shortcut remained' }
  WaitNoProcesses
  if ((Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $settingsHash -or (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Uninstall modified retained settings or synthetic data' }
  $result.phases += @{ phase=$Phase; status='PASS'; registrationRemoved=$true; shortcutsRemoved=$true; applicationRemoved=$true; installDirectoryRemoved=$true; settingsRetained=$true; sentinelRetained=$true; installedProcessesRemaining=0 }
  SaveResult
}
function DownloadVerified([string]$Tag,[string]$Commit,[string]$Pin,[string]$Folder) {
  if ($ReleaseDirectory) { Copy-Item -LiteralPath (Join-Path $ReleaseDirectory $Tag) -Destination $Folder -Recurse; $Folder = Join-Path $Folder $Tag }
  else {
    gh release download $Tag --repo antropos17/Aegis --dir $Folder | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Release download failed' }
  }
  node (Join-Path $env:GITHUB_WORKSPACE 'scripts/release-verify.js') --dir $Folder | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded release signature/hash verification failed' }
  $manifest = Get-Content -LiteralPath (Join-Path $Folder 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.tag -ne $Tag -or $manifest.commit -ne $Commit -or $manifest.repository -ne 'antropos17/Aegis' -or $manifest.files.Count -ne 1) { throw 'Release provenance mismatch' }
  $installer = @(Get-ChildItem -LiteralPath $Folder -Filter '*.exe' -File)
  if ($installer.Count -ne 1 -or (Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash -ne $Pin) { throw 'Independent installer pin mismatch' }
  $result.artifacts += @{ tag=$Tag; commit=$Commit; filename=$installer[0].Name; bytes=$installer[0].Length; sha256=$Pin.ToLowerInvariant(); signatureVerified=$true }
  return $installer[0].FullName
}
function ImportCandidate([string]$Directory) {
  $directoryPath = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  if (-not $directoryPath.StartsWith($runnerTemp,[StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate artifact is outside guest scratch' }
  if ($G1ACandidate) {
    # Copy the existing producer identity verbatim beside candidate/<installer>.
    # Original absolute paths identify entries only; never open host source paths.
    $receiptPath = Join-Path $directoryPath 'candidate-identity.json'
    $identity = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $installer = @($identity.files | Where-Object { [IO.Path]::GetFileName($_.path) -eq $reviewedCandidate.filename })
    $assets = @($identity.files | Where-Object { [IO.Path]::GetFileName($_.path) -eq 'assets.json' })
    if ($identity.candidateSource -ne $candidateSource -or $identity.buildResult -ne 'passed' -or $identity.releasePublished -ne $false -or $installer.Count -ne 1 -or $installer[0].bytes -ne $reviewedCandidate.bytes -or $installer[0].sha256 -ne $reviewedCandidate.sha256 -or $assets.Count -ne 1 -or $assets[0].sha256 -ne $reviewedCandidate.assetsSha256) { throw 'Candidate provenance mismatch' }
    $receipt = @{ sourceSha=$identity.candidateSource; filename=$reviewedCandidate.filename; bytes=$installer[0].bytes; sha256=$installer[0].sha256 }
    $payloadDirectory = Join-Path $directoryPath 'candidate'
  } else {
    $receiptPath = Join-Path $directoryPath 'candidate.json'
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($receipt.schema -ne 'aegis-ci-installer/1' -or $receipt.repository -ne 'antropos17/Aegis' -or $receipt.sourceSha -ne $candidateSource -or ($expectedTree -and $receipt.sourceTree -ne $expectedTree) -or ($Master813804e2Candidate -and ($receipt.sdk -ne '10.0.403' -or $receipt.runtime -ne '10.0.14' -or $receipt.profile -ne 'master813')) -or $receipt.runId -ne $env:GITHUB_RUN_ID -or $receipt.attempt -ne $env:GITHUB_RUN_ATTEMPT -or $receipt.version -ne $currentVersion -or $receipt.releaseSigned -ne $false -or $receipt.published -ne $false) { throw 'Candidate provenance mismatch' }
    $payloadDirectory = $directoryPath
  }
  $files = @(Get-ChildItem -LiteralPath $payloadDirectory -Filter '*.exe' -File)
  if ($files.Count -ne 1 -or $files[0].Name -ne $receipt.filename -or $files[0].Length -ne $receipt.bytes -or $files[0].Length -gt 250MB -or (Get-FileHash -LiteralPath $files[0].FullName -Algorithm SHA256).Hash -ne $receipt.sha256) { throw 'Candidate bytes do not match build receipt' }
  $destination = Join-Path $qa ('candidate/'+$files[0].Name)
  Copy-Item -LiteralPath $files[0].FullName -Destination $destination
  Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $qa ('evidence/'+[IO.Path]::GetFileName($receiptPath)))
  $result.artifacts += @{ source=$(if ($G1ACandidate) { 'reviewed-local-build' } else { 'same-workflow-build' }); commit=$receipt.sourceSha; runId=$receipt.runId; attempt=$receipt.attempt; filename=$receipt.filename; bytes=$receipt.bytes; sha256=$receipt.sha256; signatureVerified=$false }
  $result.limits += $(if ($G1ACandidate) { 'Candidate is an unpublished local build bound to independently reviewed source, installer and portable-asset pins; no same-workflow or signed release provenance.' } else { 'Candidate is an unpublished CI build bound to this source SHA and workflow run; it has no signed release manifest.' })
  return $destination
}
try {
  $os=Get-CimInstance Win32_OperatingSystem
  $result.host=@{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; architecture=$os.OSArchitecture; computer=$env:COMPUTERNAME; runnerEnvironment=$env:RUNNER_ENVIRONMENT; runnerImage=$env:ImageOS; node=(node --version) }
  $result.host.runnerArchitecture = $env:RUNNER_ARCH
  $result.host.interactive = [Environment]::UserInteractive
  $result.host.sessionId = (Get-Process -Id $PID).SessionId
  $result.host.nativeArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $result.host.processArchitecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
  if (($Pr1048Candidate -or $Master813804e2Candidate -or $G1ACandidate) -and ($result.host.nativeArchitecture -ine 'X64' -or $result.host.processArchitecture -ine 'X64')) { throw 'Frozen candidate qualification requires native x64 OS and driver' }
  if ($Mode -eq 'wizard' -and ($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $env:RUNNER_ARCH -ne $ExpectedArchitecture -or $result.host.nativeArchitecture -ine $ExpectedArchitecture)) { throw 'Wizard mode requires the declared Windows 11 architecture' }
  if ($ExpectedArchitecture -eq 'X64' -and $Mode -eq 'wizard' -and $result.host.processArchitecture -ine 'X64') { throw 'Native x64 driver required' }
  SaveResult; Sample 'preflight'
  if ((Test-Path -LiteralPath $profile) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Runner is not clean; refusing existing AEGIS profile/registration/shortcuts' }
  if($Scenario -in @('auto-update','all-users-update')) {
    $result.limits=@('Current-user automatic discovery/download, consent-driven install and relaunch on the observed native x64 Windows 11 guest. No injected update feed, installer or verification bypass.','No all-users, other DPI, Authenticode trust or full sensor/provider/protection acceptance.')
    $previous=DownloadVerified ('aegis-v'+$previousVersion) 'd3d277d789da4ca3e38cac54176b6a983a14a3b5' '9494799164b2c73a195b4fbe6c243a697025a3b119350488828e8288117d72b3' (Join-Path $qa 'previous')
    $originalInstallRoot=$installRoot
    try {
      if($Scenario -eq 'all-users-update') { $installRoot=Join-Path $qa 'install/AEGIS - AI Monitoring & Threat Detection' }
      Wizard 'desktop' $previous 'desktop'
    } finally { $installRoot=$originalInstallRoot }
    if($Scenario -eq 'all-users-update') {
      $result.limits=@('All-users automatic discovery/download, UAC consent, machine update and actual relaunch at 100 percent in the recorded native x64 Windows 11 guest. Baseline setup and final cleanup use separate elevated workers; application/update driver remains limited.','No standard non-admin credential prompt, other DPI, Authenticode/SmartScreen or full W10/product acceptance.')
      . ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $supportRoot 'windows-all-users-update.ps1'))))
      Invoke-AllUsersUpdateQualification $previous
      Sample 'complete';$result.status='PASS';$result.completedAt=[DateTime]::UtcNow.ToString('o');SaveResult
      return
    }
    Install $previous $previousVersion
    ProfileCheck 'baseline' $previousVersion
    $autoDriver=Join-Path $supportRoot 'windows-auto-update.cjs'
    RunOwned (Get-Command node).Source @(('"'+$autoDriver+'"'),'--exe',('"'+$appExe+'"'),'--root',('"'+$qa+'"')) 900000
    $result.automaticUpdate=Get-Content -LiteralPath (Join-Path $qa 'evidence/auto-update.json') -Raw | ConvertFrom-Json
    if($result.automaticUpdate.status -ne 'PASS') { throw 'Automatic update receipt failed' }
    WaitNoProcesses;CheckRegistration $currentVersion
    $result.candidatePayload=@(Payload)
    Uninstall 'final-uninstall'
    Sample 'complete';$result.status='PASS';$result.completedAt=[DateTime]::UtcNow.ToString('o');SaveResult
    return
  }
  $candidate = if ($CandidateDirectory) { ImportCandidate $CandidateDirectory } else { DownloadVerified ('aegis-v'+$currentVersion) '274d65711ac858c9d309c73f1f7c9c4e52872ed1' '6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339' (Join-Path $qa 'candidate') }
  if ($Scenario -eq 'upgrade') { $previous = DownloadVerified ('aegis-v'+$previousVersion) $previousCommit $previousHash (Join-Path $qa 'previous') }
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  if ($Mode -eq 'wizard') {
    $originalInstallRoot=$installRoot
    try {
      if($Scenario -eq 'all-users') { $installRoot=Join-Path $qa 'install/AEGIS - AI Monitoring & Threat Detection' }
      Wizard 'desktop' $candidate 'desktop'
    } finally { $installRoot=$originalInstallRoot }
  }
  if($Scenario -eq 'all-users') {
    $result.limits=@('All-users installation from a limited user with UAC consent, default Program Files/HKLM/common shortcuts and actual Finish launch at 100 percent display scale in the observed native x64 Windows 11 guest.','No other DPI, standard-user credential prompt, all-users auto-update, signing/SmartScreen or full W10 acceptance.')
    . ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $supportRoot 'windows-installer-all-users.ps1'))))
    Invoke-AllUsersQualification $candidate
    Sample 'complete';$result.status='PASS';$result.completedAt=[DateTime]::UtcNow.ToString('o');SaveResult
    return
  }
  if ($Mode -eq 'wizard' -and $Scenario -eq 'fresh') {
    Wizard 'cancel' $candidate 'cancel'
    if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $profile) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Cancelled wizard left installation/profile state' }
    $result.phases += @{ phase='cancel'; status='PASS'; noInstallOrProfileState=$true }; SaveResult
  }
  if ($Scenario -eq 'fresh') { Install $candidate $currentVersion; ProfileCheck 'fresh' $currentVersion }
  else { Install $previous $previousVersion; ProfileCheck 'baseline' $previousVersion; Install $candidate $currentVersion; ProfileCheck 'upgrade' $currentVersion }
  $firstPayload = @(Payload); $result.candidatePayload = $firstPayload
  Uninstall 'first-uninstall'
  if ($G1ACandidate) {
    $result.limits += 'G1 performs exactly one installation, one installed profile check and one uninstall; reinstall and upgrade are not qualified.'
  } else {
    Install $candidate $currentVersion; ProfileCheck 'reinstall' $currentVersion
    $reinstalledPayload = @(Payload)
    if (($firstPayload | ConvertTo-Json -Compress) -ne ($reinstalledPayload | ConvertTo-Json -Compress)) { throw 'Reinstalled payload bytes differ' }
    Uninstall 'final-uninstall'
  }
  Sample 'complete'
  $result.status='PASS'; $result.completedAt=[DateTime]::UtcNow.ToString('o'); SaveResult
} catch {
  $result.status='FAIL'; $result.error=$_.Exception.Message; SaveResult; throw
} finally {
  $files=@(Get-ChildItem -LiteralPath (Join-Path $qa 'evidence') -File)
  if (($files | Measure-Object -Property Length -Sum).Sum -gt 32MB) { throw 'Evidence exceeded 32 MiB limit' }
}
