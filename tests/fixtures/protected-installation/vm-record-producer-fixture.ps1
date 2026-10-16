param([Parameter(Mandatory)][string]$Scratch, [Parameter(Mandatory)][string]$VmId, [Parameter(Mandatory)][string]$IdentityHash, [Parameter(Mandatory)][string]$StorageHash,
    [string]$MainImage = '', [string]$SupervisorImage = '', [string]$OperatorSid = 'S-1-5-21-1-2-3-400', [string]$ConfigurationHash = '', [string]$CompatibilityMode = '',
    [string]$GuiAssembly = '', [string]$GuiSource = '', [string]$GuiManifest = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-install-files.ps1')
$script:fixtureRoot = [IO.Path]::GetFullPath($Scratch).TrimEnd('\')
if ($CompatibilityMode -ceq 'gui-inspection') {
    # Only the caller fixture's original existing root is selected. Descriptor
    # and linked-principal authority are modeled; copy/hash/serialization are real.
    Add-Type -Path $GuiAssembly
    [ProtectedGuiBundleFiles]::ModelProtectionForTest()
    function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
        $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
        $acl.SetAccessRuleProtection($true, $false)
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid)
        $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl,
            $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
        return $acl
    }
    $policyBytes = [IO.File]::ReadAllBytes((Join-Path $script:fixtureRoot 'owner-policy.json'))
    $policy = [Text.Encoding]::UTF8.GetString($policyBytes) | ConvertFrom-Json
    $source = $null; $principal = $null; $root = $null; $parent = $null; $stage = $null
    try {
        $root = [ProtectedInstallFile]::new($script:fixtureRoot, $true, $false)
        $parent = [ProtectedInstallFile]::new([IO.Path]::GetDirectoryName($script:fixtureRoot), $true, $false)
        $principal = [ProtectedGuiIdentity]::CreateForTest($policy.operatorSid, 1)
        $source = [ProtectedGuiBundleFiles]::Capture($GuiSource, [IO.File]::ReadAllBytes($GuiManifest))
        $context = @{ installId = $policy.installId; operatorSid = $policy.operatorSid; selectionId = $policy.selectionId; selectionEpoch = $policy.selectionEpoch;
            cleanupUnknown = $false; guiInput = @{ source = $source; principal = $principal; ownsSource = $true; ownsPrincipal = $false }; guiPrincipal = $principal }
        $stage = @{ root = $root; parent = $parent; revision = $policy.revision; epoch = $policy.epoch; gui = $null }
        $stage.gui = New-ProtectedGuiStage $context $stage $policyBytes
        Write-ProtectedInstallFile (Join-Path $script:fixtureRoot 'registered-gui-candidate.json') $stage.gui.recordBytes $policy.operatorSid
        Assert-ProtectedGuiStage $stage
        @{ produced = $true; modeledPrincipalAndProtection = $true; guiEnrollment = $false } | ConvertTo-Json -Compress
    } finally {
        # Preserve the real produced tree for the existing native inspection;
        # its exact test root is collected only after the native processes exit.
        if ($null -ne $stage -and $null -ne $stage.gui) { $stage.gui.bundle.Dispose() }
        if ($null -ne $source) { $source.Dispose() }
        if ($null -ne $principal) { $principal.Dispose() }
        if ($null -ne $root) { $root.Dispose() }
        if ($null -ne $parent) { $parent.Dispose() }
    }
    return
}
if (!(Test-Path -LiteralPath $script:fixtureRoot -PathType Container) -or @(Get-ChildItem -LiteralPath $script:fixtureRoot -Force).Count) { throw 'fixture-empty-scratch-required' }
$script:ProtectedInstallParent = $script:fixtureRoot
if ($CompatibilityMode -ceq 'legacy-verifier') {
    . (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
    $script:ProtectedInstallParent = $script:fixtureRoot
    # The verified image below is a fixture assembly with the original v3 API
    # only. Provider values/administrative/filesystem authority are modeled.
    $assemblyPath = Join-Path $script:fixtureRoot 'original-verifier.dll'
    $source = @"
using System;
namespace Aegis.ProtectedSession {
 public static class InstalledVmRegistration {
  public static string ObserveProtectedStorageForInstaller(Guid id) {
   if (id != new Guid("$VmId")) throw new InvalidOperationException();
   return "$IdentityHash" + "\n" + "$StorageHash";
  }
 }
}
public sealed class ProtectedInstallFile : IDisposable {
 public string PathName, Volume = "volume", FileId = "original", Sddl = "private";
 public bool Directory;
 public ProtectedInstallFile(string path, bool directory, bool mutate) { PathName = path; Directory = directory; }
 public void RequireHighIntegrity() {} public void Delete() {} public void Dispose() {}
}
"@
    Add-Type -TypeDefinition $source -OutputAssembly $assemblyPath
    $image = [IO.File]::ReadAllBytes($assemblyPath)
    [void][Reflection.Assembly]::Load($image)
    $binding = @{ vmId = $VmId; identitySha256 = $IdentityHash; storageSha256 = $StorageHash; storageProtection = 'private-vm' }
    $nativeNewRefused = $false; $nativeV4Refused = $false
    try { Read-ProtectedInstallVmBinding $VmId $image | Out-Null } catch { $nativeNewRefused = $true }
    $v4 = $binding.Clone(); $v4.configurationProfile = 'aegis-offline-fixed-v1'; $v4.configurationSha256 = 'c' * 64
    try { Read-ProtectedInstallVmBinding $VmId $image $v4 | Out-Null } catch { $nativeV4Refused = $true }
    $script:rootDeleted = $false; $script:removals = 0; $script:assertions = 0
    $rootPath = Join-Path $script:fixtureRoot 'original-vm'; [void][IO.Directory]::CreateDirectory($rootPath)
    $held = [pscustomobject]@{ PathName = $rootPath }
    $held | Add-Member ScriptMethod Recheck {}
    $held | Add-Member ScriptMethod Dispose {}
    $held | Add-Member ScriptMethod DeleteAfterProvider { $script:rootDeleted = $true }
    $owned = @{ root = $held; images = $held; disks = $held; image = $held; disk = $held; vmId = $VmId; name = 'modeled-original'; unknown = $false; binding = $binding; verifier = $image; rows = @() }
    $association = @{ vmProvision = $owned; vmBinding = $binding; service = $null; manifest = @{}; inputs = @{}; stage = @{ revision = 1 }; rollback = $null }
    function Assert-ProtectedInstallAdministrator {}
    function Assert-ProtectedVmTree($Owned) {}
    function Read-ProtectedVmTree($Owned) { return ,$Owned.rows }
    function Invoke-ProtectedVmProvider($Owned, [string]$Action) { return @{ vmId = $Owned.vmId; name = $Owned.name; off = $true } }
    function Invoke-ProtectedVmEffect($Owned, [string]$Action) { if ($Action -cne 'remove') { throw 'fixture-unexpected-effect' }; $script:removals++ }
    function Assert-ProtectedInstallation($Association) { $script:assertions++; Assert-ProtectedInstallVm $Association }
    function Assert-ProtectedInstallIdleUpgrade($Service) {}
    function Read-ProtectedInstallInputs($SourceRoot, $Manifest) { return @{} }
    function New-ProtectedInstallStage($Context, [uint32]$Revision, [string]$Epoch) { return @{ revision = $Revision; binding = $Context.vmBinding.Clone() } }
    function Invoke-ProtectedUpgradeTransaction($Operations, $Association) { & $Operations.validate $Association; return (& $Operations.stage) }
    Assert-ProtectedInstallVm $association
    $upgraded = Update-ProtectedInstallation $association '' @{}
    $preserved = $upgraded.revision -eq 2 -and $upgraded.binding.Count -eq 4 -and [object]::ReferenceEquals($association.vmBinding, $binding)
    foreach ($key in @('vmId', 'identitySha256', 'storageSha256', 'storageProtection')) {
        if ($upgraded.binding[$key] -cne $binding[$key]) { $preserved = $false }
    }
    Remove-ProtectedInstallVm $association
    return (@{ newIssuanceRefused = $nativeNewRefused; v4MissingApiRefused = $nativeV4Refused; upgradePreserved = $preserved;
        assertions = $script:assertions; removals = $script:removals; exactCleanup = ($script:rootDeleted -and $null -eq $association.vmProvision) } | ConvertTo-Json -Compress)
}
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
# Snapshot hashing uses the inbox framework directly so a PowerShell 7 parent
# cannot redirect the Windows PowerShell child's module autoloading.
function Get-FixtureSnapshotHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path); $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose(); $stream.Dispose() }
}
function Read-ProtectedInstallSnapshot([string]$Path) {
    return @{ path = $Path; sha256 = (Get-FixtureSnapshotHash $Path) }
}
function Assert-ProtectedInstallSnapshot($Row) {
    if ((Get-FixtureSnapshotHash $Row.path) -cne $Row.sha256) { throw 'fixture-snapshot-changed' }
}
# The original fixture models filesystem protection. Preserve that boundary for the new immutable journal leaf.
function New-ProtectedInstallJournal($Context, $Stage) {
    $journal = @{ generation = ('a' * 32); leaf = 'operations-' + $Context.installId + '-' + $Stage.epoch + '-' + $Stage.revision + '.jsonl';
        directory = @{ volume = ('1' * 16); fileId = ('2' * 32); securitySha256 = ('3' * 64) };
        file = @{ volume = ('1' * 16); fileId = ('4' * 32); securitySha256 = ('5' * 64) } }
    $Stage.journal = $journal; return $journal
}
function Release-ProtectedInstallJournal($Journal) { }
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
$script:observerCalls = 0
function Read-ProtectedInstallVmBinding([string]$VmId, [byte[]]$VerifiedImage) {
    $script:observerCalls++; throw 'fixture-stage-must-preserve-original-binding'
}
# Optional v4 preserves existing callers' four-stage contract.
$versions = if ($ConfigurationHash -ceq '') { @(0, 1, 2, 3) } else { @(0, 1, 2, 3, 4) }
foreach ($version in $versions) {
    $configured = $version -ne 0
    if ($configured) { $context.vmBinding = @{ vmId = $VmId; identitySha256 = $IdentityHash } }
    else { $context.Remove('vmBinding') } # Earlier process-only associations have no binding key.
    if ($version -ge 2) { $context.vmBinding.storageSha256 = $StorageHash }
    if ($version -ge 3) { $context.vmBinding.storageProtection = 'private-vm' }
    if ($version -eq 4) { $context.vmBinding.configurationProfile = 'aegis-offline-fixed-v1'; $context.vmBinding.configurationSha256 = $ConfigurationHash }
    $stage = New-ProtectedInstallStage $context 1 '22222222222222222222222222222222'
    if ($stage.rows.Count -ne 11) { throw 'fixture-initial-leaf-count' }
    Assert-ProtectedInstallStage $stage
    Write-ProtectedInstallFile (Join-Path $stage.path 'main-registration.json') ([Text.Encoding]::UTF8.GetBytes('{}')) $context.operatorSid
    Update-ProtectedInstallRuntimeRows $stage
    if ($stage.rows.Count -ne 12) { throw 'fixture-runtime-leaf-count' }
    $originalRows = $stage.rows
    foreach ($leaf in @('registered-operation.json', 'fixed-fixture.json', 'registered-journal.json')) {
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
    $result = @{ path = $stage.path; configured = $configured; storageBound = $version -ge 2; privateStorage = $version -ge 3; configurationBound = $version -eq 4; initialLeaves = 11; runtimeLeaves = 12; unknownRefused = $refused; staticLeavesRefused = $true }
    foreach ($record in @(@{ key = 'policy'; leaf = 'owner-policy.json' }, @{ key = 'inventory'; leaf = 'inventory.json' },
        @{ key = 'operation'; leaf = 'registered-operation.json' }, @{ key = 'fixture'; leaf = 'fixed-fixture.json' })) {
        $recordPath = Join-Path $stage.path $record.leaf
        $result[$record.key + 'Path'] = $recordPath
        $result[$record.key + 'Base64'] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($recordPath))
    }
    if ($version -eq 4) {
        $priorBinding = $context.vmBinding.Clone()
        $upgrade = New-ProtectedInstallStage $context 2 '66666666666666666666666666666666'
        Assert-ProtectedInstallStage $upgrade
        $original = [IO.File]::ReadAllText((Join-Path $stage.path 'registered-vm.json')) | ConvertFrom-Json
        $upgraded = [IO.File]::ReadAllText((Join-Path $upgrade.path 'registered-vm.json')) | ConvertFrom-Json
        foreach ($key in @('vmId', 'identitySha256', 'storageSha256', 'storageProtection', 'configurationProfile', 'configurationSha256')) {
            if ($upgraded.$key -cne $original.$key -or $context.vmBinding[$key] -cne $priorBinding[$key]) { throw 'fixture-upgrade-recaptured-binding' }
        }
        if ($script:observerCalls -ne 0 -or $upgraded.revision -ne 2 -or $upgraded.epoch -cne '66666666666666666666666666666666' -or
            $upgraded.policySha256 -ceq $original.policySha256) { throw 'fixture-upgrade-binding-refused' }
        $result.upgradePath = $upgrade.path; $result.originalSealsPreserved = $true; $result.observerCalls = $script:observerCalls
    }
    $result.imageMetadata = @($files | Where-Object { $_.name -cin @('aegis-main.exe', 'aegis-session.exe') })
    $results += $result
}
@{ stages = $results } | ConvertTo-Json -Depth 5 -Compress
