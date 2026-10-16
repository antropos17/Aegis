Set-StrictMode -Version Latest
$script:ProtectedJournalFileMaximum = 2101248

function Get-ProtectedJournalSecurityHash([string]$Sddl) {
    $canonical = ([Security.AccessControl.RawSecurityDescriptor]::new($Sddl)).GetSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash(([Text.UTF8Encoding]::new($false)).GetBytes($canonical))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Assert-ProtectedJournalProtection($Held) {
    if (!$Held.Protected($false)) { throw 'protected-journal-protection-refused' }
}
function New-ProtectedInstallJournalDirectory($Context) {
    $Context.journalFiles = @(); $Context.journalEvidence = @()
    $Context.journalDirectory = New-ProtectedInstallDirectory (Join-Path $Context.parent.PathName 'OperationJournal') $Context.operatorSid $true
}
function Assert-ProtectedJournalFile($Journal, $Held) {
    $Held.Recheck()
    Assert-ProtectedJournalProtection $Held
    if ($Held.Directory -or $Held.PathName -cne $Journal.path -or
        $Held.Volume -cne $Journal.file.volume -or $Held.FileId -cne $Journal.file.fileId -or
        (Get-ProtectedJournalSecurityHash $Held.Sddl) -cne $Journal.file.securitySha256) { throw 'protected-journal-original-file-refused' }
}
function Assert-ProtectedInstallJournals($Context) {
    if (!$Context.ContainsKey('journalDirectory') -or $null -eq $Context.journalDirectory) { throw 'protected-journal-directory-missing' }
    $Context.journalDirectory.Recheck()
    Assert-ProtectedJournalProtection $Context.journalDirectory
    if ($Context.journalFiles.Count -gt 2) { throw 'protected-journal-directory-refused' }
    $entries = @(Get-ChildItem -LiteralPath $Context.journalDirectory.PathName -Force)
    if ($entries.Count -ne $Context.journalFiles.Count -or @($entries | Where-Object { $_.FullName -cnotin @($Context.journalFiles.path) }).Count) { throw 'protected-journal-unknown-child' }
    foreach ($journal in $Context.journalFiles) {
        if ($journal.unknown -or $journal.removed -or $null -eq $journal.file -or
            $journal.directory.volume -cne $Context.journalDirectory.Volume -or $journal.directory.fileId -cne $Context.journalDirectory.FileId -or
            $journal.directory.securitySha256 -cne (Get-ProtectedJournalSecurityHash $Context.journalDirectory.Sddl)) { throw 'protected-journal-association-refused' }
        if ($null -ne $journal.held) { Assert-ProtectedJournalFile $journal $journal.held }
        else {
            $held = [ProtectedInstallFile]::new($journal.path, $false, $false)
            try { Assert-ProtectedJournalFile $journal $held } finally { $held.Dispose() }
        }
    }
}
function New-ProtectedInstallJournal($Context, $Stage) {
    Assert-ProtectedInstallJournals $Context
    if ($Context.journalFiles.Count -ge 2) { throw 'protected-journal-directory-capacity' }
    $leaf = 'operations-' + $Context.installId + '-' + $Stage.epoch + '-' + $Stage.revision + '.jsonl'
    $journal = @{ generation = [guid]::NewGuid().ToString('N'); leaf = $leaf; path = Join-Path $Context.journalDirectory.PathName $leaf;
        directory = @{ volume = $Context.journalDirectory.Volume; fileId = $Context.journalDirectory.FileId; securitySha256 = Get-ProtectedJournalSecurityHash $Context.journalDirectory.Sddl };
        file = $null; held = $null; unknown = $false; removed = $false; state = 'creation-attempted' }
    $Stage.journal = $journal; $Context.journalFiles += $journal
    try {
        $descriptor = (New-ProtectedInstallAcl $false $Context.operatorSid $true).GetSecurityDescriptorBinaryForm()
        $held = [ProtectedInstallFile]::CreateEmptyJournal($journal.path, $descriptor); $journal.held = $held
        $journal.file = @{ volume = $held.Volume; fileId = $held.FileId; securitySha256 = Get-ProtectedJournalSecurityHash $held.Sddl }
        Assert-ProtectedJournalFile $journal $held
        if ($held.ReadJournal(1).Length -ne 0) { throw 'protected-journal-empty-file-required' }
        $journal.state = 'created-held-empty'
        return $journal
    } catch {
        # A failed CREATE_NEW must never select a file that happened to exist at that name.
        if ($null -eq $journal.file) { $journal.unknown = $true; $Context.cleanupUnknown = $true }
        throw
    }
}
function Release-ProtectedInstallJournal($Journal) {
    if ($Journal.unknown -or $null -eq $Journal.held -or $Journal.state -cne 'created-held-empty') { throw 'protected-journal-release-refused' }
    Assert-ProtectedJournalFile $Journal $Journal.held
    $Journal.held.Dispose(); $Journal.held = $null; $Journal.state = 'released-to-writer'
}
function Collect-ProtectedInstallJournal($Context, $Journal) {
    if ($Context.cleanupUnknown -or $Journal.unknown -or $Journal.removed -or $null -eq $Journal.file -or
        @($Context.journalFiles | Where-Object { [object]::ReferenceEquals($_, $Journal) }).Count -ne 1) { throw 'protected-journal-collection-refused' }
    # The caller has confirmed original owner/children closure. Sharing additionally refuses a live writer.
    if ($null -ne $Journal.held) { $Journal.held.Dispose(); $Journal.held = $null }
    $held = [ProtectedInstallFile]::new($Journal.path, $false, $false)
    try {
        Assert-ProtectedJournalFile $Journal $held; $bytes = $held.ReadJournal($script:ProtectedJournalFileMaximum)
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        $Journal.state = 'closed-observed'
        return @{ path = $Journal.path; volume = $Journal.file.volume; fileId = $Journal.file.fileId; securitySha256 = $Journal.file.securitySha256;
            bytes = $bytes; sha256 = $digest; length = $bytes.Length; generation = $Journal.generation }
    } finally { $held.Dispose() }
}
function Remove-ProtectedInstallJournal($Context, $Journal) {
    if ($null -eq $Journal) { return }
    if ($Context.journalEvidence.Count -ge 8) { throw 'protected-journal-evidence-capacity' }
    Assert-ProtectedInstallJournals $Context
    $evidence = Collect-ProtectedInstallJournal $Context $Journal
    # Preserve bounded exact bytes in the original administrative association before retirement.
    $Context.journalEvidence += $evidence
    $held = [ProtectedInstallFile]::new($Journal.path, $false, $true)
    try {
        Assert-ProtectedJournalFile $Journal $held; $bytes = $held.ReadJournal($script:ProtectedJournalFileMaximum)
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($digest -cne $evidence.sha256 -or $bytes.Length -ne $evidence.length) { throw 'protected-journal-closed-file-changed' }
        $held.Delete(); $Journal.removed = $true; $Journal.state = 'removed'
        $Context.journalFiles = @($Context.journalFiles | Where-Object { ![object]::ReferenceEquals($_, $Journal) })
    } finally { $held.Dispose() }
}
function Remove-ProtectedInstallJournalDirectory($Context) {
    if ($null -eq $Context.journalDirectory) { return }
    Assert-ProtectedInstallJournals $Context
    if ($Context.journalFiles.Count -ne 0) { throw 'protected-journal-files-retained' }
    $Context.journalDirectory.Delete(); $Context.journalDirectory = $null
}

# Serialize once; production staging and the cross-language native contract test use these exact bytes.
function New-ProtectedInstallJournalRecord($Policy, [string]$PolicyDigest, $Journal) {
    $record = [ordered]@{ schemaVersion = 1; scope = 'protected-operation-journal';
        installId = $Policy.installId; revision = $Policy.revision; epoch = $Policy.epoch; policySha256 = $PolicyDigest;
        selectionId = $Policy.selectionId; selectionEpoch = $Policy.selectionEpoch; journalGeneration = $Journal.generation;
        directoryVolumeSerial = $Journal.directory.volume; directoryFileId = $Journal.directory.fileId; directorySecuritySha256 = $Journal.directory.securitySha256;
        journalLeaf = $Journal.leaf; fileVolumeSerial = $Journal.file.volume; fileId = $Journal.file.fileId; fileSecuritySha256 = $Journal.file.securitySha256; status = 'active' }
    $bytes = ([Text.UTF8Encoding]::new($false)).GetBytes(($record | ConvertTo-Json -Compress))
    if ($bytes.Length -lt 1 -or $bytes.Length -gt 2048) { throw 'protected-journal-record-budget-refused' }
    return ,$bytes
}
