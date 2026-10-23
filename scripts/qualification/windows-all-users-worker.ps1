$ErrorActionPreference='Stop'
try {
$root='C:\aegis-installer-qa';$inputRoot=Join-Path $root 'input'
$context=Get-Content -LiteralPath (Join-Path $inputRoot 'context.json') -Raw | ConvertFrom-Json
if($context.scenario -ne 'all-users' -or $env:USERNAME -ne 'AegisSetup' -or -not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -le 0) { throw 'Owned interactive all-users guest required' }
$env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted-hyperv-guest';$env:RUNNER_OS='Windows';$env:RUNNER_ARCH='X64'
$env:GITHUB_SHA=$context.sourceSha;$env:GITHUB_RUN_ID=$context.runId;$env:GITHUB_RUN_ATTEMPT=$context.attempt
$env:RUNNER_TEMP=$root;$env:GITHUB_WORKSPACE=Join-Path $inputRoot 'source'
$qa=Join-Path $root 'all-users'
$request=Get-Content -LiteralPath (Join-Path $qa 'request.json') -Raw | ConvertFrom-Json
$install=Join-Path $env:ProgramFiles 'aegis'
$driver=Join-Path $env:GITHUB_WORKSPACE 'scripts/qualification/windows-installer-wizard.ps1'
if($request.sourceSha -ne $context.sourceSha -or $request.action -notin @('install','uninstall')) { throw 'Unexpected desktop request' }
$options=@{Action=$request.action;InstallerFile=$request.file;InstallRoot=$install;QaRoot=$qa;ExpectedArchitecture='X64';AllUsers=$true}
if($request.action -eq 'install') {
  $file=[IO.Path]::GetFullPath($request.file)
  if(-not $file.StartsWith($qa+'\candidate\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file).Hash -ne '6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339') { throw 'Installer pin/ownership mismatch' }
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$request.pid)
  if(-not $process -or $process.ExecutablePath -ine $file -or $process.CreationDate.ToUniversalTime().ToString('o') -ne $request.created) { throw 'Initial installer identity changed' }
  $options.ExistingPid=[int]$request.pid;$options.Phase='fresh'
} else {
  $expected=@(Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe' -File)
  if($expected.Count -ne 1 -or $request.file -ine $expected[0].FullName) { throw 'Owned uninstaller mismatch' }
  $options.Phase='final-uninstall'
}
& ([scriptblock]::Create([IO.File]::ReadAllText($driver))) @options
} catch {
  @{status='FAIL';error=$_.Exception.Message;stack=$_.ScriptStackTrace} | ConvertTo-Json | Set-Content -LiteralPath 'C:\aegis-installer-qa\all-users\evidence\worker-error.json' -Encoding UTF8
  throw
}
