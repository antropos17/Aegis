param([Parameter(Mandatory)][string]$Scratch, [Parameter(Mandatory)][string]$VmId, [Parameter(Mandatory)][string]$IdentityHash)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-install-files.ps1')
$script:fixtureRoot = [IO.Path]::GetFullPath($Scratch).TrimEnd('\')
if (!(Test-Path -LiteralPath $script:fixtureRoot -PathType Container) -or @(Get-ChildItem -LiteralPath $script:fixtureRoot -Force).Count) { throw 'fixture-empty-scratch-required' }
$script:ProtectedInstallParent = $script:fixtureRoot
# Only filesystem authority is replaced. The actual stage writer, serialization,
# runtime leaf inventory and unknown-leaf refusal execute below.
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid) {
    New-Item -ItemType Directory -Path $Path | Out-Null
    $root = [pscustomobject]@{ PathName = $Path; Volume = '1111111111111111'; FileId = '11111111111111111111111111111111' }
    $root | Add-Member ScriptMethod Recheck { }
    $root | Add-Member ScriptMethod Protected { param($ancestor) return $true }
    return $root
}
function Write-ProtectedInstallFile([string]$Path, [byte[]]$Bytes, [string]$OperatorSid, [bool]$Private = $false) {
    if (![IO.Path]::GetFullPath($Path).StartsWith($script:fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'fixture-write-outside-scratch' }
    [IO.File]::WriteAllBytes($Path, $Bytes)
}
function Read-ProtectedInstallSnapshot([string]$Path) {
    return @{ path = $Path; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
function Assert-ProtectedInstallSnapshot($Row) {
    if ((Get-FileHash -LiteralPath $Row.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Row.sha256) { throw 'fixture-snapshot-changed' }
}
$blob = [byte[]]@(1)
$hash = [Security.Cryptography.SHA256]::Create()
try { $imageHash = [BitConverter]::ToString($hash.ComputeHash($blob)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
$files = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe' | ForEach-Object { @{ name = $_; bytes = 1; sha256 = $imageHash } })
$context = @{ installId = '11111111111111111111111111111111'; selectionId = '44444444444444444444444444444444'; selectionEpoch = '55555555555555555555555555555555';
    operatorSid = 'S-1-5-21-1-2-3-400'; operatorAccount = 'FixtureOnly'; credential = $blob; parent = @{}; manifest = @{ files = $files };
    inputs = @{ 'aegis-owner.exe' = $blob; 'aegis-session.exe' = $blob; 'aegis-main.exe' = $blob }; vmBinding = $null }
$results = @()
foreach ($configured in @($false, $true)) {
    if ($configured) { $context.vmBinding = @{ vmId = $VmId; identitySha256 = $IdentityHash } }
    else { $context.Remove('vmBinding') } # Earlier process-only associations have no binding key.
    $stage = New-ProtectedInstallStage $context 1 '22222222222222222222222222222222'
    if ($stage.rows.Count -ne 8) { throw 'fixture-initial-leaf-count' }
    Assert-ProtectedInstallStage $stage
    Write-ProtectedInstallFile (Join-Path $stage.path 'main-registration.json') ([Text.Encoding]::UTF8.GetBytes('{}')) $context.operatorSid
    Update-ProtectedInstallRuntimeRows $stage
    if ($stage.rows.Count -ne 9) { throw 'fixture-runtime-leaf-count' }
    $foreign = Join-Path $stage.path 'foreign.txt'; [IO.File]::WriteAllText($foreign, 'fixture-owned foreign leaf')
    $refused = $false
    try { Update-ProtectedInstallRuntimeRows $stage } catch { $refused = $_.Exception.Message -ceq 'protected-runtime-unknown-child' }
    [IO.File]::Delete($foreign)
    if (!$refused) { throw 'fixture-unknown-leaf-not-refused' }
    $results += @{ path = $stage.path; configured = $configured; initialLeaves = 8; runtimeLeaves = 9; unknownRefused = $refused }
}
@{ stages = $results } | ConvertTo-Json -Depth 4 -Compress
