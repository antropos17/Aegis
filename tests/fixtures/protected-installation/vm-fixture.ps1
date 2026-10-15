param([string]$Mode, [string]$Scratch)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../scripts/installation/protected-installation.ps1')
$events = [Collections.Generic.List[string]]::new()
$id = '11111111-2222-3333-4444-555555555555'
$owned = @{ name = 'aegis-protected-fixture'; vmId = ''; installId = 'fixture'; unknown = $false }
$refused = $false; $result = @{}
if ($Mode -ceq 'image') {
    Initialize-ProtectedInstallNative
    New-Item -ItemType Directory -Path $Scratch | Out-Null
    $source = Join-Path $Scratch 'source.iso'; $output = Join-Path $Scratch 'copy.iso'
    [IO.File]::WriteAllBytes($source, [Text.Encoding]::ASCII.GetBytes('trusted-fixture-image'))
    $digest = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
    $image = Open-ProtectedVmImage @{ path = $source; bytes = [long]21; sha256 = $digest }
    try {
        $acl = New-ProtectedInstallAcl $false '' $true
        # Exercise CreateNew/stream/ACL mechanics under an ordinary local token.
        # The elevated hosted corpus separately checks the production owner/DACL.
        $self = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.SetOwner($self)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($self, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
        $image.CopyImage($output, 21, $digest, $acl.GetSecurityDescriptorBinaryForm())
        $result.equal = (Get-FileHash -LiteralPath $output).Hash.ToLowerInvariant() -ceq $digest
        $blocked = $false
        try { $stream = [IO.File]::Open($source, 'Open', 'Write', 'ReadWrite'); $stream.Dispose() } catch { $blocked = $true }
        $result.sourceWriteBlocked = $blocked
        $blocked = $false
        try { $image.CopyImage($output, 21, $digest, $acl.GetSecurityDescriptorBinaryForm()) } catch { $blocked = $true }
        $result.existingRefused = $blocked
        $destination = Join-Path $Scratch 'bad.iso'; $blocked = $false
        try { $image.CopyImage($destination, 21, ('0' * 64), $acl.GetSecurityDescriptorBinaryForm()) } catch { $blocked = $true }
        $result.badDigestNoEffects = $blocked -and !(Test-Path -LiteralPath $destination)
        $held = [ProtectedInstallFile]::new($output, $false, $false)
        try { $result.descriptorRetained = $held.Sddl -ceq $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access') } finally { $held.Dispose() }
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class VmDirectoryProbe {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string p, uint a, uint s, IntPtr d, uint c, uint f, IntPtr t);
    public static int Open(string path) {
        using(var h=CreateFile(path,0x80020000,3,IntPtr.Zero,3,0x02000000,IntPtr.Zero))
            return h.IsInvalid ? Marshal.GetLastWin32Error() : 0;
    }
}
'@
        $directoryPath = Join-Path $Scratch 'provider'
        $directoryAcl = [Security.AccessControl.DirectorySecurity]::new(); $directoryAcl.SetAccessRuleProtection($true, $false); $directoryAcl.SetOwner($self)
        $directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($self, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
        $directory = [ProtectedInstallFile]::CreateDirectory($directoryPath, $directoryAcl.GetSecurityDescriptorBinaryForm())
        $originalId = $directory.FileId
        $result.providerOpenBefore = [VmDirectoryProbe]::Open($directoryPath)
        $directory = $directory.PinForProvider()
        $result.providerPinPreservesIdentity = $directory.FileId -ceq $originalId
        $result.providerOpenAfter = [VmDirectoryProbe]::Open($directoryPath)
        $blocked = $false
        try { [IO.Directory]::Move($directoryPath, $directoryPath + '-changed') } catch { $blocked = $true }
        $result.pinBlocksRename = $blocked
        $directory.DeleteAfterProvider()
    } finally { $image.Dispose() }
    foreach ($path in @($source, $output)) { Remove-Item -LiteralPath $path }
    Remove-Item -LiteralPath $Scratch
} elseif ($Mode -cin @('adapter-create', 'adapter-error')) {
    function Assert-ProtectedInstallAdministrator { }
    function Import-Module { param($Name, $ErrorAction) }
    function Get-CimInstance { param($Namespace, $ClassName, $Filter, $OperationTimeoutSec); return @() }
    function New-VM {
        param($Name, $Path, $Generation, $MemoryStartupBytes, [switch]$NoVHD)
        if ($Mode -ceq 'adapter-error') { throw 'fixture-provider-error' }
        return [pscustomobject]@{ Id = [guid]'11111111-2222-3333-4444-555555555555'; Name = $Name; State = 'Off' }
    }
    function Start-Job {
        param($ArgumentList, $ScriptBlock)
        $script:adapterRows = @(& $ScriptBlock @ArgumentList)
        return [pscustomobject]@{ State = 'Completed' }
    }
    function Wait-Job { param($Job, $Timeout); return $Job }
    function Receive-Job { param($Job, $ErrorAction); return $script:adapterRows }
    function Remove-Job { param($Job, [switch]$Force) }
    $owned.root = @{ PathName = 'C:\fixture\owned' }
    try { $value = Invoke-ProtectedVmProvider $owned 'create'; $result = @{ vmId = $value.vmId; off = $value.off } }
    catch { $result = @{ failure = Get-ProtectedInstallFailure $_ 'qualification' } }
} else {
    # Synthetic provider errors never call Hyper-V, create accounts or services.
    function Write-ProtectedVmJournal($Owned, [string]$Name, $Record) {
        $events.Add($Name)
        if ($Mode -ceq 'journal-failed' -and $Name -ceq 'pending-create.json') { throw 'fixture-journal' }
    }
    function New-ProtectedVmDisk($Owned) { $events.Add('provider-disk'); throw 'fixture-disk-create-unknown' }
    function Invoke-ProtectedVmProvider($Owned, [string]$Action) {
        $events.Add('provider-' + $Action)
        if ($Mode -ceq 'timeout' -or ($Mode -ceq 'disk-failed' -and $Action -ceq 'disk')) { throw 'fixture-provider-accepted-outcome-unknown' }
        if ($Action -ceq 'remove') { return @{ absent = ($Mode -cne 'remove-present') } }
        return @{ vmId = $(if ($Mode -ceq 'wrong-id') { [guid]::Empty.ToString('D') } else { $id });
            name = $(if ($Mode -ceq 'wrong-name') { 'foreign' } else { $Owned.name }); off = ($Mode -cne 'running') }
    }
    try {
        Invoke-ProtectedVmEffect $owned 'create'
        if ($Mode -ceq 'disk-failed') { Invoke-ProtectedVmEffect $owned 'disk' }
        if ($Mode -cin @('remove', 'remove-present')) { Invoke-ProtectedVmEffect $owned 'remove' }
    } catch { $refused = $true }
    $result = @{ refused = $refused; unknown = $owned.unknown; vmId = $owned.vmId; events = @($events.ToArray()) }
}
$result | ConvertTo-Json -Compress
