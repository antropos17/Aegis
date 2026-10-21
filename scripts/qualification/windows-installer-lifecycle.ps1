param(
  [Parameter(Mandatory)][ValidateSet('fresh','upgrade')][string]$Scenario,
  [Parameter(Mandatory)][string]$QaRoot
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Installer lifecycle requires a disposable GitHub-hosted Windows runner.'
}
$qa = [IO.Path]::GetFullPath($QaRoot)
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $qa.StartsWith($runnerTemp, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $qa)) { throw 'Refusing reused or non-runner output' }
New-Item -ItemType Directory -Path $qa | Out-Null
foreach ($part in @('evidence','candidate','previous','temp','cache')) { New-Item -ItemType Directory -Path (Join-Path $qa $part) | Out-Null }
$env:TEMP = Join-Path $qa 'temp'; $env:TMP = $env:TEMP
$installRoot = Join-Path $qa 'install'
$profile = Join-Path $env:APPDATA 'aegis'
$appExe = Join-Path $installRoot 'AEGIS - AI Monitoring & Threat Detection.exe'
$checker = Join-Path $PSScriptRoot 'windows-installer-profile.cjs'
$result = [ordered]@{ schema='aegis-installer-lifecycle/1'; status='RUNNING'; scenario=$Scenario; sourceSha=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; capturedAt=[DateTime]::UtcNow.ToString('o'); host=$null; artifacts=@(); phases=@(); limits=@('Silent current-user installation on a disposable GitHub-hosted Windows Server image; interactive wizard and Windows 11 consumer-host behavior are not qualified.','No privileged ETW, provider/VM, protection, Authenticode signing or full W10 acceptance.'); error=$null }
function SaveResult { $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $qa 'evidence/result.json') -Encoding utf8 }
function Registrations {
  @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') | ForEach-Object {
    Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'AEGIS*' }
  }
}
function Shortcuts {
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))) {
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
  $driverArguments = @(('"'+$checker+'"'),'--exe',('"'+$appExe+'"'),'--root',('"'+$qa+'"'),'--phase',$Phase,'--version',$Version)
  RunOwned (Get-Command node).Source $driverArguments 150000
  $evidence = Get-Content -LiteralPath (Join-Path $qa ('evidence/'+$Phase+'.json')) -Raw | ConvertFrom-Json
  if ($evidence.status -ne 'PASS' -or $evidence.version -ne $Version) { throw 'Missing matching profile receipt' }
  WaitNoProcesses
}
function Install([string]$File,[string]$Version) {
  Sample ('before-install-'+$Version)
  RunOwned $File @('/S','/currentuser',('/D='+$installRoot)) 180000
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
  RunOwned $uninstallers[0].FullName @('/S') 180000
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while (((Test-Path -LiteralPath $installRoot) -or @(Registrations).Count -or @(Shortcuts).Count) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if ((Test-Path -LiteralPath $installRoot) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Install directory, uninstall registration or shortcut remained' }
  WaitNoProcesses
  if ((Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -ne $settingsHash -or (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Uninstall modified retained settings or synthetic data' }
  $result.phases += @{ phase=$Phase; status='PASS'; registrationRemoved=$true; shortcutsRemoved=$true; applicationRemoved=$true; installDirectoryRemoved=$true; settingsRetained=$true; sentinelRetained=$true; installedProcessesRemaining=0 }
  SaveResult
}
function DownloadVerified([string]$Tag,[string]$Commit,[string]$Pin,[string]$Folder) {
  gh release download $Tag --repo antropos17/Aegis --dir $Folder | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Release download failed' }
  node (Join-Path $env:GITHUB_WORKSPACE 'scripts/release-verify.js') --dir $Folder | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded release signature/hash verification failed' }
  $manifest = Get-Content -LiteralPath (Join-Path $Folder 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.tag -ne $Tag -or $manifest.commit -ne $Commit -or $manifest.repository -ne 'antropos17/Aegis' -or $manifest.files.Count -ne 1) { throw 'Release provenance mismatch' }
  $installer = @(Get-ChildItem -LiteralPath $Folder -Filter '*.exe' -File)
  if ($installer.Count -ne 1 -or (Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash -ne $Pin) { throw 'Independent installer pin mismatch' }
  $result.artifacts += @{ tag=$Tag; commit=$Commit; filename=$installer[0].Name; bytes=$installer[0].Length; sha256=$Pin.ToLowerInvariant(); signatureVerified=$true }
  return $installer[0].FullName
}
try {
  $os=Get-CimInstance Win32_OperatingSystem
  $result.host=@{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; architecture=$os.OSArchitecture; computer=$env:COMPUTERNAME; runnerEnvironment=$env:RUNNER_ENVIRONMENT; runnerImage=$env:ImageOS; node=(node --version) }
  SaveResult; Sample 'preflight'
  if ((Test-Path -LiteralPath $profile) -or @(Registrations).Count -or @(Shortcuts).Count) { throw 'Runner is not clean; refusing existing AEGIS profile/registration/shortcuts' }
  $candidate = DownloadVerified 'aegis-v0.20.0-beta' 'd3d277d789da4ca3e38cac54176b6a983a14a3b5' '9494799164b2c73a195b4fbe6c243a697025a3b119350488828e8288117d72b3' (Join-Path $qa 'candidate')
  if ($Scenario -eq 'upgrade') { $previous = DownloadVerified 'aegis-v0.19.2-beta' '0bda7dc110211d9fb4aad7baf6e332adc12e2a89' 'ef389f663487c44b09d3a6528db7eacd70a68f697ccb46d933055a9c9868a226' (Join-Path $qa 'previous') }
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  if ($Scenario -eq 'fresh') { Install $candidate '0.20.0-beta'; ProfileCheck 'fresh' '0.20.0-beta' }
  else { Install $previous '0.19.2-beta'; ProfileCheck 'baseline' '0.19.2-beta'; Install $candidate '0.20.0-beta'; ProfileCheck 'upgrade' '0.20.0-beta' }
  $firstPayload = @(Payload); $result.candidatePayload = $firstPayload
  Uninstall 'first-uninstall'
  Install $candidate '0.20.0-beta'; ProfileCheck 'reinstall' '0.20.0-beta'
  $reinstalledPayload = @(Payload)
  if (($firstPayload | ConvertTo-Json -Compress) -ne ($reinstalledPayload | ConvertTo-Json -Compress)) { throw 'Reinstalled payload bytes differ' }
  Uninstall 'final-uninstall'
  Sample 'complete'
  $result.status='PASS'; $result.completedAt=[DateTime]::UtcNow.ToString('o'); SaveResult
} catch {
  $result.status='FAIL'; $result.error=$_.Exception.Message; SaveResult; throw
} finally {
  $files=@(Get-ChildItem -LiteralPath (Join-Path $qa 'evidence') -File)
  if (($files | Measure-Object -Property Length -Sum).Sum -gt 32MB) { throw 'Evidence exceeded 32 MiB limit' }
}
