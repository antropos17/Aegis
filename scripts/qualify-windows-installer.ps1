param([Parameter(Mandatory)][string]$CandidateRoot, [Parameter(Mandatory)][string]$ProfileChecker)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Installer qualification is restricted to a disposable GitHub-hosted Windows runner.' }
$qaRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'aegis-release-qa'))
$installRoot = [IO.Path]::GetFullPath((Join-Path $qaRoot 'install'))
if (-not $installRoot.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation target escaped runner temp' }
$profile = Join-Path $env:APPDATA 'aegis'
$exeName = 'AEGIS - AI Monitoring & Threat Detection.exe'
$appExe = Join-Path $installRoot $exeName
$candidateInstaller = @(Get-ChildItem -LiteralPath (Join-Path $qaRoot 'signed') -Filter '*.exe' -File)
$oldInstaller = @(Get-ChildItem -LiteralPath (Join-Path $qaRoot 'previous') -Filter '*.exe' -File)
if ($candidateInstaller.Count -ne 1 -or $oldInstaller.Count -ne 1) { throw 'Expected exactly one installer for each version' }
function Registrations {
  @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'AEGIS*' })
}
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $profile) -or (Registrations).Count) { throw 'Runner is not clean; refusing to overwrite an installation or profile' }
function RunInstaller([string]$installer) {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', ('/D=' + $installRoot)) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Installer exceeded three minutes' }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $appExe)) { throw 'Installed application is missing' }
}
function CheckRegistration([string]$version) {
  $entries = @(Registrations)
  if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne $version) { throw 'Uninstall registration version/count differs' }
}
function CheckProfile([string]$phase, [string]$version) {
  & node $ProfileChecker --exe $appExe --root $qaRoot --phase $phase --version $version
  if ($LASTEXITCODE) { throw 'Packaged profile check failed' }
}
function CheckPayload {
  foreach ($relative in @($exeName, 'resources/app.asar', 'resources/sidecar/aegis-procsnap.exe')) {
    $built = Join-Path (Join-Path $CandidateRoot 'dist/win-unpacked') $relative
    $installed = Join-Path $installRoot $relative
    if ((Get-FileHash -LiteralPath $built).Hash -ne (Get-FileHash -LiteralPath $installed).Hash) { throw "Installed payload differs: $relative" }
  }
}
function UninstallAndCheck {
  $settings = Join-Path $profile 'settings.json'
  $before = (Get-FileHash -LiteralPath $settings).Hash
  $sentinel = Join-Path $profile 'qualification-sentinel.txt'
  $sentinelBefore = (Get-FileHash -LiteralPath $sentinel).Hash
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) { throw 'Expected one uninstaller' }
  $process = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) { throw 'Uninstaller exceeded three minutes' }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Uninstaller failed with exit $($process.ExitCode)" }
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  # NSIS starts a temporary uninstaller process: the launcher can exit before
  # that process removes the registry entry after deleting the application.
  while (((Test-Path -LiteralPath $appExe) -or (Registrations).Count) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if ((Test-Path -LiteralPath $appExe) -or (Registrations).Count) { throw "Uninstall did not finish: applicationPresent=$(Test-Path -LiteralPath $appExe), registrations=$(@(Registrations).Count)" }
  if ((Get-FileHash -LiteralPath $settings).Hash -ne $before -or (Get-FileHash -LiteralPath $sentinel).Hash -ne $sentinelBefore) { throw 'Uninstaller changed the preserved profile' }
}
RunInstaller $oldInstaller[0].FullName
CheckRegistration '0.14.1-alpha'
CheckProfile 'seed' '0.14.1-alpha'
RunInstaller $candidateInstaller[0].FullName
CheckRegistration '0.15.0-alpha'
CheckPayload
CheckProfile 'verify' '0.15.0-alpha'
UninstallAndCheck
RunInstaller $candidateInstaller[0].FullName
CheckRegistration '0.15.0-alpha'
CheckPayload
CheckProfile 'verify' '0.15.0-alpha'
UninstallAndCheck
[pscustomobject]@{ oldVersion = '0.14.1-alpha'; candidateVersion = '0.15.0-alpha'; upgrade = 'passed'; retainedProfileAfterUninstall = 'passed'; reinstall = 'passed'; finalUninstall = 'passed'; installedPayloadHashes = 'matched'; hostedRunner = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaRoot 'installer-result.json') -Encoding utf8
