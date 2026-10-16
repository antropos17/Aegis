# Test authority model shared by native fixtures and the packaged desktop probe.
[Reflection.Assembly]::LoadFrom($Assembly) | Out-Null
. (Join-Path $Project 'scripts/installation/protected-installation.ps1')
# Actual shared stage/package serialization, retained file pins, process creation,
# suspension/release and whole-Job cleanup. Administrative account/service/VM,
# linked-token/protection authority and journal metadata are explicitly modeled.
$script:Checkpoint = 'setup'
$script:ObservedState = 'unobserved'
$script:PayloadState = 'unobserved'
function Need([bool]$Condition) { if (!$Condition) { throw ('gui-process-stage-fixture:' + $script:Checkpoint) } }
function Has-Failure($ErrorRecord, [string]$Code) {
    $cause = $ErrorRecord.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
        if ($cause -is [IO.InvalidDataException] -and $cause.Message -ceq $Code) { return $true }
        $cause = $cause.InnerException
    }
    return $false
}
function Get-SafeFailureCode($ErrorRecord) {
    $known = @('protected-gui-process-refused', 'protected-gui-process-cleanup-unknown', 'protected-gui-process-profile-refused',
        'protected-gui-principal-refused', 'protected-gui-bundle-refused', 'protected-gui-cleanup-unknown',
        'protected-gui-process-active', 'protected-gui-process-association-refused', 'protected-stage-acl-refused',
        'desktop-root-not-live', 'desktop-window-capture-failed', 'desktop-window-empty', 'desktop-dpi-context-refused')
    $code = 'unclassified'; $cause = $ErrorRecord.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
        if ($cause.Message -cin $known) { $code = $cause.Message }
        $cause = $cause.InnerException
    }
    return $code
}
function New-ProtectedInstallAcl([bool]$Directory, [string]$OperatorSid, [bool]$Private = $false) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl,
        $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    return $acl
}
function New-ProtectedInstallDirectory([string]$Path, [string]$OperatorSid) {
    $held = [ProtectedInstallFile]::CreateDirectory($Path, (New-ProtectedInstallAcl $true $OperatorSid).GetSecurityDescriptorBinaryForm())
    $held | Add-Member ScriptMethod Protected { param($ancestor); return $true } -Force
    return $held
}
$script:OriginalSnapshot = (Get-Command Read-ProtectedInstallSnapshot).ScriptBlock
function Read-ProtectedInstallSnapshot([string]$Path, [bool]$Directory = $false, [bool]$RequireProtection = $true) {
    return (& $script:OriginalSnapshot $Path $Directory $false)
}
function New-ProtectedInstallJournal($Context, $Stage) {
    return @{ generation = ('f' * 32); leaf = 'operations-' + $Context.installId + '-' + $Stage.epoch + '-' + $Stage.revision + '.jsonl';
        directory = @{ volume = ('1' * 16); fileId = ('2' * 32); securitySha256 = ('3' * 64) };
        file = @{ volume = ('1' * 16); fileId = ('4' * 32); securitySha256 = ('5' * 64) } }
}
function Release-ProtectedInstallJournal($Journal) { }
function Remove-ProtectedInstallJournal($Context, $Journal) { }
function Assert-ProtectedInstallAdministrator { }

Need ((Test-Path -LiteralPath $Scratch -PathType Container) -and @(Get-ChildItem -LiteralPath $Scratch -Force).Count -eq 0)
[ProtectedGuiBundleFiles]::ModelProtectionForTest()
$installation = Join-Path $Scratch 'installation'; [IO.Directory]::CreateDirectory($installation) | Out-Null
$profileBase = Join-Path $Scratch 'local-app-data'; [IO.Directory]::CreateDirectory($profileBase) | Out-Null
$script:ProtectedInstallParent = [IO.Path]::GetFullPath($installation)
$script:ProtectedInstallRoot = Join-Path $installation 'published'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$parent = [ProtectedInstallFile]::new($installation, $true, $false)
$principal = [ProtectedGuiIdentity]::CreateForProcessTest($profileBase)
$sourceOwner = [ProtectedGuiBundleFiles]::Capture($Source, [IO.File]::ReadAllBytes($Manifest))
$inputs = @{}; $files = @(); $hash = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) {
        $bytes = [Text.Encoding]::UTF8.GetBytes('fixture inspection image; never executed')
        $inputs[$name] = $bytes
        $files += @{ name = $name; bytes = $bytes.Length; sha256 = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    }
} finally { $hash.Dispose() }
$context = @{ installId = ('a' * 32); operatorSid = $sid; operatorAccount = 'FixtureOnly'; selectionId = ('c' * 32); selectionEpoch = ('d' * 32);
    inputs = $inputs; manifest = @{ files = $files }; credential = [byte[]]@(1); parent = $parent; cleanupUnknown = $false; failedStage = $null;
    rollback = $null; guiPrincipal = $principal; guiInput = @{ source = $sourceOwner; principal = $principal; ownsSource = $true; ownsPrincipal = $false } }
$script:Stops = 0; $script:InputsRead = 0
$service = [pscustomobject]@{ Original = $true }
$service | Add-Member ScriptMethod Status { return @(1, 0) }
$service | Add-Member ScriptMethod WaitExited { }
$service | Add-Member ScriptMethod Recheck { }
$service | Add-Member ScriptMethod Stop { $script:Stops++ }
$context.service = $service
function Assert-ProtectedInstallation($Association) {
    if ($Association.cleanupUnknown) { throw 'protected-owned-cleanup-unknown' }
    Need ([object]::ReferenceEquals($Association, $context))
    $Association.parent.Recheck(); Assert-ProtectedInstallStage $Association.stage
}
function Read-ProtectedInstallInputs($Root, $Manifest) { $script:InputsRead++; throw 'fixture-input-must-not-be-opened' }
