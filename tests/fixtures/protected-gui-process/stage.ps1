param([string]$Project, [string]$Assembly, [string]$Source, [string]$Manifest, [string]$Scratch,
    [ValidateSet('lifecycle', 'administrative-unknown', 'closure-observation-unknown', 'expiry', 'profile-existing', 'profile-replacement', 'natural-exit', 'execution-substitution')][string]$Mode = 'lifecycle')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
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
        'protected-gui-process-active', 'protected-gui-process-association-refused', 'protected-stage-acl-refused')
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
function Wait-Ready([string]$Profile) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while (!(Test-Path -LiteralPath (Join-Path $Profile 'child-ready.json'))) {
        Need ($watch.ElapsedMilliseconds -lt 5000); Start-Sleep -Milliseconds 5
    }
    Need ((Get-Item -LiteralPath (Join-Path $Profile 'child-ready.json')).Length -le 1024)
}
$stage = $null; $process = $null; $profile = $null; $settled = $false; $preStopState = $null
$firstPhase = 'none'; $firstCode = 'none'; $cleanupPhase = 'none'; $cleanupCode = 'none'
try {
    $script:Checkpoint = 'stage'
    $stage = New-ProtectedInstallStage $context 1 ('1' * 32); $context.stage = $stage
    Move-ProtectedInstallStage $stage $script:ProtectedInstallRoot
    $stage.published = $true
    $originalRoot = $stage.root; $originalBundle = $stage.gui.bundle
    $originalRootId = $stage.root.FileId; $originalBundleId = $stage.gui.bundle.FileId
    $record = [Convert]::ToBase64String($stage.gui.recordBytes)
    Close-ProtectedGuiCandidate $context.guiInput; $context.guiInput = $null
    if ($Mode -ceq 'execution-substitution') {
        $script:Checkpoint = 'execution-link-substitution'
        $payload = Join-Path $stage.root.PathName 'GuiBundle/resources/app.asar'
        $retainedOriginal = Join-Path $Scratch 'original-app.asar.retained'
        $originalBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($payload))
        [ProcessTestControls]::ArmExecutionSubstitution($payload, $retainedOriginal)
        $refused = $false
        try { Start-ProtectedInstallationGui $context | Out-Null } catch { $refused = Has-Failure $_ 'protected-gui-process-cleanup-unknown' }
        $process = $context.guiProcess; $state = Get-ProtectedInstallationGuiState $context
        Need ($refused -and [ProcessTestControls]::ExecutionSubstitutionAttempted -and $context.cleanupUnknown -and
            $state.cleanupUnknown -and !$state.released -and $null -eq $state.rootAlive -and $null -eq $state.activeProcesses -and !$process.IsSettled)
        Need ([ProcessTestControls]::ExecutionOriginalIdentity -cne [ProcessTestControls]::ExecutionReplacementIdentity -and
            [ProcessTestControls]::FileIdentity($retainedOriginal) -ceq [ProcessTestControls]::ExecutionOriginalIdentity -and
            [ProcessTestControls]::FileIdentity($payload) -ceq [ProcessTestControls]::ExecutionReplacementIdentity -and
            [Convert]::ToBase64String([IO.File]::ReadAllBytes($retainedOriginal)) -ceq $originalBytes -and
            [IO.File]::ReadAllText($payload) -ceq 'foreign-execution-link')
        $guarded = $false; $againRefused = $false
        try { Remove-ProtectedInstallation $context } catch { $guarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
        try { Stop-ProtectedInstallationGui $context | Out-Null } catch { $againRefused = Has-Failure $_ 'protected-gui-process-cleanup-unknown' }
        Need ($guarded -and $againRefused -and $script:Stops -eq 0 -and $script:InputsRead -eq 0 -and
            [object]::ReferenceEquals($context.guiProcess, $process) -and [object]::ReferenceEquals($context.stage.root, $originalRoot) -and
            [object]::ReferenceEquals($context.stage.gui.bundle, $originalBundle) -and
            !(Test-Path -LiteralPath (Join-Path $profileBase 'AEGIS')))
        [IO.File]::WriteAllText((Join-Path $Scratch 'uncertainty.retained'), 'modeled-namespace-substitution-before-link-open;no-native-process-created')
        @{ passed = $true; actualNamespaceSubstitution = $true; originalAndReplacementIdsAndBytesPreserved = $true;
            noNativeProcessCreated = $true; stickyUnknown = $true; exactOriginalReferencesRetained = $true;
            repeatStopRefused = $againRefused; uninstallGuarded = $guarded; noFollowupEffects = $true;
            modeledPrincipalProtectionAccountServiceVmAndJournal = $true; guiEnrollment = $false; launchAllowed = $false } | ConvertTo-Json -Compress
        return
    }
    if ($Mode -ceq 'profile-existing') {
        $script:Checkpoint = 'preexisting-profile'
        [ProcessTestControls]::ArmPreexistingAttempt()
        $refused = $false
        try { Start-ProtectedInstallationGui $context | Out-Null } catch { $refused = Has-Failure $_ 'protected-gui-process-profile-refused' }
        $process = $context.guiProcess; $state = Get-ProtectedInstallationGuiState $context
        $foreign = Join-Path ([ProcessTestControls]::AttemptPath) 'foreign-profile-canary'
        Need ($refused -and $process.IsSettled -and !$state.released -and !$state.cleanupUnknown -and
            $null -eq $state.rootAlive -and $null -eq $state.activeProcesses -and [IO.File]::ReadAllText($foreign) -ceq 'original-foreign-data')
        $stage.gui.bundle.CheckCurrent($stage.root); Assert-ProtectedInstallStage $stage
        Remove-ProtectedInstallStage $stage $true; $stage = $null; $settled = $true
        Need ([IO.File]::ReadAllText($foreign) -ceq 'original-foreign-data')
        [IO.File]::WriteAllText((Join-Path $Scratch 'cleanup.confirmed'), 'profile-attempt-refused-before-native-creation')
        @{ passed = $true; actualAtomicProfileRefusal = $true; foreignProfilePreserved = $true; noChildReleased = $true;
            originalPackageRestored = $true; modeledPrincipalProtectionAccountServiceVmAndJournal = $true; guiEnrollment = $false; launchAllowed = $false } | ConvertTo-Json -Compress
        return
    }
    if ($Mode -ceq 'profile-replacement') { [ProcessTestControls]::ArmReplacementAttempt() }
    if ($Mode -ceq 'natural-exit') { [ProcessTestControls]::ArmNaturalExit() }
    $payload = Join-Path $stage.root.PathName 'GuiBundle/resources/app.asar'
    $payloadBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($payload))
    $script:Checkpoint = 'start'
    Start-ProtectedInstallationGui $context | Out-Null
    $process = $context.guiProcess
    Need ($null -ne $process)
    $profiles = @(Get-ChildItem -LiteralPath (Join-Path $profileBase ('AEGIS/ProtectedGui/' + $context.installId)) -Force)
    Need ($profiles.Count -eq 1 -and $profiles[0].PSIsContainer -and $profiles[0].Name -cmatch '^[a-f0-9]{32}$')
    $profile = $profiles[0].FullName; Wait-Ready $profile
    if ($Mode -ceq 'profile-replacement') {
        Need ([ProcessTestControls]::ReplacementAttempted -and [ProcessTestControls]::ReplacementRefused -and
            [ProcessTestControls]::AttemptPath -ceq $profile -and !(Test-Path -LiteralPath ($profile + '-replacement')))
    }
    $script:Checkpoint = 'initial-state'
    $state = Get-ProtectedInstallationGuiState $context
    $rootBit = if ($state.rootAlive -eq $true) { 'true' } elseif ($state.rootAlive -eq $false) { 'false' } else { 'unavailable' }
    $activeCount = if ($null -ne $state.activeProcesses -and $state.activeProcesses -ge 0 -and $state.activeProcesses -le 64) { [string]$state.activeProcesses } else { 'unavailable' }
    $script:ObservedState = 'root=' + $rootBit + ',active=' + $activeCount + ',released=' + [bool]$state.released + ',unknown=' + [bool]$state.cleanupUnknown
    Need ($state.rootAlive -and $state.activeProcesses -eq 1 -and $state.released -and !$state.cleanupUnknown -and !$state.guiEnrollment -and !$state.launchAllowed)
    $busyCheck = $false; $busyBoundCheck = $false
    $script:Checkpoint = 'busy-check-unbound'
    try { $stage.gui.bundle.CheckCurrent() } catch { $busyCheck = $true }
    $script:Checkpoint = 'busy-check-bound'
    try { $stage.gui.bundle.CheckCurrent($stage.root) } catch { $busyBoundCheck = $true }
    $script:Checkpoint = 'busy-check-result'
    Need ($busyCheck -and $busyBoundCheck)
    $writeRefused = $false; $deleteRefused = $false
    $script:Checkpoint = 'strict-payload-write'
    try { $writer = [IO.File]::Open($payload, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $writer.Dispose() }
    catch [IO.IOException] { $writeRefused = $true }
    $script:Checkpoint = 'strict-payload-delete'
    try { [IO.File]::Delete($payload) } catch [IO.IOException] { $deleteRefused = $true }
    $script:Checkpoint = 'strict-payload-result'
    $payloadExists = Test-Path -LiteralPath $payload
    $script:PayloadState = 'writeRefused=' + [bool]$writeRefused + ',deleteRefused=' + [bool]$deleteRefused + ',exists=' + [bool]$payloadExists
    Need ($writeRefused -and $deleteRefused -and $payloadExists)
    $script:Checkpoint = 'strict-payload-preserved'
    Need ([Convert]::ToBase64String([IO.File]::ReadAllBytes($payload)) -ceq $payloadBytes)
    $state = Get-ProtectedInstallationGuiState $context
    Need ($state.rootAlive -and $state.activeProcesses -eq 1 -and $state.released -and !$state.cleanupUnknown)
    $activeUpgradeRefused = $false; $activeUninstallRefused = $false
    $script:Checkpoint = 'active-upgrade-guard'
    try { Update-ProtectedInstallation $context 'never-open-inputs' $context.manifest | Out-Null } catch { $activeUpgradeRefused = $_.Exception.Message -ceq 'protected-gui-process-active' }
    $script:Checkpoint = 'active-uninstall-guard'
    try { Remove-ProtectedInstallation $context } catch { $activeUninstallRefused = $_.Exception.Message -ceq 'protected-gui-process-active' }
    $script:Checkpoint = 'active-guard-result'
    Need ($activeUpgradeRefused -and $activeUninstallRefused -and $script:Stops -eq 0 -and $script:InputsRead -eq 0)
    Need ([object]::ReferenceEquals($context.guiProcess, $process) -and [object]::ReferenceEquals($context.stage.root, $originalRoot) -and [object]::ReferenceEquals($context.stage.gui.bundle, $originalBundle))
    $unknownRetained = $false
    if ($Mode -ceq 'administrative-unknown') {
        # Administrative confirmation loss only. No native unknown flag is reset
        # and no external process/token/path is adopted.
        $context.cleanupUnknown = $true
        $blocked = $false; try { Update-ProtectedInstallation $context 'never-open-inputs' $context.manifest | Out-Null } catch { $blocked = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
        $unknownRetained = $blocked -and [object]::ReferenceEquals($context.guiProcess, $process) -and
            [object]::ReferenceEquals($context.stage.root, $originalRoot) -and [object]::ReferenceEquals($context.stage.gui.bundle, $originalBundle)
        Need ($unknownRetained -and $script:Stops -eq 0 -and $script:InputsRead -eq 0)
    }
    $script:Checkpoint = 'stop'
    if ($Mode -ceq 'natural-exit') {
        # The child has already signaled readiness and the actual Start returned.
        # Exit is released by this fixture-owned file, not startup/sleep timing.
        [IO.File]::WriteAllText((Join-Path $profile 'fixture-exit-now'), 'exit-now')
        $watch = [Diagnostics.Stopwatch]::StartNew()
        do {
            $state = Get-ProtectedInstallationGuiState $context
            Need ($watch.ElapsedMilliseconds -lt 5000 -and !$state.cleanupUnknown)
            if ($state.rootAlive -or $state.activeProcesses -gt 0) { Start-Sleep -Milliseconds 2 }
        } while ($state.rootAlive -or $state.activeProcesses -gt 0)
        Need ($state.rootAlive -eq $false -and $state.activeProcesses -eq 0 -and !$process.IsSettled -and
            [object]::ReferenceEquals($context.guiProcess, $process))
        $preStopState = $state.state
        $blocked = $false
        try { Update-ProtectedInstallation $context 'never-open-inputs' $context.manifest | Out-Null } catch { $blocked = $_.Exception.Message -ceq 'protected-gui-process-active' }
        Need ($blocked -and $script:InputsRead -eq 0 -and $script:Stops -eq 0)
    }
    if ($Mode -ceq 'closure-observation-unknown') {
        [ProcessTestControls]::FailClosureAcknowledgment()
        $refused = $false
        try { Stop-ProtectedInstallationGui $context | Out-Null } catch { $refused = Has-Failure $_ 'protected-gui-process-cleanup-unknown' }
        $state = Get-ProtectedInstallationGuiState $context
        Need ($refused -and $state.cleanupUnknown -and !$state.rootAlive -and $state.activeProcesses -eq 0 -and !$process.IsSettled -and
            [object]::ReferenceEquals($context.guiProcess, $process) -and [object]::ReferenceEquals($stage.root, $originalRoot) -and [object]::ReferenceEquals($stage.gui.bundle, $originalBundle))
        $guarded = $false
        try { Remove-ProtectedInstallation $context } catch { $guarded = $_.Exception.Message -ceq 'protected-owned-cleanup-unknown' }
        $againRefused = $false; try { Stop-ProtectedInstallationGui $context | Out-Null } catch { $againRefused = Has-Failure $_ 'protected-gui-process-cleanup-unknown' }
        Need ($guarded -and $againRefused -and $context.cleanupUnknown -and $script:Stops -eq 0 -and $script:InputsRead -eq 0 -and
            $stage.root.FileId -ceq $originalRootId -and [Convert]::ToBase64String($stage.gui.recordBytes) -ceq $record)
        # Physically observed Job0 is distinct from the injected unavailable
        # acknowledgment. Keep the package/profile evidence and original owner.
        [IO.File]::WriteAllText((Join-Path $Scratch 'uncertainty.retained'), 'modeled-acknowledgment-loss-after-actual-root-exit-and-job-empty')
        @{ passed = $true; actualStageAndNativeProcess = $true; actualRootExitedAndJobEmpty = $true;
            modeledClosureAcknowledgmentLoss = $true; stickyUnknown = $true; exactOriginalReferencesRetained = $true;
            repeatStopRefused = $againRefused; uninstallGuarded = $guarded; noFollowupEffects = $true;
            modeledPrincipalProtectionAccountServiceVmAndJournal = $true; guiEnrollment = $false; launchAllowed = $false } | ConvertTo-Json -Compress
        return
    }
    if ($Mode -ceq 'expiry') { $process.ExpireForTest() }
    Stop-ProtectedInstallationGui $context | Out-Null
    $state = Get-ProtectedInstallationGuiState $context
    $settled = !$state.rootAlive -and $state.activeProcesses -eq 0 -and ($state.cleanupUnknown -eq ($Mode -ceq 'administrative-unknown'))
    Need ($settled -and $state.profileDataRetained)
    $script:Checkpoint = 'restore-after-busy-check'
    $stage.gui.bundle.CheckCurrent($stage.root); Assert-ProtectedInstallStage $stage
    [IO.File]::WriteAllText((Join-Path $profile 'retained-user-file'), 'keep-profile')
    if ($Mode -ceq 'administrative-unknown') {
        # Explicitly modeled verification of this original administrative owner
        # after the actual whole Job has settled. Test teardown only.
        $context.cleanupUnknown = $false
    }
    $script:Checkpoint = 'retry'
    $retryRefused = $false; try { Start-ProtectedInstallationGui $context | Out-Null } catch { $retryRefused = $_.Exception.Message -ceq 'protected-gui-process-attempt-consumed' }; Need $retryRefused
    Need ($stage.root.FileId -ceq $originalRootId -and $stage.gui.bundle.FileId -ceq $originalBundleId -and [Convert]::ToBase64String($stage.gui.recordBytes) -ceq $record)
    $script:Checkpoint = 'retire-original'
    Remove-ProtectedInstallStage $stage $true; $stage = $null
    Need ([IO.File]::ReadAllText((Join-Path $profile 'retained-user-file')) -ceq 'keep-profile')
    [IO.File]::WriteAllText((Join-Path $Scratch 'cleanup.confirmed'), 'original-root-exited-and-job-empty')
    @{ passed = $true; actualStageAndNativeProcess = $true; modeledPrincipalProtectionAccountServiceVmAndJournal = $true;
        writeRefused = $writeRefused; deleteRefused = $deleteRefused; payloadBytesPreservedWhileRootAlive = $true; activeUpgradeRefused = $activeUpgradeRefused; activeUninstallRefused = $activeUninstallRefused;
        noFollowupEffects = ($script:Stops -eq 0 -and $script:InputsRead -eq 0); originalReferencesRetained = $true; originalIdsAndCandidateBytesPreserved = $true;
        busyChecksRefusedWithoutPoisoningRestoration = ($busyCheck -and $busyBoundCheck);
        modeledExpiryCallbackDispatch = ($Mode -ceq 'expiry'); actualProfileReplacementRefused = ($Mode -ceq 'profile-replacement');
        preStopState = $preStopState;
        administrativeUnknownRetained = $unknownRetained; rootExitedAndJobEmpty = $settled; persistedProfilePreserved = $true; sameEpochRetryRefused = $retryRefused;
        guiEnrollment = $false; launchAllowed = $false } | ConvertTo-Json -Compress
} catch {
    $firstPhase = $script:Checkpoint; $firstCode = Get-SafeFailureCode $_
} finally {
    try {
        $script:Checkpoint = 'finally-clear-controls'; [ProcessTestControls]::Clear()
        if ($null -ne $process -and $Mode -cnotin @('closure-observation-unknown', 'execution-substitution')) {
            $script:Checkpoint = 'finally-stop'; $process.Stop()
            $script:Checkpoint = 'finally-dispose-process'; $process.Dispose()
        }
        # Failed cases retain files/pins through this process exit for root triage.
        if ($settled -and $null -eq $stage) {
            $script:Checkpoint = 'finally-dispose-principal'; $principal.Dispose()
            $script:Checkpoint = 'finally-dispose-parent'; $parent.Dispose()
        }
    } catch { $cleanupPhase = $script:Checkpoint; $cleanupCode = Get-SafeFailureCode $_ }
    if ($firstPhase -cne 'none' -or $cleanupPhase -cne 'none') {
        $leasePhase = 'unavailable'
        if ($null -ne $process) {
            $phaseProperty = $process.GetType().GetProperty('FailurePhaseForTest')
            if ($null -ne $phaseProperty) {
                $phase = [string]$phaseProperty.GetValue($process, $null)
                if ($phase -cin @('none', 'native-observe', 'principal', 'pins', 'profile', 'native-live', 'binding',
                    'deadline-before', 'deadline-after', 'native-stop', 'native-observe-stopped', 'native-terminal-invariant',
                    'known-cleanup', 'native-close', 'binding-close', 'pins-restore', 'profile-close', 'principal-release')) { $leasePhase = $phase }
            }
        }
        throw ('gui-process-stage-fixture:first=' + $firstPhase + ';code=' + $firstCode + ';state=' + $script:ObservedState + ';payload=' + $script:PayloadState + ';leasePhase=' + $leasePhase + ';cleanup=' + $cleanupPhase + ';cleanupCode=' + $cleanupCode)
    }
}
