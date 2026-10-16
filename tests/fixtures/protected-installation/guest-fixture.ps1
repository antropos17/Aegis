param([string]$Mode)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-guest.ps1')
if ($Mode -ceq 'preflight-storage') {
    $source = Join-Path $PSScriptRoot '../../../scripts/qualification/test-cloud-guest.ps1'
    $tokens = $null; $errors = $null; $ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
    $definition = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-CloudGuestPreflightStorage' }, $false))
    if ($errors.Count -ne 0 -or $definition.Count -ne 1) { throw 'preflight-fixture-source-refused' }
    . ([scriptblock]::Create($definition[0].Extent.Text))
    $root = Join-Path $env:TEMP ('preflight-owned-' + [guid]::NewGuid().ToString('N'))
    $target = Join-Path $env:TEMP ('preflight-external-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($root); [void][IO.Directory]::CreateDirectory($target)
    $link = Join-Path $root 'link'; $ownedFile = Join-Path $root 'owned.txt'; $externalFile = Join-Path $target 'external.txt'
    try {
        [IO.File]::WriteAllText($ownedFile, 'own'); [IO.File]::WriteAllText($externalFile, 'external-target-must-not-be-counted')
        New-Item -ItemType Junction -Path $link -Target $target | Out-Null
        $observed = Read-CloudGuestPreflightStorage $root
        return (@{ entries = $observed.entries; bytes = $observed.ownedBytes; skipped = $observed.skippedReparsePoints; externalPreserved = ([IO.File]::ReadAllText($externalFile) -ceq 'external-target-must-not-be-counted') } | ConvertTo-Json -Compress)
    } finally {
        if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link) }
        [IO.File]::Delete($ownedFile); [IO.Directory]::Delete($root)
        [IO.File]::Delete($externalFile); [IO.Directory]::Delete($target)
    }
}
if ($Mode -ceq 'pin') {
    Add-Type -Path (Join-Path $PSScriptRoot '../../../scripts/installation/ProtectedInstallFiles.cs')
    $path = Join-Path $env:TEMP ('guest-live-pin-' + [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($path, 'before')
    $offline = [ProtectedInstallFile]::new($path, $false, $false); $live = $null; $blocked = $false; $deleteBlocked = $false
    try {
        $live = [ProtectedInstallFile]::OpenWritableDisk($path)
        try { $f = [IO.File]::Open($path, 'Open', 'Write', 'ReadWrite'); $f.Dispose() } catch { $blocked = $true }
        $id = $offline.FileId; $offline.Dispose()
        [IO.File]::WriteAllText($path, 'after')
        try { [IO.File]::Delete($path) } catch { $deleteBlocked = $true }
        $live.Recheck()
        $offline = [ProtectedInstallFile]::new($path, $false, $false)
        $sameId = $offline.FileId -ceq $id -and $live.FileId -ceq $id
        return (@{ offlineWriteBlocked = $blocked; liveWriteSucceeded = ([IO.File]::ReadAllText($path) -ceq 'after'); liveDeleteBlocked = $deleteBlocked; originalId = $sameId } | ConvertTo-Json -Compress)
    } finally { if ($null -ne $live) { $live.Dispose() }; $offline.Dispose(); [IO.File]::Delete($path) }
}
if ($Mode -ceq 'quote') {
    Add-Type -Path @((Join-Path $PSScriptRoot '../../../scripts/installation/ProtectedGuestAgent.cs'),
        (Join-Path $PSScriptRoot '../../../scripts/installation/ProtectedGuestDesktop.cs'), (Join-Path $PSScriptRoot '../../../sidecar/session/GuestJobNative.cs'))
    $values = @('', 'a b', 'c"d\', 'back\slash', '"')
    $quotes = @($values | ForEach-Object { [ProtectedGuestAgent]::Quote($_) })
    $nulRefused = $false
    try { [ProtectedGuestAgent]::Quote("bad`0value") | Out-Null } catch { $nulRefused = $true }
    return (@{ quotes = $quotes; nulRefused = $nulRefused } | ConvertTo-Json -Compress)
}
Add-Type -TypeDefinition @'
using System;
public sealed class ProtectedGuestVm : IDisposable {
 public static bool Unknown;
 public bool PendingUnknown { get { return Unknown; } }
 public ProtectedGuestVm(string id, string digest) {}
 public bool Start() { return !Unknown; }
 public void Dispose() {}
}
public sealed class ProtectedInstallFile {
 public string PathName = "C:\\private\\disk.vhdx", FileId = "original", Volume = "volume", Sddl = "private";
 public bool Closed;
 public ProtectedInstallFile() {}
 public ProtectedInstallFile(string path, bool directory, bool mutate) {}
 public string Hash(int cap) { return new string('a', 64); }
 public byte[] Read(int cap) { return new byte[] { 1, 2 }; }
 public static ProtectedInstallFile OpenWritableDisk(string path) { return new ProtectedInstallFile(); }
 public static ProtectedInstallFile OpenMetadata(string path, bool directory) { return new ProtectedInstallFile(); }
 public void Dispose() { Closed = true; }
}
'@
$script:events = [Collections.Generic.List[string]]::new()
function Assert-ProtectedInstallAdministrator {}
function Initialize-ProtectedGuestNative {}
function Assert-ProtectedInstallation($Context) { if ($Context.vmProvision.unknown) { throw 'unknown' } }
function Assert-ProtectedGuestConfiguration($Owned, [string]$State) {
    $script:events.Add('configuration-' + $State)
    if ($Mode -ceq 'configuration') { throw 'changed' }
}
function Write-ProtectedVmJournal($Owned, [string]$Name, $Record) {
    $script:events.Add($Name)
    if (!$Owned.unknown) { throw 'intent-not-latched' }
    if ($Mode -ceq 'journal') { throw 'journal-failed' }
}
$prior = [ProtectedInstallFile]::new()
$owned = @{ hydrated = $true; unknown = $false; disk = $prior; root = @{ PathName = 'C:\private' }; vmId = '11111111-2222-3333-4444-555555555555'; binding = @{ identitySha256 = 'a' * 64 } }
if ($Mode -ceq 'capacity') { function Get-PSDrive { return @{ Free = [long]0 } } }
$context = @{ vmProvision = $owned }
if ($Mode.StartsWith('tree-', [StringComparison]::Ordinal)) {
    $owned.root = @{ PathName = 'C:\private' }
    $owned.rows = @(
        @{ path = 'C:\private\Disks\system.vhdx'; volume = 'volume'; fileId = 'original'; sddl = 'private'; directory = $false },
        @{ path = ('C:\private\Machine\Virtual Machines\' + $owned.vmId + '.vmcx'); volume = 'volume'; fileId = 'configuration'; sddl = 'private'; directory = $false },
        @{ path = 'C:\private\Machine'; volume = 'volume'; fileId = 'parent'; sddl = 'private'; directory = $true })
    $rows = @($owned.rows | ForEach-Object { $_.Clone() })
    switch ($Mode) {
        'tree-foreign' { $extra = $rows[0].Clone(); $extra.path = 'C:\private\foreign.txt'; $rows += $extra }
        'tree-foreign-config' { $extra = $rows[0].Clone(); $extra.path = 'C:\private\Machine\foreign.txt'; $rows += $extra }
        'tree-journal' { $extra = $rows[0].Clone(); $extra.path = 'C:\private\pending-start.json'; $rows += $extra }
        'tree-disk-replaced' { $rows[0].fileId = 'replacement' }
        'tree-config-renewal' { $rows[1].fileId = 'renewed-configuration' }
        'tree-parent-replaced' { $rows[2].fileId = 'replacement-parent' }
        'tree-missing' { $rows = @($rows[1], $rows[2]) }
    }
    $refused = $false
    try { Assert-ProtectedGuestTree $owned $rows } catch { $refused = $true }
    return (@{ refused = $refused } | ConvertTo-Json -Compress)
}
if ($Mode.StartsWith('agent-', [StringComparison]::Ordinal)) {
    $owned.guest = @{ state = 'running'; agentConsumed = ($Mode -ceq 'agent-replay') }
    $script:workerRemoved = $false; $script:arguments = $null
    function Write-ProtectedVmJournal($Owned, [string]$Name, $Record) { $script:events.Add($Name) }
    function Start-Job($ArgumentList, $ScriptBlock) { $script:arguments = $ArgumentList; return [pscustomobject]@{ State = 'Completed' } }
    function Remove-Job($Job, [switch]$Force) { $script:workerRemoved = $true }
    function Receive-Job($Job) {
        return @{ schemaVersion = 1; vmId = $script:arguments[0]; nonce = $(if ($Mode -ceq 'agent-nonce') { 'wrong' } else { $script:arguments[8] });
            executableSha256 = $script:arguments[4]; exitCode = [long]0; jobClosed = ($Mode -cne 'agent-open-job'); standardToken = ($Mode -cne 'agent-admin'); diskQuotaBytes = [long]512MB }
    }
    $secret = ConvertTo-SecureString 'synthetic-fixture-credential' -AsPlainText -Force
    $credential = [pscredential]::new('AegisAg111111111111', $secret)
    $package = @{ path = 'C:\private\agent.exe'; bytes = [long]2; sha256 = $(if ($Mode -ceq 'agent-digest') { '0' * 64 } else { 'a' * 64 }) }
    $refused = $false
    try { Invoke-ProtectedGuestAgent $context $credential $credential $package | Out-Null } catch { $refused = $true }
    return (@{ refused = $refused; consumed = $owned.guest.agentConsumed; workerRemoved = $script:workerRemoved; events = @($script:events) } | ConvertTo-Json -Compress)
}
[ProtectedGuestVm]::Unknown = $Mode -ceq 'provider'
$refused = $false; $replay = $false
try { Start-ProtectedGuest $context } catch { $refused = $true }
if ($Mode -ceq 'positive') { try { Start-ProtectedGuest $context } catch { $replay = $true } }
@{ refused = $refused; unknown = $owned.unknown; priorClosed = $prior.Closed; replayRefused = $replay; events = @($script:events) } | ConvertTo-Json -Compress
