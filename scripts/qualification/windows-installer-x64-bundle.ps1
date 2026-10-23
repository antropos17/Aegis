function New-InstallerGuestBundle([string]$Root,[string]$Scenario,[string]$VmId) {
  $bundle=Join-Path $Root 'bundle'
  New-Item -ItemType Directory -Path $bundle | Out-Null
  foreach($part in @('source/scripts/qualification','source/keys','source/node_modules','runtime','releases')) { New-Item -ItemType Directory -Path (Join-Path $bundle $part) -Force | Out-Null }
  foreach($name in @('windows-installer-lifecycle.ps1','windows-installer-wizard.ps1','windows-installer-profile.cjs','windows-launch-diagnostics.cjs','windows-installer-paths.cjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $bundle 'source/scripts/qualification') }
  if($Scenario -in @('auto-update','all-users-update')) { foreach($name in @('windows-auto-update.cjs','windows-updater-cache.cjs','windows-updater-desktop.ps1','windows-updater-observer.cjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $bundle 'source/scripts/qualification') } }
  if($Scenario -eq 'all-users-update') { foreach($name in @('windows-all-users-update.ps1','windows-all-users-update-worker.ps1','InstallerProcessObservation.cs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $bundle 'source/scripts/qualification') } }
  if($Scenario -eq 'all-users') { foreach($name in @('windows-installer-all-users.ps1','windows-all-users-worker.ps1','windows-installer-finish.ps1','windows-installer-shell.ps1','InstallerProcessObservation.cs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $bundle 'source/scripts/qualification') } }
  foreach($file in @('scripts/release-verify.js','keys/aegis-release-pubkey.pub','package.json')) { Copy-Item -LiteralPath (Join-Path $env:GITHUB_WORKSPACE $file) -Destination (Join-Path $bundle ('source/'+$file)) }
  foreach($package in @('playwright','playwright-core')) { Copy-Item -LiteralPath (Join-Path $env:GITHUB_WORKSPACE ('node_modules/'+$package)) -Destination (Join-Path $bundle 'source/node_modules') -Recurse }
  Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $bundle 'runtime/node.exe')
  $pwshHome=Split-Path (Get-Command pwsh.exe).Source
  Copy-Item -LiteralPath $pwshHome -Destination (Join-Path $bundle 'runtime/pwsh') -Recurse
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-installer-x64-guest.ps1') -Destination (Join-Path $bundle 'guest.ps1')
  $tags=if($Scenario -in @('auto-update','all-users-update')) { @('aegis-v0.20.0-beta') } else { @('aegis-v0.20.1-beta'); if($Scenario -eq 'upgrade') { 'aegis-v0.20.0-beta' } }
  foreach($tag in $tags) {
    $destination=Join-Path $bundle ('releases/'+$tag)
    New-Item -ItemType Directory -Path $destination | Out-Null
    gh release download $tag --repo antropos17/Aegis --dir $destination | Out-Host
    if($LASTEXITCODE -ne 0) { throw 'Published release download failed' }
    node (Join-Path $bundle 'source/scripts/release-verify.js') --dir $destination | Out-Host
    if($LASTEXITCODE -ne 0) { throw 'Published release verification failed' }
  }
  @{ sourceSha=$env:GITHUB_SHA; runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; scenario=$Scenario; vmId=$VmId } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'context.json') -Encoding UTF8
  $files=@(Get-ChildItem -LiteralPath $bundle -Recurse -File)
  if(@(Get-ChildItem -LiteralPath $bundle -Recurse -Force -Attributes ReparsePoint).Count -or ($files | Measure-Object Length -Sum).Sum -gt 1GB) { throw 'Guest bundle layout/budget refused' }
  $manifest=@($files | ForEach-Object { @{path=$_.FullName.Substring($bundle.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Root 'evidence/input-manifest.json') -Encoding UTF8
  Copy-Item -LiteralPath (Join-Path $Root 'evidence/input-manifest.json') -Destination (Join-Path $bundle 'input-manifest.json')
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=Join-Path $Root 'input.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($bundle,$zip,[IO.Compression.CompressionLevel]::Fastest,$false)
  return @{path=$zip;bytes=(Get-Item -LiteralPath $zip).Length;sha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant();files=$files.Count}
}

function Invoke-InstallerGuestTest($Session,[string]$Root,$Bundle,[string]$Scenario) {
  $guestRoot='C:\aegis-installer-qa'
  Invoke-Command -Session $Session -ScriptBlock {
    if(Test-Path -LiteralPath C:/aegis-installer-qa) { throw 'Guest input root already exists' }
    New-Item -ItemType Directory -Path C:/aegis-installer-qa | Out-Null
    $acl=Get-Acl -LiteralPath C:/aegis-installer-qa
    $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule);Set-Acl -LiteralPath C:/aegis-installer-qa -AclObject $acl
  }
  Copy-Item -LiteralPath $Bundle.path -Destination ($guestRoot+'\input.zip') -ToSession $Session
  $prepared=Invoke-Command -Session $Session -ArgumentList $Bundle.sha256,$Bundle.bytes -ScriptBlock {
    param($Hash,$Bytes)
    $zip='C:\aegis-installer-qa\input.zip'
    if((Get-Item -LiteralPath $zip).Length -ne $Bytes -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $Hash) { throw 'Guest bundle bytes changed in transit' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $inputRoot='C:\aegis-installer-qa\input'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,$inputRoot)
    $manifest=Get-Content -LiteralPath ($inputRoot+'\input-manifest.json') -Raw | ConvertFrom-Json
    foreach($item in $manifest) {
      $file=[IO.Path]::GetFullPath((Join-Path $inputRoot $item.path))
      if(-not $file.StartsWith($inputRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $file).Length -ne $item.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Transferred guest input mismatch' }
    }
    $command="& ([scriptblock]::Create([IO.File]::ReadAllText('C:\aegis-installer-qa\input\guest.ps1')))"
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $action=New-ScheduledTaskAction -Execute ($inputRoot+'\runtime\pwsh\pwsh.exe') -Argument ('-NoProfile -WindowStyle Hidden -EncodedCommand '+$encoded) -WorkingDirectory ($inputRoot+'\source')
    $principal=New-ScheduledTaskPrincipal -UserId 'AegisSetup' -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 18)
    Register-ScheduledTask -TaskName 'AegisInstallerQualification' -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName 'AegisInstallerQualification'
    return @{transferVerified=$true;files=$manifest.Count;interactiveTaskSubmitted=$true}
  }
  $deadline=[DateTime]::UtcNow.AddMinutes(18)
  $allUsers=@{started=@();tasks=@();consent=$null}
  $machineUpdate=@{started=@();tasks=@();consent=$null;intent=$null;elevatedInstaller=$null}
  $hostError=$null
  do {
    if($Scenario -eq 'all-users-update') {
      try { Invoke-AllUsersUpdateGuestStep $Session $Root $machineUpdate $id $name $vmRoot }
      catch {
        $hostError=$_.Exception.Message;$machineUpdate.error=$hostError
        $machineUpdate | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath (Join-Path $Root 'evidence/all-users-update-host.json') -Encoding UTF8
        break
      }
    }
    if($Scenario -eq 'all-users') {
      try { Invoke-AllUsersGuestStep $Session $Root $allUsers $id $name $vmRoot }
      catch {
        $hostError=$_.Exception.Message;$allUsers.error=$hostError
        $allUsers | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $Root 'evidence/all-users-host.json') -Encoding UTF8
        break
      }
    }
    $done=Invoke-Command -Session $Session -ScriptBlock { Test-Path -LiteralPath C:/aegis-installer-qa/done.json }
    if($done) { break }
    Sample 'guest-test'
    Start-Sleep -Seconds $(if($Scenario -in @('all-users','all-users-update')){1}else{10})
  } while([DateTime]::UtcNow -lt $deadline)
  # Only bounded test evidence leaves cross back; never collect answer files, profiles or credentials.
  $entries=Invoke-Command -Session $Session -ArgumentList $Scenario -ScriptBlock {
    param($Case)
    $dir='C:\aegis-installer-qa\'+$Case+'\evidence'
    if(-not (Test-Path -LiteralPath $dir)) { return @() }
    $files=@(Get-ChildItem -LiteralPath $dir -File)
    if($files.Count -gt 100 -or ($files|Measure-Object Length -Sum).Sum -gt 32MB -or @($files|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Extension -notin @('.json','.png','.log')}).Count) { throw 'Guest evidence budget/layout refused' }
    return @($files | Select-Object Name,Length)
  }
  $destination=Join-Path $Root 'evidence/lifecycle'
  New-Item -ItemType Directory -Path $destination | Out-Null
  foreach($file in $entries) { Copy-Item -LiteralPath ($guestRoot+'\'+$Scenario+'\evidence\'+$file.Name) -Destination $destination -FromSession $Session }
  if($hostError) { throw ('All-users host observation failed: '+$hostError) }
  if(-not $done) { throw 'Guest lifecycle deadline exceeded' }
  Copy-Item -LiteralPath ($guestRoot+'\done.json') -Destination (Join-Path $Root 'evidence/guest-done.json') -FromSession $Session
  $result=Get-Content -LiteralPath (Join-Path $Root 'evidence/guest-done.json') -Raw | ConvertFrom-Json
  if($result.status -ne 'PASS' -or $result.architecture -ne 'X64' -or $result.sourceSha -ne $env:GITHUB_SHA -or $result.sessionId -eq 0) { throw 'Guest lifecycle failed or witness mismatch' }
  if($Scenario -eq 'all-users' -and (-not $allUsers.consent -or $allUsers.started.Count -ne 2)) { throw 'All-users consent/cleanup evidence incomplete' }
  if($Scenario -eq 'all-users-update' -and (-not $machineUpdate.consent.closedObserved -or -not $machineUpdate.elevatedInstaller -or $machineUpdate.started.Count -ne 2)) { throw 'All-users update elevation/cleanup evidence incomplete' }
  return @{input=$prepared;result=$result}
}
