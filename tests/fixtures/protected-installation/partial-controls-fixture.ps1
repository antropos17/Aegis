param([string]$Root, [ValidateSet('empty', 'seeded', 'foreign', 'replaced', 'loader', 'replacement-control', 'renamed-control')][string]$Mode, [string]$GuardSource)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/qualification/installed-owner-phase.ps1')
Initialize-ProtectedInstallNative
if ($GuardSource) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($GuardSource, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'partial-control-source-refused' }
    foreach ($name in @('Assert-ProtectedInstallAncillary', 'Remove-ProtectedInstallAncillary')) {
        $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
        . ([scriptblock]::Create($function.Extent.Text))
    }
}
if ($Mode -ceq 'loader') {
    $values = @()
    foreach ($name in @('one/actor.exe', 'two/actor.exe')) {
        $held = [ProtectedInstallFile]::new((Join-Path $Root $name), $false, $false)
        try {
            $method = Import-InstalledOwnerMutationLauncher $held
            $values += $method.Invoke($null, @('actor', 'user', 'dummy-password', 'scratch', 'sid'))
            $held.Recheck()
        } finally { $held.Dispose() }
    }
    @{ values = $values; noActorExecuted = $true } | ConvertTo-Json -Compress
    exit 0
}
$path = Join-Path $Root 'controls'
New-Item -ItemType Directory -Path $path | Out-Null
$context = @{ cleanupUnknown = $false; receipts = $null; parent = $null; operatorSid = $null; ancestors = [Collections.Generic.List[object]]::new(); password = $null;
    journalDirectory = $null; journalFiles = @(); journalEvidence = @(); guiPrincipal = $null;
    controlRows = @(); control = [ProtectedInstallFile]::new($path, $true, $true) }
try {
    if ($Mode -cne 'empty') {
        foreach ($name in @('delete-original.txt', 'replace-original.txt')) {
            $file = Join-Path $path $name
            [IO.File]::WriteAllText($file, 'seeded-original')
            $context.controlRows += Read-ProtectedInstallSnapshot $file $false $false
        }
    }
    if ($Mode -ceq 'foreign') { [IO.File]::WriteAllText((Join-Path $path 'foreign.txt'), 'preserve') }
    if ($Mode -ceq 'replaced') {
        Move-Item -LiteralPath (Join-Path $path 'replace-original.txt') -Destination (Join-Path $Root 'held-original.txt')
        [IO.File]::WriteAllText((Join-Path $path 'replace-original.txt'), 'seeded-original')
    }
    $replacementSucceeded = $null
    if ($Mode -cin @('replacement-control', 'renamed-control')) {
        $context.control = Open-InstalledOwnerControlPin $context.control
        $context.controlReadOnly = $true
        Add-Type @'
using System.Runtime.InteropServices;
public static class PartialReplacement {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool MoveFileEx(string source, string destination, uint flags);
}
'@
        if ($Mode -ceq 'renamed-control') {
            if (![PartialReplacement]::MoveFileEx($path, ($path + '-renamed'), 0)) { throw 'rename-control-not-executed' }
        } else {
            $source = Join-Path $path 'replacement.bin'; $target = Join-Path $path 'replace-original.txt'
            [IO.File]::WriteAllText($source, 'allowed-disposable-replacement')
            $replacementSucceeded = [PartialReplacement]::MoveFileEx($source, $target, 1) -and [IO.File]::ReadAllText($target) -ceq 'allowed-disposable-replacement'
            $context.control.Recheck()
            $context.controlRows = @(Get-InstalledOwnerControlRows $path)
        }
    }
    $refused = $false
    try { Remove-ProtectedInstallAncillary $context } catch { $refused = $true }
    $observedPath = if ($Mode -ceq 'renamed-control') { $path + '-renamed' } else { $path }
    $result = @{ refused = $refused; removed = !(Test-Path -LiteralPath $observedPath); remaining = @((Get-ChildItem -LiteralPath $observedPath -ErrorAction SilentlyContinue)).Count }
    if ($Mode -ceq 'replacement-control') { $result.replacementSucceeded = $replacementSucceeded }
    $result | ConvertTo-Json -Compress
} finally { if ($null -ne $context.control) { $context.control.Dispose() } }
