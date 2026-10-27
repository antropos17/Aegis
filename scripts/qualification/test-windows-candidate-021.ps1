param([Parameter(Mandatory)][string]$Scratch, [ValidateSet('pr1048','master813')][string]$Profile = 'pr1048')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Scratch)
if (Test-Path -LiteralPath $root) { throw 'Use a new disposable test directory' }
$source = Join-Path $PSScriptRoot 'windows-installer-lifecycle.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Exercise only the artifact import boundary. Never invoke installer/launch code
# and never impersonate a hosted runner on the developer's machine.
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ImportCandidate' }, $true)
if (-not $function) { throw 'Candidate import function missing' }
. ([scriptblock]::Create($function.Extent.Text))
New-Item -ItemType Directory -Path $root | Out-Null
$runnerTemp = $root.TrimEnd('\') + '\'
$qa = Join-Path $root 'qa'
$inputDirectory = Join-Path $root 'input'
foreach ($part in @($inputDirectory, (Join-Path $qa 'candidate'), (Join-Path $qa 'evidence'))) {
  New-Item -ItemType Directory -Path $part -Force | Out-Null
}
$currentVersion = '0.21.0-beta'
$candidateSource = '5526376f39d01305f98e707e8e2ea9807f68a33b'
$expectedTree = '0a704c1c2843c7d1ebde9c2eae073ec80d301b3a'
$Pr1048Candidate = $Profile -eq 'pr1048'
$Master813804e2Candidate = $Profile -eq 'master813'
if ($Master813804e2Candidate) {
  $candidateSource = '813804e2aae1c020f4b17cb7a30f053a210185ef'
  $expectedTree = 'b1710a41cd7eba38ed60dffd6bd8bc3b4fa37d58'
}
$result = @{ artifacts=@(); limits=@() }
$payload = Join-Path $inputDirectory 'fixture.exe'
[IO.File]::WriteAllBytes($payload, [byte[]]@(1,2,3,4))
$receipt = @{
  schema='aegis-ci-installer/1'; repository='antropos17/Aegis'
  sourceSha=$candidateSource; sourceTree=$expectedTree
  runId=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT
  version='0.21.0-beta'; filename='fixture.exe'; bytes=4
  sha256=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
  releaseSigned=$false; published=$false
  sdk='10.0.403'; runtime='10.0.14'; profile=$Profile
}
$receiptFile = Join-Path $inputDirectory 'candidate.json'
function WriteReceipt { $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptFile -Encoding utf8 }
$cases = @(
  @{ field='version'; value='0.20.1-beta' },
  @{ field='sourceSha'; value='55881bc391b9b88b8d1751f6453e5c94e13f7cc9' },
  @{ field='sourceTree'; value=('0' * 40) },
  @{ field='runId'; value='different-run' },
  @{ field='attempt'; value='different-attempt' },
  @{ field='sha256'; value=('0' * 64) },
  @{ field='bytes'; value=5 },
  @{ field='published'; value=$true },
  @{ field='releaseSigned'; value=$true }
)
if ($Master813804e2Candidate) {
  $cases += @{ field='sdk'; value='10.0.302' }, @{ field='runtime'; value='10.0.13' }, @{ field='profile'; value='pr1048' }
}
foreach ($case in $cases) {
  $saved = $receipt[$case.field]
  $receipt[$case.field] = $case.value
  WriteReceipt
  $caught = $null
  try { ImportCandidate $inputDirectory | Out-Null } catch { $caught = $_.Exception.Message }
  if ($caught -notin @('Candidate provenance mismatch','Candidate bytes do not match build receipt')) { throw ('Missing expected rejection: ' + $case.field + '; actual=' + $caught) }
  if (@(Get-ChildItem -LiteralPath (Join-Path $qa 'candidate') -File).Count) { throw 'Rejected input was staged' }
  $receipt[$case.field] = $saved
}
WriteReceipt
$staged = ImportCandidate $inputDirectory
if ((Get-FileHash -LiteralPath $staged).Hash -ne (Get-FileHash -LiteralPath $payload).Hash) { throw 'Valid candidate bytes changed during import' }
if ($result.artifacts.Count -ne 1 -or $result.artifacts[0].signatureVerified -ne $false) { throw 'Unpublished build was misreported' }
$refusal = 'not-exercised-on-hosted-runner'
if ($env:GITHUB_ACTIONS -ne 'true') {
  $unsafeOutput = Join-Path $root 'must-not-exist'
  $caught = $null
  try { & $source -Scenario fresh -QaRoot $unsafeOutput -Pr1048Candidate -CandidateDirectory $inputDirectory -ExpectedArchitecture X64 } catch { $caught = $_.Exception.Message }
  if ($caught -ne 'Installer lifecycle requires a disposable GitHub-hosted Windows runner.' -or (Test-Path -LiteralPath $unsafeOutput)) { throw 'Non-host guard did not refuse before creating output' }
  $refusal = 'PASS'
}
@{ status='PASS'; rejectedInputs=$cases.Count; validArtifact='PASS'; personalHostRefusal=$refusal; installerExecuted=$false } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root 'checks.json')
