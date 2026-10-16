param([string]$Project, [string]$Assembly, [string]$Source, [string]$Manifest, [string]$Scratch, [string]$Mode = 'normal')
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
[Reflection.Assembly]::LoadFrom($Assembly) | Out-Null
. (Join-Path $Project 'scripts/installation/protected-install-files.ps1')
# Model only descriptor authority and the elevated/linked token pair. Native
# original handles, copies, hashes, serializer, rename and exact cleanup are real.
[ProtectedGuiBundleFiles]::ModelProtectionForTest()
function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
    $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)); return $acl
}
function Need([bool]$Condition) { if (!$Condition) { throw 'gui-stage-fixture-refused' } }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$principal = [ProtectedGuiIdentity]::CreateForTest($sid, 1)
$sourceOwner = [ProtectedGuiBundleFiles]::Capture($Source, [IO.File]::ReadAllBytes($Manifest))
$parent = [ProtectedInstallFile]::new($Scratch, $true, $false)
$root = [ProtectedInstallFile]::CreateDirectory((Join-Path $Scratch 'stage'), (New-ProtectedInstallAcl $true $sid).GetSecurityDescriptorBinaryForm())
$root | Add-Member ScriptMethod Protected { param($ancestor); return $true } -Force
$stage = @{ root = $root; parent = $parent; path = $root.PathName; revision = 1; epoch = ('1' * 32); gui = $null; rows = @(); journal = $null }
$context = @{ installId = ('a' * 32); operatorSid = $sid; selectionId = ('c' * 32); selectionEpoch = ('d' * 32);
    cleanupUnknown = $false; guiInput = @{ source = $sourceOwner; principal = $principal; ownsSource = $true; ownsPrincipal = $false } }
$policy = [ordered]@{ installId = $context.installId; operatorSid = $sid; selectionId = $context.selectionId;
    selectionEpoch = $context.selectionEpoch; revision = 1; epoch = $stage.epoch; rootVolumeSerial = $root.Volume; rootFileId = $root.FileId }
$policyBytes = [Text.UTF8Encoding]::new($false).GetBytes(($policy | ConvertTo-Json -Compress))
$stage.context = $context
$script:ReadSnapshot = (Get-Command Read-ProtectedInstallSnapshot).ScriptBlock
function Read-ProtectedInstallSnapshot([string]$Path, [bool]$Directory = $false, [bool]$RequireProtection = $true) {
    return (& $script:ReadSnapshot $Path $Directory $false)
}
try {
    if ($Mode -ceq 'failed-record-cleanup') {
        $script:FixtureStage = $stage; $script:PrincipalChecks = 0
        $principal | Add-Member ScriptMethod CheckCurrent {
            $script:PrincipalChecks++
            if ($script:PrincipalChecks -eq 2) {
                [IO.File]::WriteAllText((Join-Path $script:FixtureStage.root.PathName 'GuiBundle/foreign.canary'), 'untouched')
                throw 'fixture-post-copy-principal-loss'
            }
        } -Force
        $refused = $false
        try { New-ProtectedGuiStage $context $stage $policyBytes | Out-Null } catch { $refused = $true }
        Need ($refused -and $context.cleanupUnknown -and $null -ne $stage.gui -and $null -eq $stage.gui.recordBytes)
        Need ([IO.File]::ReadAllText((Join-Path $stage.root.PathName 'GuiBundle/foreign.canary')) -ceq 'untouched')
        Need ([IO.File]::Exists((Join-Path $stage.root.PathName 'GuiBundle/AEGIS - AI Monitoring & Threat Detection.exe')))
        @{ passed = $true; retainedUnknownOwner = $true; foreignPreserved = $true } | ConvertTo-Json -Compress
        return
    }
    $stage.gui = New-ProtectedGuiStage $context $stage $policyBytes
    Close-ProtectedGuiCandidate $context.guiInput; $context.guiInput = $null
    [IO.File]::WriteAllBytes((Join-Path $stage.root.PathName 'registered-gui-candidate.json'), $stage.gui.recordBytes)
    $stage.rows = @(Get-ProtectedInstallStageRows $stage)
    Need ($stage.rows.Count -eq 1)
    Assert-ProtectedInstallStage $stage; Update-ProtectedInstallRuntimeRows $stage
    $record = [Text.Encoding]::UTF8.GetString($stage.gui.recordBytes) | ConvertFrom-Json
    Need ($record.status -ceq 'candidate' -and !$record.guiEnrollment -and $record.limitedSid -ceq $sid -and
        $record.installerAuthentication -cne $record.limitedAuthentication -and [object]::ReferenceEquals($stage.gui.principal, $principal))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($policyBytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    Need ($record.policySha256 -ceq $digest -and $record.fileCount -eq 2 -and $record.scope -ceq 'protected-gui-bundle-candidate')
    Move-ProtectedInstallStage $stage (Join-Path $Scratch 'published'); Assert-ProtectedInstallStage $stage
    Need ($stage.rows.Count -eq 1 -and [IO.File]::ReadAllText((Join-Path $stage.root.PathName 'registered-gui-candidate.json')) -ceq [Text.Encoding]::UTF8.GetString($stage.gui.recordBytes))
    Remove-ProtectedInstallStage $stage $false; Need ($null -eq $stage.gui -and !(Test-Path -LiteralPath $stage.path))
    @{ passed = $true; serializer = $true; nativeFiles = $true; modeledPrincipalAndProtection = $true; guiEnrollment = $false } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $stage.gui) { $stage.gui.bundle.Dispose() }
    $sourceOwner.Dispose(); $principal.Dispose(); $root.Dispose(); $parent.Dispose()
}
