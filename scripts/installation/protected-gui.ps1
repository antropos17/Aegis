Set-StrictMode -Version Latest

# All creation remains beneath the original existing stage. Loading these
# functions neither captures a principal nor changes a file/account/service.
function Open-ProtectedGuiCandidate([string]$SourceRoot, [byte[]]$ManifestBytes) {
    $source = $null; $principal = $null
    try {
        $principal = [ProtectedGuiIdentity]::CaptureInstaller()
        $source = [ProtectedGuiBundleFiles]::Capture($SourceRoot, $ManifestBytes)
        $principal.CheckCurrent(); $source.CheckCurrent()
        return @{ source = $source; principal = $principal; ownsSource = $true; ownsPrincipal = $true }
    } catch {
        if ($null -ne $source) { $source.Dispose() }
        if ($null -ne $principal) { $principal.Dispose() }
        throw
    }
}
function Close-ProtectedGuiCandidate($Candidate) {
    if ($null -eq $Candidate) { return }
    try {
        if (!$Candidate.ContainsKey('ownsSource') -or $Candidate.ownsSource) { $Candidate.source.Dispose() }
    } finally {
        if (!$Candidate.ContainsKey('ownsPrincipal') -or $Candidate.ownsPrincipal) { $Candidate.principal.Dispose() }
    }
}
function New-ProtectedGuiStage($Context, $Stage, [byte[]]$PolicyBytes) {
    if (!$Context.ContainsKey('guiInput') -or $null -eq $Context.guiInput) { return $null }
    $input = $Context.guiInput
    if ($input.source -isnot [ProtectedGuiBundleFiles] -or $input.principal -isnot [ProtectedGuiIdentity] -or
        $null -eq $Stage.root -or $PolicyBytes.Length -lt 1 -or $PolicyBytes.Length -gt 4096) { throw 'protected-gui-binding-refused' }
    $Stage.root.Recheck(); $input.principal.CheckCurrent(); $input.source.CheckCurrent()
    $policy = [Text.UTF8Encoding]::new($false, $true).GetString($PolicyBytes) | ConvertFrom-Json
    if ($policy.installId -cne $Context.installId -or $policy.operatorSid -cne $Context.operatorSid -or
        $policy.selectionId -cne $Context.selectionId -or $policy.selectionEpoch -cne $Context.selectionEpoch -or
        $policy.revision -ne $Stage.revision -or $policy.epoch -cne $Stage.epoch -or
        $policy.rootVolumeSerial -cne $Stage.root.Volume -or $policy.rootFileId -cne $Stage.root.FileId) { throw 'protected-gui-binding-refused' }
    $acl = New-ProtectedInstallAcl $true $Context.operatorSid
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($input.principal.LimitedSid),
        [Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
        [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    $bundle = $null
    try {
        $bundle = $input.source.Stage($Stage.root, $acl.GetSecurityDescriptorBinaryForm(), $Stage.parent, $input.principal)
        $Stage.gui = @{ bundle = $bundle; recordBytes = $null; principal = $input.principal }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $policyHash = [BitConverter]::ToString($hash.ComputeHash($PolicyBytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        $record = [ordered]@{
            schemaVersion = 1; scope = 'protected-gui-bundle-candidate'; installId = $policy.installId
            revision = $policy.revision; epoch = $policy.epoch; policySha256 = $policyHash; operatorSid = $policy.operatorSid
            selectionId = $policy.selectionId; selectionEpoch = $policy.selectionEpoch; bundleGeneration = [guid]::NewGuid().ToString('N')
            bundleVolumeSerial = $bundle.Volume; bundleFileId = $bundle.FileId; manifestSha256 = $bundle.ManifestSha256
            fileCount = $bundle.FileCount; totalBytes = $bundle.TotalBytes; executable = $bundle.Executable
            installerSid = $input.principal.InstallerSid; installerAuthentication = $input.principal.InstallerAuthentication
            installerTokenId = $input.principal.InstallerTokenId; installerSession = $input.principal.InstallerSession
            limitedSid = $input.principal.LimitedSid; limitedAuthentication = $input.principal.LimitedAuthentication
            limitedTokenId = $input.principal.LimitedTokenId; limitedSession = $input.principal.LimitedSession
            guiEnrollment = $false; status = 'candidate'
        }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Compress))
        if ($bytes.Length -gt 4096) { throw 'protected-gui-binding-refused' }
        $bundle.CheckCurrent($Stage.root); $input.principal.CheckCurrent()
        $Stage.gui.recordBytes = $bytes
        return $Stage.gui
    } catch {
        $failure = $_.Exception
        while ($null -ne $failure) {
            if ($failure.Data.Contains('protectedGuiOwner')) {
                $Stage.gui = @{ bundle = $failure.Data['protectedGuiOwner']; recordBytes = $null; principal = $input.principal }
                $Context.cleanupUnknown = $true
                throw
            }
            $failure = $failure.InnerException
        }
        if ($null -ne $bundle) {
            try { $bundle.Remove($Stage.root) } catch { $Context.cleanupUnknown = $true; throw }
            $bundle.Dispose(); $Stage.gui = $null
        }
        throw
    }
}
function Assert-ProtectedGuiStage($Stage) {
    if ($Stage.ContainsKey('gui') -and $null -ne $Stage.gui) { $Stage.gui.principal.CheckCurrent(); $Stage.gui.bundle.CheckCurrent($Stage.root) }
}
function Move-ProtectedGuiStageBinding($Stage, [string]$Destination) {
    if ($Stage.ContainsKey('gui') -and $null -ne $Stage.gui) {
        $Stage.gui.bundle.RenameStage($Stage.root, $Stage.parent, $Destination)
    }
}
function Remove-ProtectedGuiStage($Stage) {
    if ($Stage.ContainsKey('gui') -and $null -ne $Stage.gui) {
        $Stage.gui.bundle.Remove($Stage.root)
        $Stage.gui.bundle.Dispose()
        $Stage.gui = $null
    }
}
