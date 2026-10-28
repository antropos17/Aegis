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
  if ($reviewedCandidate.sourceSha -ne 'fb16bc01389ba203b0f99c632f9719bc7dadaf0d' -or $reviewedCandidate.sourceTree -ne '689e627b243df37e3a7044402c96c58003754ec7' -or $reviewedCandidate.bytes -ne 188066953 -or $reviewedCandidate.sha256 -ne '5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952' -or $reviewedCandidate.assetsSha256 -ne 'e5d68c0d75115c00914aff50c7d2c00fe0bbf570a7958734eeadba87db9d7b59') { throw 'Frozen reviewed candidate identity changed' }
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
$g1Control = 'not-selected'
if ($G1ACandidate) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'AssertG1ReleaseSelection' }, $true)
  if (!$definition) { throw 'G1 asset selection missing' }
  . ([scriptblock]::Create($definition.Extent.Text))
  $release = @{
    id=123; draft=$true; prerelease=$false; tag_name='qualification-fb16-delivery-20261028'; target_commitish='fb16bc01389ba203b0f99c632f9719bc7dadaf0d'; published_at=$null
    assets=@(
      @{id=456; name='AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.21.0-beta.exe'; size=188066953; state='uploaded'; url='https://api.github.com/repos/antropos17/Aegis/releases/assets/456'; digest='sha256:5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952'},
      @{id=789; name='candidate-identity.json'; size=2325; state='uploaded'; url='https://api.github.com/repos/antropos17/Aegis/releases/assets/789'; digest='sha256:9e98ab68ec362e52da79bae79d3ba93266e6e02b3a5395a8308b5c7d6eb8b606'}
    )
  }
  $selected=@(AssertG1ReleaseSelection $release '123' '456' '789')
  if ($selected.Count -ne 2 -or $selected[0].sha256 -cne '5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952' -or $selected[0].relative -cne 'candidate/AEGIS - AI Monitoring & Threat Detection Setup 0.21.0-beta.exe' -or $selected[1].sha256 -cne '9e98ab68ec362e52da79bae79d3ba93266e6e02b3a5395a8308b5c7d6eb8b606') { throw 'G1 independent asset pins changed' }
  foreach ($bad in @('published','other-release','target','tag','publication','boolean','size','name','digest','url','duplicate','missing','numeric')) {
    $copy=$release | ConvertTo-Json -Depth 5 | ConvertFrom-Json
    $installerId='456'
    switch ($bad) {
      published { $copy.draft=$false }
      other-release { $copy.id=124 }
      target { $copy.target_commitish='master' }
      tag { $copy.tag_name='other-tag' }
      publication { $copy.published_at='2026-10-28T00:00:00Z' }
      boolean { $copy.draft='true' }
      size { $copy.assets[0].size=188066954 }
      name { $copy.assets[0].name='other.exe' }
      digest { $copy.assets[0].digest='sha256:'+('0'*64) }
      url { $copy.assets[0].url='https://api.github.com/repos/other/repo/releases/assets/456' }
      duplicate { $copy.assets=@($copy.assets[0],$copy.assets[0],$copy.assets[1]) }
      missing { $copy.assets=@($copy.assets[1]) }
      numeric { $installerId='../456' }
    }
    $caught=$false
    try { AssertG1ReleaseSelection $copy '123' $installerId '789' | Out-Null } catch { $caught=$true }
    if (!$caught) { throw ('G1 asset selection admitted '+$bad) }
  }
  # Execute only the existing lifecycle control slice with inert functions.
  # No production host main, environment spoof, installer or application runs.
  $text=[IO.File]::ReadAllText($source)
  $start=$text.IndexOf("  if (`$Scenario -eq 'fresh') { Install `$candidate")
  $end=$text.IndexOf("  Sample 'complete'",$start)
  if ($start -lt 0 -or $end -le $start) { throw 'Lifecycle control slice missing' }
  $control=[scriptblock]::Create($text.Substring($start,$end-$start))
  function Install($File,$Version) { $script:calls.Add('install:'+ $File); if ($script:failInstall) { throw 'inert-install-failure' } }
  function ProfileCheck($Phase,$Version) { $script:calls.Add('profile:'+ $Phase) }
  function Uninstall($Phase) { $script:calls.Add('uninstall:'+ $Phase) }
  function Payload { @{path='fixture';sha256='unchanged'} }
  foreach ($example in @(
    @{g1=$true;scenario='fresh';expected='install:candidate,profile:fresh,uninstall:first-uninstall'},
    @{g1=$false;scenario='fresh';expected='install:candidate,profile:fresh,uninstall:first-uninstall,install:candidate,profile:reinstall,uninstall:final-uninstall'},
    @{g1=$false;scenario='upgrade';expected='install:previous,profile:baseline,install:candidate,profile:upgrade,uninstall:first-uninstall,install:candidate,profile:reinstall,uninstall:final-uninstall'}
  )) {
    $script:calls=[Collections.Generic.List[string]]::new(); $script:failInstall=$false
    $G1ACandidate=$example.g1; $Scenario=$example.scenario; $candidate='candidate'; $previous='previous'; $result=@{limits=@()}
    . $control
    if (($script:calls -join ',') -cne $example.expected) { throw 'Lifecycle invocation counts changed' }
  }
  $script:calls=[Collections.Generic.List[string]]::new(); $script:failInstall=$true; $G1ACandidate=$true; $Scenario='fresh'
  $caught=$false
  try { . $control } catch { if ($_.Exception.Message -ne 'inert-install-failure') { throw }; $caught=$true }
  if (!$caught -or ($script:calls -join ',') -cne 'install:candidate') { throw 'Failed G1 install did not stop before profile/uninstall' }
  $g1Control='PASS'
}
@{ status='PASS'; rejectedInputs=$cases.Count; validArtifact='PASS'; personalHostRefusal=$refusal; assetPreflight=$assetChecks; g1Control=$g1Control; installerExecuted=$false } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root 'checks.json')
