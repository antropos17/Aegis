$ErrorActionPreference='Stop'
$root='C:\aegis-installer-qa'
$inputRoot=Join-Path $root 'input'
$context=Get-Content -LiteralPath (Join-Path $inputRoot 'context.json') -Raw | ConvertFrom-Json
$result=[ordered]@{status='RUNNING';sourceSha=$context.sourceSha;scenario=$context.scenario;vmId=$context.vmId;architecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString();processArchitecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();sessionId=(Get-Process -Id $PID).SessionId;interactive=[Environment]::UserInteractive;error=$null}
try {
  $os=Get-CimInstance Win32_OperatingSystem
  if($os.Caption -notmatch 'Windows 11' -or $os.ProductType -ne 1 -or $os.BuildNumber -ne '26300' -or $result.architecture -ine 'X64' -or $result.processArchitecture -ine 'X64' -or $env:USERNAME -ne 'AegisSetup' -or $result.sessionId -eq 0 -or -not $result.interactive -or @(Get-CimInstance Win32_Processor | Where-Object Architecture -ne 9).Count) { throw 'Fresh interactive native x64 Windows 11 guest required' }
  if($context.runId -notmatch '^\d+$' -or $context.attempt -notmatch '^\d+$' -or $context.sourceSha -notmatch '^[a-f0-9]{40}$' -or $context.scenario -notin @('fresh','upgrade')) { throw 'Guest run context invalid' }
  $env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted-hyperv-guest';$env:RUNNER_OS='Windows';$env:RUNNER_ARCH='X64'
  $env:GITHUB_SHA=$context.sourceSha;$env:GITHUB_RUN_ID=$context.runId;$env:GITHUB_RUN_ATTEMPT=$context.attempt
  $env:RUNNER_TEMP=$root;$env:GITHUB_WORKSPACE=Join-Path $inputRoot 'source';$env:ImageOS='Windows11-EnterpriseEval-x64-HyperV'
  $env:PATH=(Join-Path $inputRoot 'runtime')+';'+$env:PATH
  $env:TEMP=$root;$env:TMP=$root;$env:CI='true';$env:HUSKY='0'
  Set-Location -LiteralPath $env:GITHUB_WORKSPACE
  $script=Join-Path $env:GITHUB_WORKSPACE 'scripts/qualification/windows-installer-lifecycle.ps1'
  & ([scriptblock]::Create([IO.File]::ReadAllText($script))) -Scenario $context.scenario -QaRoot (Join-Path $root $context.scenario) -Mode wizard -ExpectedArchitecture X64 -ReleaseDirectory (Join-Path $inputRoot 'releases')
  $proof=Get-Content -LiteralPath (Join-Path $root ($context.scenario+'/evidence/result.json')) -Raw | ConvertFrom-Json
  if($proof.status -ne 'PASS') { throw 'Lifecycle receipt did not pass' }
  $result.status='PASS'
} catch { $result.status='FAIL';$result.error=$_.Exception.Message }
finally { $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root 'done.json') -Encoding utf8 }
if($result.status -ne 'PASS') { exit 1 }
