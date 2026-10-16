param([string]$Project, [string]$Output, [string]$Directory = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $Project 'scripts/installation/protected-journal.ps1')
$policy = @{ installId = ('a' * 32); revision = [uint32]1; epoch = ('b' * 32); selectionId = ('c' * 32); selectionEpoch = ('d' * 32) }
$journal = @{ generation = ('e' * 32); directory = @{ volume = ('1' * 16); fileId = ('2' * 32); securitySha256 = ('3' * 64) };
    leaf = 'operations-' + $policy.installId + '-' + $policy.epoch + '-1.jsonl'; file = @{ volume = ('1' * 16); fileId = ('4' * 32); securitySha256 = ('5' * 64) } }
[IO.File]::WriteAllBytes($Output, (New-ProtectedInstallJournalRecord $policy ('f' * 64) $journal))
if ($Directory -cne '') {
    Add-Type -Path (Join-Path $Project 'scripts/installation/ProtectedInstallFiles.cs')
    [void][IO.Directory]::CreateDirectory($Directory)
    $heldDirectory = [ProtectedInstallFile]::new($Directory, $true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($sid)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    $heldFile = $null
    try {
        $heldFile = [ProtectedInstallFile]::CreateEmptyJournal((Join-Path $Directory $journal.leaf), $acl.GetSecurityDescriptorBinaryForm())
        $journal.directory = @{ volume = $heldDirectory.Volume; fileId = $heldDirectory.FileId; securitySha256 = Get-ProtectedJournalSecurityHash $heldDirectory.Sddl }
        $journal.file = @{ volume = $heldFile.Volume; fileId = $heldFile.FileId; securitySha256 = Get-ProtectedJournalSecurityHash $heldFile.Sddl }
        [IO.File]::WriteAllBytes($Output, (New-ProtectedInstallJournalRecord $policy ('f' * 64) $journal))
    } finally { if ($null -ne $heldFile) { $heldFile.Dispose() }; $heldDirectory.Dispose() }
}
