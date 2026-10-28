param([Parameter(Mandatory)][string]$Scratch, [ValidateSet('pr1048','master813','g1a')][string]$Profile = 'pr1048')
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
$G1ACandidate = $Profile -eq 'g1a'
$reviewedCandidate = $null
if ($Master813804e2Candidate) {
  $candidateSource = '813804e2aae1c020f4b17cb7a30f053a210185ef'
  $expectedTree = 'b1710a41cd7eba38ed60dffd6bd8bc3b4fa37d58'
}
$result = @{ artifacts=@(); limits=@() }
$payload = Join-Path $inputDirectory 'fixture.exe'
if ($G1ACandidate) {
  New-Item -ItemType Directory -Path (Join-Path $inputDirectory 'candidate') | Out-Null
  $payload = Join-Path $inputDirectory 'candidate/fixture.exe'
}
[IO.File]::WriteAllBytes($payload, [byte[]]@(1,2,3,4))
if ($G1ACandidate) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'GetG1ACandidate' }, $true)
  if (-not $definition) { throw 'Reviewed candidate selection missing' }
  . ([scriptblock]::Create($definition.Extent.Text))
  $reviewedCandidate = GetG1ACandidate
  if ($reviewedCandidate.sourceSha -ne 'b35f39764c56b74a0799737561b69003e5e29e91' -or $reviewedCandidate.sourceTree -ne 'eeb047f2d86937540322b46811bff8d24feb0fe7' -or $reviewedCandidate.bytes -ne 188066691 -or $reviewedCandidate.sha256 -ne '51dd99793ebdd3f36ce3d52f654f8d4d99d5bd9230d44734f6889d5c2670ff48' -or $reviewedCandidate.assetsSha256 -ne '40e1c92fb6a6529a8bef12b7791759588dd5820c15e41c28e39b196b10678b48') { throw 'Frozen reviewed candidate identity changed' }
  $candidateSource = $reviewedCandidate.sourceSha; $expectedTree = $reviewedCandidate.sourceTree
  # Tiny inert payload replaces only fixture pins, never production arguments.
  $reviewedCandidate = $reviewedCandidate.Clone()
  $reviewedCandidate.filename = 'fixture.exe'; $reviewedCandidate.bytes = 4
  $reviewedCandidate.sha256 = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
}
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
if ($G1ACandidate) {
  # Same producer fields/layout as candidate-identity.json; paths are labels only.
  $receipt = @{
    candidateSource=$candidateSource; buildResult='passed'; releasePublished=$false
    files=@(
      @{ path='X:\original-build\fixture.exe'; bytes=4; sha256=$reviewedCandidate.sha256 },
      @{ path='X:\original-build\resources\hook-review\assets.json'; bytes=12; sha256=$reviewedCandidate.assetsSha256 }
    )
  }
  $receiptFile = Join-Path $inputDirectory 'candidate-identity.json'
}
function WriteReceipt { $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding utf8 }
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
if ($G1ACandidate) {
  $badBytes = $receipt.files[0].Clone(); $badBytes.bytes = 5
  $badHash = $receipt.files[0].Clone(); $badHash.sha256 = '0' * 64
  $badName = $receipt.files[0].Clone(); $badName.path = 'X:\original-build\other.exe'
  $badAssets = $receipt.files[1].Clone(); $badAssets.sha256 = '0' * 64
  $cases = @(
    @{ field='candidateSource'; value=('0' * 40) },
    @{ field='buildResult'; value='failed' },
    @{ field='releasePublished'; value=$true },
    @{ field='files'; value=@($badBytes,$receipt.files[1]) },
    @{ field='files'; value=@($badHash,$receipt.files[1]) },
    @{ field='files'; value=@($badName,$receipt.files[1]) },
    @{ field='files'; value=@($receipt.files[0],$badAssets) },
    @{ field='files'; value=@($receipt.files[0],$receipt.files[0],$receipt.files[1]) },
    @{ field='files'; value=@($receipt.files[0]) }
  )
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
if ($G1ACandidate -and $result.artifacts[0].source -ne 'reviewed-local-build') { throw 'Local candidate was misreported as CI provenance' }
if ($G1ACandidate) {
  [IO.File]::WriteAllBytes($payload, [byte[]]@(5,6,7,8))
  $caught = $null
  try { ImportCandidate $inputDirectory | Out-Null } catch { $caught = $_.Exception.Message }
  if ($caught -ne 'Candidate bytes do not match build receipt') { throw 'Changed payload passed independent pin' }
  [IO.File]::WriteAllBytes($payload, [byte[]]@(1,2,3,4))
}
$refusal = 'not-exercised-on-hosted-runner'
if ($env:GITHUB_ACTIONS -ne 'true') {
  $unsafeOutput = Join-Path $root 'must-not-exist'
  $caught = $null
  $selector = if ($G1ACandidate) { @{ G1ACandidate=$true } } elseif ($Master813804e2Candidate) { @{ Master813804e2Candidate=$true } } else { @{ Pr1048Candidate=$true } }
  try { & $source -Scenario fresh -QaRoot $unsafeOutput @selector -CandidateDirectory $inputDirectory -ExpectedArchitecture X64 } catch { $caught = $_.Exception.Message }
  if ($caught -ne 'Installer lifecycle requires a disposable GitHub-hosted Windows runner.' -or (Test-Path -LiteralPath $unsafeOutput)) { throw 'Non-host guard did not refuse before creating output' }
  $refusal = 'PASS'
}
$assetChecks = 'not-selected'
if ($G1ACandidate) {
  $fixture = Join-Path $root 'asset-preflight.cjs'
  @'
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
(async () => {
  const source = (await fs.readFile(process.argv[2], 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('async function checkPortableAssets(');
  const end = source.indexOf('\nif (', start);
  assert(start >= 0 && end > start);
  // Evaluate only the selected pure preflight, never the guarded driver main.
  const check = vm.runInNewContext(source.slice(start, end) + '\ncheckPortableAssets', { fs, path, assert, require });
  const root = path.join(process.argv[3], 'installed');
  const assets = path.join(root, 'resources', 'hook-review');
  await fs.mkdir(assets, { recursive: true });
  const descriptor = path.join(assets, 'assets.json');
  await fs.writeFile(descriptor, '{}');
  const pin = crypto.createHash('sha256').update('{}').digest('hex');
  let calls = 0;
  const loader = async (directory) => { assert.equal(directory, assets); calls++; return { runtimeVersion: 'fixture' }; };
  const exe = path.join(root, 'AEGIS.exe');
  assert.equal((await check(exe, pin, loader)).descriptorSha256, pin);
  await assert.rejects(() => check(exe, '0'.repeat(64), loader));
  assert.equal(calls, 1, 'Changed descriptor reached asset loader');
  await assert.rejects(() => check(exe, pin, async () => null));
  await fs.writeFile(descriptor, 'CHANGED');
  await assert.rejects(() => check(exe, pin, loader));
  console.log('PASS: selected asset preflight; no application/native execution');
})().catch(error => { console.error(error); process.exitCode = 1; });
'@ | Set-Content -LiteralPath $fixture -Encoding utf8
  & node $fixture (Join-Path $PSScriptRoot 'windows-installer-profile.cjs') $root
  if ($LASTEXITCODE -ne 0) { throw 'Portable asset preflight fixture failed' }
  $assetChecks = 'PASS'
}
@{ status='PASS'; rejectedInputs=$cases.Count; validArtifact='PASS'; personalHostRefusal=$refusal; assetPreflight=$assetChecks; installerExecuted=$false } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root 'checks.json')
