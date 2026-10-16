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
function New-DiagnosticJournal {
    return @{ operation = 'publish'; failure = $null; cleanup = @{ state = 'unknown' }; createdSid = $null;
        createdRoots = @(); service = $null; published = $false }
}
if ($Mode -ceq 'diagnostic-projection-matrix') {
    . (Join-Path $Project 'scripts/installation/protected-install-transaction.ps1')
    # Synthetic exception metadata qualifies only this finite projection/type
    # contract. These numbers are not observations of native GUI failures.
    $private = 'PRIVATE_GUI_CANARY_20261016'
    function New-SyntheticFailure([string]$Message, $Operation = $null, $Number = $null, $Inner = $null) {
        $syntheticFailure = [IO.InvalidDataException]::new($Message, $Inner)
        if ($null -ne $Operation) { $syntheticFailure.Data['protectedOperation'] = $Operation }
        if ($null -ne $Number) { $syntheticFailure.Data['protectedNativeWin32'] = $Number }
        $syntheticFailure.Data['path'] = ('C:\' + $private + '\gui.exe'); $syntheticFailure.Data['command'] = ('execute-' + $private)
        $syntheticFailure.Data['protectedGuiOwner'] = [pscustomobject]@{ Private = $private }
        return $syntheticFailure
    }
    function Synthetic-Record($Failure) {
        return [Management.Automation.ErrorRecord]::new($Failure, 'synthetic-gui-projection', [Management.Automation.ErrorCategory]::NotSpecified, $private)
    }
    function Project-Synthetic([string]$Name, $Failure) {
        $journal = New-DiagnosticJournal
        Set-ProtectedInstallFailure $journal (Synthetic-Record $Failure)
        $receipt = Get-ProtectedInstallJournalReceipt $journal
        return @{ name = $Name; operation = $receipt.failure.operation; diagnosticCode = $receipt.failure.diagnosticCode; nativeWin32 = $receipt.failure.nativeWin32 }
    }
    $rows = [Collections.Generic.List[object]]::new()
    $codes = @('protected-gui-input-refused', 'protected-gui-binding-refused', 'protected-gui-manifest-refused',
        'protected-gui-bundle-refused', 'protected-gui-principal-refused', 'protected-gui-cleanup-unknown')
    for ($index = 0; $index -lt $codes.Count; $index++) { $rows.Add((Project-Synthetic ('code-' + $index) (New-SyntheticFailure $codes[$index]))) }
    $operations = @('protected-gui-metadata-changed', 'protected-gui-open-original-id', 'protected-gui-delete-original')
    $numbers = @([int]0, [int]17, [int]::MaxValue)
    for ($index = 0; $index -lt $operations.Count; $index++) {
        $rows.Add((Project-Synthetic ('op-' + $index) (New-SyntheticFailure 'protected-gui-bundle-refused' $operations[$index] $numbers[$index])))
    }
    $unknownCodes = @($private, 'PROTECTED-GUI-BUNDLE-REFUSED', 'prefix-protected-gui-bundle-refused', 'protected-gui-bundle-refused-suffix')
    for ($index = 0; $index -lt $unknownCodes.Count; $index++) { $rows.Add((Project-Synthetic ('unknown-code-' + $index) (New-SyntheticFailure $unknownCodes[$index]))) }
    $unknownOperations = @($private, 'PROTECTED-GUI-OPEN-ORIGINAL-ID', 'prefix-protected-gui-open-original-id', 'protected-gui-open-original-id-suffix')
    for ($index = 0; $index -lt $unknownOperations.Count; $index++) {
        $rows.Add((Project-Synthetic ('unknown-op-' + $index) (New-SyntheticFailure 'protected-gui-bundle-refused' $unknownOperations[$index] ([int]17))))
    }
    foreach ($entry in @(@{ name = 'native-int64'; value = [long]17 }, @{ name = 'native-string'; value = '17' }, @{ name = 'native-negative'; value = [int]-1 })) {
        $rows.Add((Project-Synthetic $entry.name (New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-open-original-id' $entry.value)))
    }
    $inner = New-SyntheticFailure 'protected-gui-bundle-refused' $null ([int]23)
    $rows.Add((Project-Synthetic 'pair-inner-number-ignored' (New-SyntheticFailure $private 'protected-gui-open-original-id' ([int]17) $inner)))
    $inner = New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-metadata-changed'
    $rows.Add((Project-Synthetic 'pair-outer-number-not-borrowed' (New-SyntheticFailure $private $null ([int]17) $inner)))
    $inner = New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-delete-original' ([int]23)
    $rows.Add((Project-Synthetic 'pair-deeper-known-replaces' (New-SyntheticFailure 'protected-gui-cleanup-unknown' 'protected-gui-open-original-id' ([int]17) $inner)))
    $inner = New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-metadata-changed'
    $rows.Add((Project-Synthetic 'pair-deeper-known-clears' (New-SyntheticFailure 'protected-gui-cleanup-unknown' 'protected-gui-open-original-id' ([int]17) $inner)))
    $inner = New-SyntheticFailure $private 'protected-gui-unknown-operation' ([int]23)
    $rows.Add((Project-Synthetic 'pair-deeper-unknown-ignored' (New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-open-original-id' ([int]17) $inner)))
    foreach ($depth in @(7, 8)) {
        $syntheticFailure = New-SyntheticFailure 'protected-gui-manifest-refused' 'protected-gui-open-original-id' ([int]17)
        for ($index = 0; $index -lt $depth; $index++) { $syntheticFailure = New-SyntheticFailure $private $null $null $syntheticFailure }
        $rows.Add((Project-Synthetic ('depth-' + $depth) $syntheticFailure))
    }
    $journal = New-DiagnosticJournal
    $journal.password = $private; $journal.inputs = @{ secret = $private }; $journal.association = [pscustomobject]@{ Private = $private }
    $journal.guiInput = $private; $journal.command = $private
    Set-ProtectedInstallFailure $journal (Synthetic-Record (New-SyntheticFailure 'protected-gui-principal-refused'))
    $originalFailure = $journal.failure
    Set-ProtectedInstallFailure $journal (Synthetic-Record (New-SyntheticFailure 'protected-gui-bundle-refused' 'protected-gui-delete-original' ([int]23)))
    $receipt = Get-ProtectedInstallJournalReceipt $journal
    @{ syntheticProjection = $true; nativeWin32Observed = $false; rows = $rows.ToArray();
        firstFailureExact = [object]::ReferenceEquals($journal.failure, $originalFailure);
        privacyReceipt = $receipt; receiptKeys = @($receipt.Keys | Sort-Object); failureKeys = @($receipt.failure.Keys | Sort-Object) } | ConvertTo-Json -Depth 6 -Compress
    return
}
if ($Mode -ceq 'diagnostic-malformed-manifest') {
    . (Join-Path $Project 'scripts/installation/protected-install-transaction.ps1')
    $failureRecord = $null
    try { $unexpected = [ProtectedGuiBundleFiles]::Capture($Source, [IO.File]::ReadAllBytes($Manifest)); $unexpected.Dispose() }
    catch { $failureRecord = $_ }
    if ($null -eq $failureRecord) { throw 'gui-diagnostic-expected-manifest-error' }
    $sourceCode = $null; $cause = $failureRecord.Exception
    for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
        if ($cause.Message -ceq 'protected-gui-manifest-refused') { $sourceCode = $cause.Message }
        $cause = $cause.InnerException
    }
    $journal = New-DiagnosticJournal; $journal.operation = 'input'
    Set-ProtectedInstallFailure $journal $failureRecord
    @{ actualManifestHelper = $true; sourceDiagnosticCode = $sourceCode; receipt = (Get-ProtectedInstallJournalReceipt $journal);
        cleanupUnknown = (Test-ProtectedInstallCleanupUnknown $failureRecord) } | ConvertTo-Json -Depth 5 -Compress
    return
}
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
    if ($Mode -ceq 'diagnostic-rename-missing') {
        . (Join-Path $Project 'scripts/installation/protected-install-transaction.ps1')
        $failureRecord = $null
        [ProtectedGuiBundleFiles]::SetRenameFailureForTest('missing')
        try { $stage.gui.bundle.RenameStage($stage.root, $stage.parent, (Join-Path $Scratch 'published')) }
        catch { $failureRecord = $_ }
        finally { [ProtectedGuiBundleFiles]::SetRenameFailureForTest('') }
        if ($null -eq $failureRecord) { throw 'gui-diagnostic-expected-helper-error' }
        if (!(Test-ProtectedInstallCleanupUnknown $failureRecord)) { throw 'gui-diagnostic-expected-unknown-wrapper' }
        # Deleting the original can change its directory metadata before the
        # missing leaf is resumed. Observe the actual fixed helper identity;
        # this control makes no claim that OpenFileById reached the missing leaf.
        $sourceOperation = $null; $sourceCode = $null; $captured = $null; $cause = $failureRecord.Exception
        $trace = [Collections.Generic.List[object]]::new()
        $knownOperations = @('protected-gui-metadata-changed', 'protected-gui-open-original-id', 'protected-gui-delete-original')
        $knownCodes = @('protected-gui-input-refused', 'protected-gui-binding-refused', 'protected-gui-manifest-refused',
            'protected-gui-bundle-refused', 'protected-gui-principal-refused', 'protected-gui-cleanup-unknown')
        for ($depth = 0; $depth -lt 8 -and $null -ne $cause; $depth++) {
            $operation = if ($cause.Data['protectedOperation'] -is [string] -and $cause.Data['protectedOperation'] -cin $knownOperations) { $cause.Data['protectedOperation'] } else { $null }
            $code = if ($cause.Message -cin $knownCodes) { $cause.Message } else { $null }
            $numberType = if (!$cause.Data.Contains('protectedNativeWin32')) { 'absent' } elseif ($cause.Data['protectedNativeWin32'] -is [int]) { 'int32' } else { 'other' }
            $kind = if ($cause -is [IO.InvalidDataException]) { 'invalid-data' } elseif ($cause -is [Management.Automation.MethodInvocationException]) { 'method-invocation' } else { 'other' }
            $trace.Add(@{ depth = $depth; kind = $kind; operation = $operation; code = $code; nativeCodeType = $numberType })
            if ($null -ne $code) { $sourceCode = $code }
            if ($null -ne $operation) {
                $sourceOperation = $operation; $captured = $null
                if ($cause.Data['protectedNativeWin32'] -is [int] -and $cause.Data['protectedNativeWin32'] -ge 0) { $captured = $cause.Data['protectedNativeWin32'] }
            }
            $cause = $cause.InnerException
        }
        $journal = @{ operation = 'publish'; failure = $null; cleanup = @{ state = 'unknown' }; createdSid = $null;
            createdRoots = @(); service = $null; published = $false }
        Set-ProtectedInstallFailure $journal $failureRecord
        $receipt = Get-ProtectedInstallJournalReceipt $journal
        @{ helperFailureObserved = $true; sourceOperation = $sourceOperation; sourceDiagnosticCode = $sourceCode;
            nativeCodeCaptured = ($captured -is [int]); capturedNativeWin32 = $captured; finiteChain = $trace.ToArray();
            projectedOperation = $receipt.failure.operation; projectedNativeWin32 = $receipt.failure.nativeWin32;
            projectedDiagnosticCode = $receipt.failure.diagnosticCode;
            cleanupUnknown = (Test-ProtectedInstallCleanupUnknown $failureRecord); modeledPrincipalAndProtection = $true } | ConvertTo-Json -Depth 5 -Compress
        return
    }
    Move-ProtectedInstallStage $stage (Join-Path $Scratch 'published'); Assert-ProtectedInstallStage $stage
    Need ($stage.rows.Count -eq 1 -and [IO.File]::ReadAllText((Join-Path $stage.root.PathName 'registered-gui-candidate.json')) -ceq [Text.Encoding]::UTF8.GetString($stage.gui.recordBytes))
    Remove-ProtectedInstallStage $stage $false; Need ($null -eq $stage.gui -and !(Test-Path -LiteralPath $stage.path))
    @{ passed = $true; serializer = $true; nativeFiles = $true; modeledPrincipalAndProtection = $true; guiEnrollment = $false } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $stage.gui) { $stage.gui.bundle.Dispose() }
    $sourceOwner.Dispose(); $principal.Dispose(); $root.Dispose(); $parent.Dispose()
}
