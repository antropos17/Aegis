param([Parameter(Mandatory)][string]$Scratch, [Parameter(Mandatory)][string]$VmId, [Parameter(Mandatory)][string]$IdentityHash, [Parameter(Mandatory)][string]$StorageHash,
    [string]$MainImage = '', [string]$SupervisorImage = '', [string]$OperatorSid = 'S-1-5-21-1-2-3-400')
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
$inputs = @{ 'aegis-owner.exe' = $blob; 'aegis-session.exe' = $blob; 'aegis-main.exe' = $blob }
foreach ($row in @(@{ name = 'aegis-main.exe'; source = $MainImage }, @{ name = 'aegis-session.exe'; source = $SupervisorImage })) {
    if ($row.source -ceq '') { continue }
    $file = Get-Item -LiteralPath $row.source -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 4MB) { throw 'fixture-image-input-refused' }
    $inputs[$row.name] = [IO.File]::ReadAllBytes($file.FullName)
}
$files = @(); $hash = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) {
        $files += @{ name = $name; bytes = $inputs[$name].Length; sha256 = [BitConverter]::ToString($hash.ComputeHash($inputs[$name])).Replace('-', '').ToLowerInvariant() }
    }
} finally { $hash.Dispose() }
$context = @{ installId = '11111111111111111111111111111111'; selectionId = '44444444444444444444444444444444'; selectionEpoch = '55555555555555555555555555555555';
    operatorSid = $OperatorSid; operatorAccount = 'FixtureOnly'; credential = $blob; parent = @{}; manifest = @{ files = $files };
    inputs = $inputs; vmBinding = $null }
$results = @()
foreach ($version in @(0, 1, 2, 3)) {
    $configured = $version -ne 0
    if ($configured) { $context.vmBinding = @{ vmId = $VmId; identitySha256 = $IdentityHash } }
    else { $context.Remove('vmBinding') } # Earlier process-only associations have no binding key.
    if ($version -ge 2) { $context.vmBinding.storageSha256 = $StorageHash }
    if ($version -eq 3) { $context.vmBinding.storageProtection = 'private-vm' }
    $stage = New-ProtectedInstallStage $context 1 '22222222222222222222222222222222'
    if ($stage.rows.Count -ne 10) { throw 'fixture-initial-leaf-count' }
    Assert-ProtectedInstallStage $stage
    Write-ProtectedInstallFile (Join-Path $stage.path 'main-registration.json') ([Text.Encoding]::UTF8.GetBytes('{}')) $context.operatorSid
    Update-ProtectedInstallRuntimeRows $stage
    if ($stage.rows.Count -ne 11) { throw 'fixture-runtime-leaf-count' }
    $originalRows = $stage.rows
    foreach ($leaf in @('registered-operation.json', 'fixed-fixture.json')) {
        $stage.rows = @($originalRows | Where-Object { [IO.Path]::GetFileName($_.path) -cne $leaf })
        $unassociatedRefused = $false
        try { Update-ProtectedInstallRuntimeRows $stage } catch { $unassociatedRefused = $_.Exception.Message -ceq 'protected-runtime-unassociated-leaf' }
        $stage.rows = $originalRows
        if (!$unassociatedRefused) { throw 'fixture-static-leaf-adoption-accepted' }
    }
    Assert-ProtectedInstallStage $stage
    $foreign = Join-Path $stage.path 'foreign.txt'; [IO.File]::WriteAllText($foreign, 'fixture-owned foreign leaf')
    $refused = $false
    try { Update-ProtectedInstallRuntimeRows $stage } catch { $refused = $_.Exception.Message -ceq 'protected-runtime-unknown-child' }
    [IO.File]::Delete($foreign)
    if (!$refused) { throw 'fixture-unknown-leaf-not-refused' }
    $result = @{ path = $stage.path; configured = $configured; storageBound = $version -ge 2; privateStorage = $version -eq 3; initialLeaves = 10; runtimeLeaves = 11; unknownRefused = $refused; staticLeavesRefused = $true }
    foreach ($record in @(@{ key = 'policy'; leaf = 'owner-policy.json' }, @{ key = 'inventory'; leaf = 'inventory.json' },
        @{ key = 'operation'; leaf = 'registered-operation.json' }, @{ key = 'fixture'; leaf = 'fixed-fixture.json' })) {
        $recordPath = Join-Path $stage.path $record.leaf
        $result[$record.key + 'Path'] = $recordPath
        $result[$record.key + 'Base64'] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($recordPath))
    }
    $result.imageMetadata = @($files | Where-Object { $_.name -cin @('aegis-main.exe', 'aegis-session.exe') })
    $results += $result
}
@{ stages = $results } | ConvertTo-Json -Depth 5 -Compress
