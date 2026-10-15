Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../installation/protected-installation.ps1')

function Test-InstalledOwnerPayload([string]$PayloadRoot, [string]$ExpectedSourceSha) {
    $names = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe', 'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
        'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs', 'scripts/installation/ProtectedInstallDisk.cs', 'scripts/installation/protected-install-files.ps1',
        'scripts/installation/protected-install-transaction.ps1', 'scripts/installation/protected-vm-provider.ps1', 'scripts/installation/protected-vm.ps1',
        'scripts/installation/protected-installation.ps1', 'scripts/qualification/installed-owner-phase.ps1', 'scripts/qualification/installed-owner-guest-bootstrap.ps1')
    $manifestPath = Join-Path $PayloadRoot 'payload-manifest.json'
    $manifestFile = Get-Item -LiteralPath $manifestPath -Force
    if ($manifestFile.PSIsContainer -or $manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $manifestFile.Length -gt 16KB) { throw 'installed-payload-manifest-refused' }
    $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or $manifest.sourceSha -cne $ExpectedSourceSha -or @($manifest.files).Count -ne $names.Count) { throw 'installed-payload-source-refused' }
    foreach ($name in $names) {
        $rows = @($manifest.files | Where-Object { $_.path -ceq $name })
        if ($rows.Count -ne 1 -or $rows[0].bytes -lt 1 -or $rows[0].bytes -gt 4MB -or $rows[0].sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'installed-payload-input-refused' }
        $held = [ProtectedInstallFile]::new((Join-Path $PayloadRoot $name), $false, $false)
        try { if ($held.Read(4MB).Length -ne $rows[0].bytes -or $held.Hash(4MB) -cne $rows[0].sha256) { throw 'installed-payload-digest-refused' } }
        finally { $held.Dispose() }
    }
    return $manifest
}
function Get-InstalledOwnerBinaryManifest($Payload, [bool]$Baseline) {
    $files = @()
    foreach ($name in @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe')) {
        $path = if ($Baseline -and $name -ceq 'aegis-session.exe') { 'baseline/' + $name } else { 'binaries/' + $name }
        $row = @($Payload.files | Where-Object { $_.path -ceq $path })[0]
        $files += @{ name = $name; sha256 = $row.sha256; bytes = $row.bytes }
    }
    return @{ schemaVersion = 1; files = $files }
}
function Get-InstalledOwnerReceiptPaths($Association) {
    $stem = $Association.installId + '-' + $Association.stage.epoch + '-' + $Association.stage.revision
    return @{ result = Join-Path $Association.receipts.PathName ('owner-result-' + $stem + '.json'); count = Join-Path $Association.receipts.PathName ('inspection-count-' + $stem + '.txt') }
}
function Get-InstalledOwnerObservedField($Value, [string]$Field) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [Collections.IDictionary]) { if ($Value.Keys -ccontains $Field) { return ,$Value[$Field] }; return $null }
    $property = $Value.PSObject.Properties[$Field]; if ($null -ne $property) { return ,$property.Value }; return $null
}
function Get-InstalledOwnerAttemptObservation($Value, [ValidateSet('owner', 'native')][string]$Kind) {
    if ($null -eq $Value) { return $null }
    # Explicit finite scalars exclude images, paths, inspection blobs and unknown fields.
    $result = @{}
    $booleans = if ($Kind -ceq 'owner') { @('exactProcessExited') } else { @('inspected', 'cleanupConfirmed', 'ownedJobsEmpty', 'launchAllowed', 'completeE1', 'nativeProducerReady', 'bootstrapWriteCompleted', 'bootstrapEofClosed', 'supervisorReleased', 'mainReleased') }
    $numbers = if ($Kind -ceq 'owner') { @('pid', 'birthFileTime', 'session') } else { @('schemaVersion', 'ownerSession', 'operatorSession', 'revision', 'supervisorStage', 'supervisorPid', 'mainPid', 'supervisorExitCode', 'inspectionCount') }
    foreach ($field in $booleans) { $v = Get-InstalledOwnerObservedField $Value $field; if ($v -is [bool]) { $result[$field] = $v } }
    foreach ($field in $numbers) { $v = Get-InstalledOwnerObservedField $Value $field; if ($v -is [int] -or $v -is [long] -or $v -is [uint32]) { $result[$field] = $v } }
    foreach ($field in $(if ($Kind -ceq 'owner') { @('sid') } else { @('ownerSid', 'operatorSid') })) {
        $v = Get-InstalledOwnerObservedField $Value $field
        if ($v -is [string] -and $v.Length -le 184 -and $v -cmatch '^S-1-(?:[0-9]{1,10}-){1,14}[0-9]{1,10}$') { $result[$field] = $v }
    }
    $hex = if ($Kind -ceq 'owner') { @{ authentication = 16 } } else { @{ ownerAuthentication = 16; operatorAuthentication = 16; ownerBirth = 16; supervisorBirth = 16; mainBirth = 16; installId = 32; epoch = 32; ownerImageSha256 = 64; supervisorImageSha256 = 64; mainImageSha256 = 64 } }
    foreach ($field in $hex.Keys) { $v = Get-InstalledOwnerObservedField $Value $field; if ($v -is [string] -and $v -cmatch ('^[a-f0-9]{' + $hex[$field] + '}$')) { $result[$field] = $v } }
    if ($Kind -ceq 'native') {
        # Preserve a nullable exact-process observation. Exit code is meaningful only after signaling.
        $signaled = Get-InstalledOwnerObservedField $Value 'mainSignaledBeforeCleanup'
        if ($null -eq $signaled -or $signaled -is [bool]) { $result.mainSignaledBeforeCleanup = $signaled }
        $code = Get-InstalledOwnerObservedField $Value 'mainExitCode'
        if ($null -eq $code) { $result.mainExitCode = $null }
        elseif ($signaled -is [bool] -and $signaled -eq $true -and
            ($code -is [int] -or $code -is [long] -or $code -is [uint32]) -and
            $code -ge 0 -and $code -le [uint32]::MaxValue) { $result.mainExitCode = $code }
        $v = Get-InstalledOwnerObservedField $Value 'supervisorSubstage'
        if ($result.ContainsKey('supervisorStage') -and
            ($v -is [int] -or $v -is [long] -or $v -is [uint32]) -and $v -ge 0 -and
            (($result.supervisorStage -eq 2 -and $v -le 44) -or ($result.supervisorStage -eq 9 -and $v -le 24) -or ($result.supervisorStage -eq 10 -and $v -le 6) -or ($result.supervisorStage -eq 7 -and
                ($v -le 22 -or ($v -ge 114 -and $v -le 126) -or ($v -ge 136 -and $v -le 144) -or
                    ($v -ge 214 -and $v -le 226) -or ($v -ge 236 -and $v -le 244))))) { $result.supervisorSubstage = $v }
        $v = Get-InstalledOwnerObservedField $Value 'scope'; if ($v -is [string] -and $v -ceq 'installed-owner-inspection') { $result.scope = $v }
        $v = Get-InstalledOwnerObservedField $Value 'phase'
        if ($v -is [string] -and $v -cin @('acquire-owner', 'operator-token', 'create-children', 'publish-main', 'supply-supervisor', 'await-completion', 'supply-main', 'await-result', 'confirm-result', 'complete')) { $result.phase = $v }
    }
    return $result
}
function Invoke-InstalledOwnerAttempt($Association, [bool]$ExpectedPositive) {
    $diagnostic = @{ schemaVersion = 1; expectedPositive = $ExpectedPositive; checkpoint = 'attempt-assert'; failure = $null; cleanupUnknown = $Association.cleanupUnknown;
        scm = @(); independentlyObservedOwner = $null; native = $null; resultFile = @{ exists = $null; fresh = $null; bytes = $null }; counterFile = @{ exists = $null; fresh = $null; bytes = $null }; independentCounter = $null }
    $Association.attemptDiagnostic = $diagnostic
    try {
        Assert-ProtectedInstallation $Association
        $diagnostic.checkpoint = 'attempt-fresh-receipts'
        $paths = Get-InstalledOwnerReceiptPaths $Association
        $diagnostic.resultFile.exists = [bool](Test-Path -LiteralPath $paths.result); $diagnostic.counterFile.exists = [bool](Test-Path -LiteralPath $paths.count)
        if ($diagnostic.resultFile.exists -or $diagnostic.counterFile.exists) { throw 'installed-fresh-attempt-receipts-required' }
        $Association.attemptedReceiptPaths += @($paths.result, $paths.count)
        # Owner exit alone does not prove original children/Jobs closed. Only a fresh
        # authenticated maintained-owner closure result may clear this terminal latch.
        $Association.cleanupUnknown = $true
        $diagnostic.checkpoint = 'attempt-start'
        $started = [DateTime]::UtcNow; $Association.service.Start()
        $watch = [Diagnostics.Stopwatch]::StartNew(); $states = [Collections.Generic.List[object]]::new()
        do {
            $diagnostic.checkpoint = 'attempt-status'
            $status = $Association.service.Status()
            if ($states.Count -eq 0 -or $states[$states.Count - 1].state -ne $status[0]) {
                if ($states.Count -ge 32) { throw 'installed-owner-observation-budget-refused' }
                $states.Add(@{ state = $status[0]; pid = $status[1]; milliseconds = $watch.ElapsedMilliseconds }); $diagnostic.scm = $states.ToArray()
            }
            if ($status[0] -eq 1) { break }
            if ($watch.ElapsedMilliseconds -ge 20000) { throw 'installed-owner-attempt-deadline' }
            Start-Sleep -Milliseconds 50
        } while ($true)
        $diagnostic.checkpoint = 'attempt-wait-owner'
        $Association.service.WaitExited()
        $diagnostic.checkpoint = 'attempt-read-result'; $diagnostic.resultFile.exists = [bool](Test-Path -LiteralPath $paths.result)
        $resultFile = Get-Item -LiteralPath $paths.result -Force
        $diagnostic.resultFile.bytes = $resultFile.Length; $diagnostic.resultFile.fresh = $resultFile.CreationTimeUtc -ge $started.AddSeconds(-1)
        if ($resultFile.CreationTimeUtc -lt $started.AddSeconds(-1) -or $resultFile.Length -gt 32KB) { throw 'installed-owner-fresh-result-refused' }
        $row = Read-ProtectedInstallSnapshot $paths.result; $Association.receiptRows += $row
        $native = [IO.File]::ReadAllText($paths.result) | ConvertFrom-Json
        $diagnostic.native = Get-InstalledOwnerAttemptObservation $native 'native'
        $count = 0; $counter = $null
        $diagnostic.checkpoint = 'attempt-read-counter'; $diagnostic.counterFile.exists = [bool](Test-Path -LiteralPath $paths.count)
        if ($diagnostic.counterFile.exists) {
            $counterFile = Get-Item -LiteralPath $paths.count -Force
            $diagnostic.counterFile.bytes = $counterFile.Length; $diagnostic.counterFile.fresh = $counterFile.CreationTimeUtc -ge $started.AddSeconds(-1)
            if ($counterFile.CreationTimeUtc -lt $started.AddSeconds(-1) -or $counterFile.Length -ne 1 -or [IO.File]::ReadAllText($paths.count) -cne '1') { throw 'installed-owner-independent-counter-refused' }
            $counter = Read-ProtectedInstallSnapshot $paths.count; $Association.receiptRows += $counter; $count = 1
        }
        $diagnostic.independentCounter = $count; $diagnostic.checkpoint = 'attempt-runtime-rows'
        Update-ProtectedInstallRuntimeRows $Association.stage
        $diagnostic.checkpoint = 'attempt-validate-closure'
        if ($native.cleanupConfirmed -isnot [bool] -or !$native.cleanupConfirmed -or $native.ownedJobsEmpty -isnot [bool] -or !$native.ownedJobsEmpty -or
            !$Association.service.ObservedOwner['exactProcessExited']) { throw 'installed-native-child-cleanup-unknown' }
        if ($native.ownerSid -cne 'S-1-5-18' -or $native.ownerAuthentication -cne $Association.service.ObservedOwner['authentication'] -or
            $native.ownerSession -ne $Association.service.ObservedOwner['session'] -or $native.ownerBirth -cne ([long]$Association.service.ObservedOwner['birthFileTime']).ToString('x16') -or
            $native.installId -cne $Association.installId -or $native.epoch -cne $Association.stage.epoch -or $native.revision -ne $Association.stage.revision) { throw 'installed-original-owner-binding-refused' }
        # Receipt contract, closure, owner identity and pinned images establish safe
        # owned cleanup independently of the inspection/readiness verdict below.
        if ($native.schemaVersion -ne 1 -or $native.scope -cne 'installed-owner-inspection') { throw 'installed-owner-behavior-or-cleanup-refused' }
        foreach ($image in @(@{ field = 'ownerImageSha256'; name = 'aegis-owner.exe' }, @{ field = 'supervisorImageSha256'; name = 'aegis-session.exe' }, @{ field = 'mainImageSha256'; name = 'aegis-main.exe' })) {
            $pin = @($Association.manifest.files | Where-Object { $_.name -ceq $image.name })[0].sha256
            if ($native.($image.field) -cne $pin) { throw 'installed-original-image-binding-refused' }
        }
        $Association.cleanupUnknown = $false
        $diagnostic.checkpoint = 'attempt-validate-behavior'
        if ($native.schemaVersion -ne 1 -or $native.scope -cne 'installed-owner-inspection' -or $native.inspected -isnot [bool] -or $native.inspected -ne $ExpectedPositive -or
            $native.inspectionCount -ne $count -or $count -ne ([int]$ExpectedPositive) -or $native.cleanupConfirmed -ne $true -or $native.launchAllowed -ne $false -or $native.completeE1 -ne $false) { throw 'installed-owner-behavior-or-cleanup-refused' }
        if ($ExpectedPositive -and ($native.operatorSid -cne $Association.operatorSid -or $native.operatorAuthentication -cnotmatch '^[a-f0-9]{16}$' -or $native.supervisorPid -lt 1 -or $native.mainPid -lt 1)) { throw 'installed-owner-token-refused' }
        foreach ($flag in @('nativeProducerReady', 'bootstrapWriteCompleted', 'bootstrapEofClosed', 'supervisorReleased', 'ownedJobsEmpty')) {
            if ($native.$flag -isnot [bool] -or !$native.$flag) { throw 'installed-original-producer-readiness-refused' }
        }
        if ($native.mainReleased -isnot [bool] -or $native.mainReleased -ne $ExpectedPositive -or $native.supervisorPid -lt 1 -or $native.mainPid -lt 1 -or
            $native.supervisorExitCode -ne $(if ($ExpectedPositive) { 0 } else { 2 })) { throw 'installed-original-program-exit-refused' }
        $diagnostic.checkpoint = 'attempt-report'; $diagnostic.cleanupUnknown = $false; $diagnostic.independentlyObservedOwner = Get-InstalledOwnerAttemptObservation $Association.service.ObservedOwner 'owner'
        return @{ expectedPositive = $ExpectedPositive; native = $native; independentCounter = $count; resultIdentity = $row; counterIdentity = $counter; scm = $states.ToArray();
            serviceConfiguration = $Association.service.Configuration(); serviceSddl = $Association.service.Security(); root = Read-ProtectedInstallSnapshot $Association.stage.root.PathName $true;
            independentlyObservedOwner = $Association.service.ObservedOwner; accountProfile = @{ sid = $Association.operatorSid; usersGroupSid = 'S-1-5-32-545'; usersMembershipConfirmed = $true };
            staticFiles = @($Association.stage.rows); passed = $true }
    } catch {
        $original = $_
        if ($null -eq $diagnostic.failure) { $diagnostic.failure = Get-ProtectedInstallFailure $original $diagnostic.checkpoint }
        $diagnostic.cleanupUnknown = $Association.cleanupUnknown
        $diagnostic.independentlyObservedOwner = Get-InstalledOwnerAttemptObservation $Association.service.ObservedOwner 'owner'
        throw $original
    }
}
function Test-InstalledOwnerMutationActions($Rows) {
    $expected = @('aegis-owner.exe', 'aegis-session.exe', 'aegis-main.exe', 'owner-policy.json', 'enrollment.json', 'inventory.json', 'main-registration.json', 'operator.credential', 'registered-vm.json' | ForEach-Object {
        $leaf = $_; foreach ($operation in @('write', 'delete', 'replace', 'writeDac', 'writeOwner')) { $leaf + ':' + $operation }
    }) + @('ProtectedSession', 'AEGIS', 'Receipts' | ForEach-Object {
        $directory = $_; foreach ($operation in @('rename', 'writeDac', 'writeOwner')) { $directory + ':' + $operation }
    }) + @('credential:read')
    if (@($Rows).Count -ne $expected.Count) { return $false }
    foreach ($action in $expected) {
        $matched = @($Rows | Where-Object { $_.action -is [string] -and $_.action -ceq $action })
        if ($matched.Count -ne 1 -or $matched[0].denied -isnot [bool] -or !$matched[0].denied -or
            ($matched[0].win32Error -isnot [int] -and $matched[0].win32Error -isnot [long]) -or $matched[0].win32Error -ne 5) { return $false }
    }
    return $true
}
function Import-InstalledOwnerMutationLauncher($ActorHeld) {
    # Windows PowerShell Add-Type refuses EXE assemblies. Load the held bytes;
    # bind the launcher to this exact assembly rather than a cached type name.
    $assembly = [Reflection.Assembly]::Load([byte[]]$ActorHeld.Read(4MB))
    return $assembly.GetType('InstalledOwnerMutationLauncher', $true).GetMethod('Run')
}
function Get-InstalledOwnerControlRows([string]$Scratch) {
    $files = @(Get-ChildItem -LiteralPath $Scratch -Force)
    if ($files.Count -gt 5 -or @($files | Where-Object {
        $_.Name -cnotin @('delete-original.txt', 'replace-original.txt', 'actor-result.json', 'write-marker.txt', 'replacement.bin') -or
        $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Length -gt 16KB
    }).Count) { throw 'protected-control-unknown-child' }
    return @($files | ForEach-Object { Read-ProtectedInstallSnapshot $_.FullName $false $false })
}
function Open-InstalledOwnerControlPin($Original) {
    $Original.Recheck()
    $path = $Original.PathName; $volume = $Original.Volume; $id = $Original.FileId; $sddl = $Original.Sddl
    # A DELETE-access directory pin blocks even permitted child replacement.
    # Keep a read-only pin during the actor; the protected parent prevents new
    # actor-controlled names, and exact native identity/descriptor must survive.
    $Original.Dispose(); $held = $null
    try {
        $held = [ProtectedInstallFile]::new($path, $true, $false)
        if ($held.Volume -cne $volume -or $held.FileId -cne $id -or $held.Sddl -cne $sddl) { throw 'protected-control-association-refused' }
        return $held
    } catch { if ($null -ne $held) { $held.Dispose() }; throw }
}
function Invoke-InstalledOwnerActorRead([string]$Actor, [string]$Sid, [string]$ExpectedSha256, [scriptblock]$Action) {
    $source = $null; $originalBytes = $null; $originalSddl = $null
    try {
        $identity = [Security.Principal.SecurityIdentifier]::new($Sid)
        if ($identity.AccountDomainSid -eq $null -or $ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'installed-mutation-actor-source-refused' }
        $source = [IO.File]::Open($Actor, 'Open', 'Read', 'Read')
        if ($source.Length -lt 1 -or $source.Length -gt 4MB) { throw 'installed-mutation-actor-source-refused' }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hash.ComputeHash($source)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($actual -cne $ExpectedSha256) { throw 'installed-mutation-actor-source-refused' }
        $originalAcl = Get-Acl -LiteralPath $Actor
        $originalBytes = $originalAcl.GetSecurityDescriptorBinaryForm(); $originalSddl = $originalAcl.Sddl
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetSecurityDescriptorBinaryForm($originalBytes)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.AccessControlType]::Allow))
        Set-Acl -LiteralPath $Actor -AclObject $acl
        return (& $Action)
    } finally {
        try {
            if ($null -ne $originalBytes) {
                # Get-Acl objects have no pending DACL write. Reconstructing
                # marks the saved descriptor dirty so Set-Acl actually restores it.
                $restore = [Security.AccessControl.FileSecurity]::new()
                $restore.SetSecurityDescriptorBinaryForm($originalBytes)
                Set-Acl -LiteralPath $Actor -AclObject $restore
                # Windows may add DACL_AUTO_INHERITED during Set-Acl. Compare
                # all owners, ACE bytes and remaining control flags exactly.
                $before = [Security.AccessControl.RawSecurityDescriptor]::new($originalSddl)
                $after = [Security.AccessControl.RawSecurityDescriptor]::new((Get-Acl -LiteralPath $Actor).Sddl)
                foreach ($descriptor in @($before, $after)) {
                    $descriptor.SetFlags($descriptor.ControlFlags -band (-bnot [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited))
                }
                if ($before.GetSddlForm([Security.AccessControl.AccessControlSections]::All) -cne $after.GetSddlForm([Security.AccessControl.AccessControlSections]::All)) { throw 'installed-mutation-actor-acl-restore-refused' }
            }
        } finally { if ($null -ne $source) { $source.Dispose() } }
    }
}

function Invoke-InstalledOwnerMutations($Association, [string]$Actor, [string]$Scratch, [string]$ExpectedActorSha256, [bool]$GuestActorRead = $false) {
    Assert-ProtectedInstallation $Association
    if ($GuestActorRead) {
        # The guest transfer root stays private. Only this held diagnostic image
        # receives temporary RX for the exact mutation account, then restores it.
        return Invoke-InstalledOwnerActorRead $Actor $Association.operatorSid $ExpectedActorSha256 {
            Invoke-InstalledOwnerMutations $Association $Actor $Scratch $ExpectedActorSha256 $false
        }
    }
    if ($Association.service.Status()[0] -ne 1) { throw 'installed-mutation-owner-stopped-required' }
    $before = @(@($Association.stage.rows) + @($Association.receiptRows) | ForEach-Object { Read-ProtectedInstallSnapshot $_.path })
    $parent = Read-ProtectedInstallSnapshot $Association.parent.PathName $true; $root = Read-ProtectedInstallSnapshot $Association.stage.root.PathName $true
    $receipts = Read-ProtectedInstallSnapshot $Association.receipts.PathName $true
    foreach ($name in @('delete-original.txt', 'replace-original.txt')) {
        $seed = Join-Path $Scratch $name
        [IO.File]::WriteAllText($seed, 'seeded-original', [Text.UTF8Encoding]::new($false))
        $Association.controlRows += Read-ProtectedInstallSnapshot $seed $false $false
    }
    $originalReplace = [ProtectedInstallFile]::new((Join-Path $Scratch 'replace-original.txt'), $false, $false)
    try { $originalReplaceId = $originalReplace.FileId; $originalReplaceHash = $originalReplace.Hash(1024) } finally { $originalReplace.Dispose() }
    $actorHeld = [ProtectedInstallFile]::new($Actor, $false, $false)
    try {
        $actorHash = $actorHeld.Hash(4MB)
        if ($ExpectedActorSha256 -cnotmatch '^[a-f0-9]{64}$' -or $actorHash -cne $ExpectedActorSha256) { throw 'installed-mutation-actor-source-refused' }
        $launcher = Import-InstalledOwnerMutationLauncher $actorHeld
        try { $observed = $launcher.Invoke($null, @($Actor, $Association.operatorAccount, $Association.password, $Scratch, $Association.operatorSid)) }
        catch {
            $error = $_.Exception
            $cleanupConfirmed = $false
            for ($depth = 0; $depth -lt 8 -and $null -ne $error; $depth++) {
                if ($error.Message -like '*installed-mutation-cleanup-unknown*') { $Association.cleanupUnknown = $true }
                if ($error.Data.Contains('installedMutationCleanupConfirmed') -and
                    $error.Data['installedMutationCleanupConfirmed'] -is [bool] -and $error.Data['installedMutationCleanupConfirmed']) { $cleanupConfirmed = $true }
                $error = $error.InnerException
            }
            if ($cleanupConfirmed -and !$Association.cleanupUnknown) {
                $Association.control.Recheck()
                $Association.controlRows = @(Get-InstalledOwnerControlRows $Scratch)
            }
            throw
        }
        $actorHeld.Recheck()
    } finally { $actorHeld.Dispose() }
    if ($observed.jobEmpty -isnot [bool] -or !$observed.jobEmpty -or $observed.exactProcessExited -isnot [bool] -or !$observed.exactProcessExited) {
        $Association.cleanupUnknown = $true; throw 'installed-mutation-cleanup-unknown'
    }
    $Association.control.Recheck()
    $Association.controlRows = @(Get-InstalledOwnerControlRows $Scratch)
    $Association.mutationDiagnostic = @{ actorExitCode = $observed.exitCode; jobEmpty = $observed.jobEmpty;
        exactProcessExited = $observed.exactProcessExited; initialActiveProcesses = $observed.initialActiveProcesses;
        censusQueries = $observed.censusQueries; resultFilePresent = (Test-Path -LiteralPath (Join-Path $Scratch 'actor-result.json')) }
    $path = Join-Path $Scratch 'actor-result.json'; $file = Get-Item -LiteralPath $path -Force
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 16KB) { throw 'installed-mutation-output-refused' }
    $actual = [IO.File]::ReadAllText($path) | ConvertFrom-Json
    $Association.mutationDiagnostic.actualPassed = if ($actual.passed -is [bool]) { $actual.passed } else { $null }
    $Association.mutationDiagnostic.failedActions = @($actual.attempts | Where-Object { $_.denied -is [bool] -and !$_.denied } | ForEach-Object {
        $label = if ($_.action -is [string] -and $_.action -cmatch '^(?:aegis-(?:owner|session|main)\.exe|owner-policy\.json|enrollment\.json|inventory\.json|main-registration\.json|registered-vm\.json|operator\.credential|ProtectedSession|AEGIS|Receipts|credential):(?:write|delete|replace|writeDac|writeOwner|rename|read)$') { $_.action } else { 'other' }
        @{ action = $label; win32Error = $(if (($_.win32Error -is [int] -or $_.win32Error -is [long]) -and $_.win32Error -ge 0 -and $_.win32Error -le 65535) { $_.win32Error } else { $null }) }
    })
    $Association.mutationDiagnostic.permitted = @{}
    foreach ($field in @('write', 'delete', 'replace', 'writeDac', 'writeOwner')) {
        $Association.mutationDiagnostic.permitted[$field] = if ($actual.permitted.$field -is [bool]) { $actual.permitted.$field } else { $null }
    }
    $Association.mutationDiagnostic.permitted.replaceWin32 = if (($actual.permitted.replaceWin32 -is [int] -or $actual.permitted.replaceWin32 -is [long]) -and $actual.permitted.replaceWin32 -ge 0 -and $actual.permitted.replaceWin32 -le 65535) { $actual.permitted.replaceWin32 } else { $null }
    $permitted = Join-Path $Scratch 'replace-original.txt'
    $permittedHeld = [ProtectedInstallFile]::new($permitted, $false, $false)
    try { $permittedHash = $permittedHeld.Hash(1024); $permittedObserved = $permittedHeld.FileId -cne $originalReplaceId -and [Text.Encoding]::UTF8.GetString($permittedHeld.Read(1024)) -ceq 'allowed-disposable-replacement' }
    finally { $permittedHeld.Dispose() }
    $writeHeld = [ProtectedInstallFile]::new((Join-Path $Scratch 'write-marker.txt'), $false, $false)
    try { $writeHash = $writeHeld.Hash(1024); $writeObserved = [Text.Encoding]::UTF8.GetString($writeHeld.Read(1024)) -ceq 'allowed-disposable-write' } finally { $writeHeld.Dispose() }
    $deleteObserved = !(Test-Path -LiteralPath (Join-Path $Scratch 'delete-original.txt'))
    $unchanged = $true
    $after = @()
    foreach ($row in @($before) + @($root, $parent, $receipts)) {
        try { Assert-ProtectedInstallSnapshot $row; $after += Read-ProtectedInstallSnapshot $row.path ([bool]$row.directory) } catch { $unchanged = $false }
    }
    if ($observed.exitCode -ne 0 -or !$observed.jobEmpty -or !$observed.exactProcessExited -or !$unchanged -or !$actual.passed -or
        $actual.operatorSid -isnot [string] -or $observed.operatorSid -isnot [string] -or $actual.operatorSid -cne $Association.operatorSid -or $observed.operatorSid -cne $Association.operatorSid -or
        !(Test-InstalledOwnerMutationActions $actual.attempts) -or
        $actual.permitted.writeDac -isnot [bool] -or !$actual.permitted.writeDac -or $actual.permitted.writeOwner -isnot [bool] -or !$actual.permitted.writeOwner -or
        !$actual.permitted.write -or !$actual.permitted.delete -or !$actual.permitted.replace -or !$actual.policyReadable -or !$permittedObserved -or !$writeObserved -or !$deleteObserved) { throw 'installed-mutation-effect-refused' }
    return @{ actorSha256 = $actorHash; independentTokenAndJob = $observed; actual = $actual; independentlyObservedPermittedReplacement = $permittedObserved; permittedReplacementSha256 = $permittedHash;
        independentlyObservedPermittedWrite = $writeObserved; permittedWriteSha256 = $writeHash; independentlyObservedPermittedDelete = $deleteObserved; seededReplaceFileId = $originalReplaceId; seededReplaceSha256 = $originalReplaceHash;
        scope = 'standard-account-installed-acl-access-controls'; brokerReleaseRequired = $false; completeE14 = $false;
        securityRightsOperation = 'CreateFile-requested-access'; protectedFilesAndAncestorsUnchanged = $unchanged; before = @($before) + @($root, $parent, $receipts); after = $after; passed = $true }
}

function Invoke-InstalledOwnerQualification([string]$PayloadRoot, [string]$ScratchRoot, [string]$ExpectedSourceSha, [ValidateSet('fresh-host', 'windows11-guest')][string]$Location, [string]$RegisteredVmId = '') {
    $report = [ordered]@{ schemaVersion = 1; scope = 'protected-installed-owner-qualification'; location = $Location; sourceSha = $ExpectedSourceSha;
        os = $null; inputHashes = $null; baseline = $null; positive = $null; mutation = $null; mutationFailure = $null; mutationAttempt = $null; rollback = $null; upgrade = $null; partial = $null; uninstall = $null;
        installation = $null; failedAttempt = $null; failure = $null; cleanupFailure = $null; passed = $false; launchAllowed = $false; completeE1 = $false; completeE11 = $false; interactiveUiQualified = $false }
    $association = $null; $stage = 'preflight'; $scratch = $null; $scratchParent = $null; $password = $null
    $installJournal = @{}
    try {
        Assert-ProtectedInstallAdministrator; Initialize-ProtectedInstallNative
        if ($RegisteredVmId -cne '' -and ($Location -cne 'fresh-host' -or $RegisteredVmId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or $RegisteredVmId -ceq [guid]::Empty.ToString('D'))) { throw 'installed-fresh-host-scope-refused' }
        if ($Location -ceq 'fresh-host') {
            $suffix = if ($RegisteredVmId -ceq '') { '\installed-owner-control' } else { '\installed-owner-registered-vm-control' }
            if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $ScratchRoot -cne ('D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + $suffix)) { throw 'installed-fresh-host-scope-refused' }
        } elseif ($ScratchRoot -cne 'C:\AegisLab\installed-owner') { throw 'installed-fresh-guest-scope-refused' }
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
        $report.os = @{ caption = $os.Caption; build = $os.BuildNumber; version = $os.Version; architecture = $os.OSArchitecture }
        if ($Location -ceq 'windows11-guest' -and ($os.Caption -notlike '*Windows 11*' -or [int]$os.BuildNumber -lt 22000)) { throw 'installed-windows11-os-required' }
        $payload = Test-InstalledOwnerPayload $PayloadRoot $ExpectedSourceSha; $report.inputHashes = $payload.files
        if (Test-Path -LiteralPath $ScratchRoot) { throw 'installed-fresh-scratch-required' }
        $scratchParent = [ProtectedInstallFile]::new([IO.Path]::GetDirectoryName($ScratchRoot), $true, $false)
        New-Item -ItemType Directory -Path $ScratchRoot | Out-Null
        $account = 'AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12)
        $password = 'Ae!9-' + [guid]::NewGuid().ToString('N')
        $baselineManifest = Get-InstalledOwnerBinaryManifest $payload $true; $manifest = Get-InstalledOwnerBinaryManifest $payload $false
        $baselineSources = Join-Path $ScratchRoot 'baseline-inputs'; New-Item -ItemType Directory -Path $baselineSources | Out-Null
        foreach ($name in @('aegis-owner.exe', 'aegis-main.exe')) { Copy-Item -LiteralPath (Join-Path $PayloadRoot ('binaries/' + $name)) -Destination (Join-Path $baselineSources $name) }
        Copy-Item -LiteralPath (Join-Path $PayloadRoot 'baseline/aegis-session.exe') -Destination (Join-Path $baselineSources 'aegis-session.exe')
        $stage = 'baseline-install'; $association = New-ProtectedInstallation $baselineSources $baselineManifest $account $password $false $installJournal $RegisteredVmId
        if ($RegisteredVmId -cne '') { $report['registeredVm'] = @{ vmId = $association.vmBinding.vmId; identitySha256 = $association.vmBinding.identitySha256; storageSha256 = $association.vmBinding.storageSha256; storageProtection = $association.vmBinding.storageProtection; inspectionOnly = $true } }
        $stage = 'original-program-behavioral-red'; $report.baseline = Invoke-InstalledOwnerAttempt $association $false
        $stage = 'upgrade-to-maintained-native-owner'; Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest | Out-Null
        $stage = 'actual-installed-positive'
        # A refused positive attempt goes directly to exact owned cleanup.
        $report.positive = Invoke-InstalledOwnerAttempt $association $true
        $stage = 'ordinary-token-mutation';
        # Same-volume replacement makes ERROR_ACCESS_DENIED a real ACL result.
        $scratch = Join-Path $script:ProtectedInstallParent 'MutationControl'
        $scratchAcl = New-ProtectedInstallAcl $true $association.operatorSid
        # FullControl is confined to this exact disposable child, never inherited
        # by the protected installation or receipts. It matches WRITE_DAC/OWNER.
        $scratchAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($association.operatorSid), [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
        $association.control = [ProtectedInstallFile]::CreateDirectory($scratch, $scratchAcl.GetSecurityDescriptorBinaryForm())
        $association.control = Open-InstalledOwnerControlPin $association.control
        $association.controlReadOnly = $true
        $actorPin = @($payload.files | Where-Object { $_.path -ceq 'native/installed-owner-actor.exe' })[0].sha256
        try { $report.mutation = Invoke-InstalledOwnerMutations $association (Join-Path $PayloadRoot 'native/installed-owner-actor.exe') $scratch $actorPin ($Location -ceq 'windows11-guest') }
        catch {
            $report.mutationFailure = Get-ProtectedInstallFailure $_ 'installed-acl-controls'
            if ($association.ContainsKey('mutationDiagnostic')) { $report.mutationAttempt = $association.mutationDiagnostic }
            throw
        }
        $stage = 'actual-upgrade-rollback'; $before = Read-ProtectedInstallSnapshot $association.stage.root.PathName $true; $oldRows = @($association.stage.rows); $fault = $false
        try { Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest $true | Out-Null } catch { if ($_.Exception.Message -notlike '*protected-qualified-upgrade-fault*') { throw }; $fault = $true }
        Assert-ProtectedInstallSnapshot $before; foreach ($row in $oldRows) { Assert-ProtectedInstallSnapshot $row }
        $report.rollback = @{ injectedAfterPublication = $fault; originalRootAndFilesRestored = $true; root = $before; serviceConfiguration = $association.service.Configuration(); passed = $fault }
        $stage = 'actual-successful-upgrade'; Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest | Out-Null
        $report.upgrade = Invoke-InstalledOwnerAttempt $association $true
    } catch {
        $report.failure = Get-ProtectedInstallFailure $_ 'qualification'; $report.failure.stage = $stage
        if ($null -ne $association -and $association.ContainsKey('attemptDiagnostic') -and $null -ne $association.attemptDiagnostic.failure) {
            $report.failedAttempt = $association.attemptDiagnostic.Clone(); $report.failure = $association.attemptDiagnostic.failure.Clone(); $report.failure.stage = $stage
        }
        if ($installJournal.ContainsKey('failure') -and $null -ne $installJournal.failure -and $stage -ceq 'baseline-install') {
            $report.failure = $installJournal.failure.Clone(); $report.failure.stage = $stage
        }
    }
    finally {
        if ($null -ne $association) {
            try {
                # Capture fixed native receipts even after a refused attempt, before
                # exact owned cleanup. Unknown children remain terminal/refused.
                foreach ($file in @(Get-ChildItem -LiteralPath $association.receipts.PathName -Force)) {
                    if ($file.FullName -cnotin $association.attemptedReceiptPaths) { throw 'installed-cleanup-receipt-refused' }
                    $existing = @($association.receiptRows | Where-Object { $_.path -ceq $file.FullName })
                    if ($existing.Count -eq 0) { $association.receiptRows += Read-ProtectedInstallSnapshot $file.FullName }
                    else { foreach ($row in $existing) { Assert-ProtectedInstallSnapshot $row } }
                }
                $sid = $association.operatorSid; Remove-ProtectedInstallation $association
                $report.uninstall = @{ serviceAbsent = [ProtectedInstallService]::Absent(); protectedParentAbsent = !(Test-Path -LiteralPath $script:ProtectedInstallParent); exactAccountSidAbsent = @((Get-LocalUser) | Where-Object { $_.SID.Value -ceq $sid }).Count -eq 0; passed = $false }
                if (!$report.uninstall.serviceAbsent -or !$report.uninstall.protectedParentAbsent -or !$report.uninstall.exactAccountSidAbsent) { throw 'protected-uninstall-absence-unconfirmed' }
                $report.uninstall.passed = $true
                $installJournal.cleanup = @{ state = 'confirmed'; serviceAbsent = $true; protectedParentAbsent = $true; exactAccountSidAbsent = $true; failure = $null }
                $association = $null
            } catch {
                $report.cleanupFailure = Get-ProtectedInstallFailure $_ 'qualification'; $report.cleanupFailure.stage = 'exact-owned-uninstall'
                $installJournal.cleanup = @{ state = 'unknown'; serviceAbsent = $null; protectedParentAbsent = $null; exactAccountSidAbsent = $null; failure = $report.cleanupFailure }
            }
        }
        # Failed New-ProtectedInstallation can retain exact owned associations in
        # its journal even though no successful return assigned $association.
        if ($installJournal.ContainsKey('cleanup')) {
            $report.installation = Get-ProtectedInstallJournalReceipt $installJournal
            if ($installJournal.cleanup.state -ceq 'unknown' -and $null -eq $report.cleanupFailure) {
                $report.cleanupFailure = @{ stage = 'partial-install-cleanup'; operation = $installJournal.operation; diagnosticCode = 'protected-installation-cleanup-unknown'; nativeWin32 = $null; hResult = $null }
                if ($null -ne $installJournal.cleanup.failure) { $report.cleanupFailure = $installJournal.cleanup.failure.Clone(); $report.cleanupFailure.stage = 'partial-install-cleanup' }
            }
        }
        $password = $null; if ($null -ne $scratchParent) { $scratchParent.Dispose() }
    }
    if ($null -eq $report.failure -and $null -eq $report.cleanupFailure) {
        $journal = @{}; $partialAccount = 'AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12); $fault = $false
        try { New-ProtectedInstallation (Join-Path $PayloadRoot 'binaries') $manifest $partialAccount ('Ae!9-' + [guid]::NewGuid().ToString('N')) $true $journal $RegisteredVmId | Out-Null }
        catch { $fault = $_.Exception.Message -like '*protected-qualified-partial-fault*' }
        $report.partial = @{ injectedAfterPublication = $fault; journal = Get-ProtectedInstallJournalReceipt $journal; serviceAbsent = [ProtectedInstallService]::Absent(); protectedParentAbsent = !(Test-Path -LiteralPath $script:ProtectedInstallParent);
            accountAbsent = @((Get-LocalUser) | Where-Object { $_.Name -ceq $partialAccount }).Count -eq 0 }
        $report.partial.passed = $fault -and $journal.cleanup.state -ceq 'confirmed' -and $report.partial.serviceAbsent -and $report.partial.protectedParentAbsent -and $report.partial.accountAbsent
        if ($journal.cleanup.state -ceq 'unknown') { $report.cleanupFailure = @{ stage = 'qualified-partial-cleanup'; operation = $journal.operation; diagnosticCode = 'protected-installation-cleanup-unknown'; nativeWin32 = $null; hResult = $null } }
    }
    $report.passed = $null -eq $report.failure -and $null -eq $report.cleanupFailure -and $null -ne $report.partial -and $report.partial.passed
    $pretty = $report | ConvertTo-Json -Depth 20
    $json = $report | ConvertTo-Json -Depth 20 -Compress
    Write-Host ('installed-owner-receipt-bytes pretty=' + [Text.Encoding]::UTF8.GetByteCount($pretty) + ' compact=' + [Text.Encoding]::UTF8.GetByteCount($json))
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 64KB) { throw 'installed-owner-subreceipt-budget-refused' }
    return $report
}

# Pure receipt predicate used by both host and guest transport. It grants no
# runtime/install authority and never touches services, accounts, files or VMs.
function Test-InstalledOwnerQualificationReceipt($Value, [string]$ExpectedSourceSha, [string]$Location) {
    try {
        $typed = @(
            @{ value = $Value; fields = @('passed', 'launchAllowed', 'completeE1', 'completeE11', 'interactiveUiQualified') },
            @{ value = $Value.mutation; fields = @('passed', 'protectedFilesAndAncestorsUnchanged', 'independentlyObservedPermittedReplacement', 'independentlyObservedPermittedWrite', 'independentlyObservedPermittedDelete') },
            @{ value = $Value.mutation.independentTokenAndJob; fields = @('elevated', 'enabledAdministrator', 'adminCapable', 'powerfulPrivilegesAssigned', 'strictStandardProfile', 'jobEmpty', 'exactProcessExited') },
            @{ value = $Value.mutation.actual; fields = @('passed', 'administrator', 'policyReadable') },
            @{ value = $Value.mutation.actual.permitted; fields = @('write', 'delete', 'replace', 'writeDac', 'writeOwner') },
            @{ value = $Value.rollback; fields = @('passed', 'injectedAfterPublication', 'originalRootAndFilesRestored') },
            @{ value = $Value.partial; fields = @('passed', 'injectedAfterPublication', 'serviceAbsent', 'protectedParentAbsent', 'accountAbsent') },
            @{ value = $Value.uninstall; fields = @('passed', 'serviceAbsent', 'protectedParentAbsent', 'exactAccountSidAbsent') })
        foreach ($group in $typed) { foreach ($field in $group.fields) { if ($group.value.$field -isnot [bool]) { return $false } } }
        $leafNames = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe', 'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
            'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs', 'scripts/installation/ProtectedInstallDisk.cs', 'scripts/installation/protected-install-files.ps1', 'scripts/installation/protected-install-transaction.ps1',
            'scripts/installation/protected-vm-provider.ps1', 'scripts/installation/protected-vm.ps1',
        'scripts/installation/protected-installation.ps1', 'scripts/qualification/installed-owner-phase.ps1', 'scripts/qualification/installed-owner-guest-bootstrap.ps1')
        if ($ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or @($Value.inputHashes).Count -ne $leafNames.Count) { return $false }
        $pins = @{}
        foreach ($leaf in $leafNames) {
            $rows = @($Value.inputHashes | Where-Object { $_.path -ceq $leaf })
            if ($rows.Count -ne 1 -or $rows[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or ($rows[0].bytes -isnot [int] -and $rows[0].bytes -isnot [long]) -or $rows[0].bytes -lt 1 -or $rows[0].bytes -gt 4MB) { return $false }
            $pins[$leaf] = $rows[0].sha256
        }
        foreach ($attempt in @($Value.baseline, $Value.positive, $Value.upgrade)) {
            if ($attempt.accountProfile.usersMembershipConfirmed -isnot [bool] -or !$attempt.accountProfile.usersMembershipConfirmed -or
                $attempt.accountProfile.usersGroupSid -cne 'S-1-5-32-545' -or $attempt.accountProfile.sid -cne $attempt.native.operatorSid) { return $false }
            foreach ($flag in @('passed', 'expectedPositive')) { if ($attempt.$flag -isnot [bool]) { return $false } }
            if (!$attempt.passed) { return $false }
            foreach ($flag in @('inspected', 'cleanupConfirmed', 'launchAllowed', 'completeE1', 'nativeProducerReady', 'bootstrapWriteCompleted', 'bootstrapEofClosed', 'supervisorReleased', 'mainReleased', 'ownedJobsEmpty')) { if ($attempt.native.$flag -isnot [bool]) { return $false } }
            foreach ($flag in @('cleanupConfirmed', 'nativeProducerReady', 'bootstrapWriteCompleted', 'bootstrapEofClosed', 'supervisorReleased', 'ownedJobsEmpty')) { if (!$attempt.native.$flag) { return $false } }
            if ($attempt.native.launchAllowed -or $attempt.native.completeE1 -or $attempt.native.supervisorPid -lt 1 -or $attempt.native.mainPid -lt 1 -or $attempt.native.ownerSid -cne 'S-1-5-18' -or
                $attempt.independentlyObservedOwner.sid -cne 'S-1-5-18' -or $attempt.independentlyObservedOwner.exactProcessExited -isnot [bool] -or !$attempt.independentlyObservedOwner.exactProcessExited -or
                $attempt.native.ownerImageSha256 -cne $pins['binaries/aegis-owner.exe'] -or $attempt.native.mainImageSha256 -cne $pins['binaries/aegis-main.exe']) { return $false }
            $supervisorPath = if ($attempt.expectedPositive) { 'binaries/aegis-session.exe' } else { 'baseline/aegis-session.exe' }
            if ($attempt.native.supervisorImageSha256 -cne $pins[$supervisorPath]) { return $false }
        }
        if ($Value.baseline.native.supervisorExitCode -ne 2 -or $Value.baseline.native.mainReleased -ne $false) { return $false }
        foreach ($attempt in @($Value.positive, $Value.upgrade)) { if ($attempt.native.supervisorExitCode -ne 0 -or $attempt.native.mainReleased -ne $true) { return $false } }
        if ($Value.schemaVersion -ne 1 -or $Value.scope -cne 'protected-installed-owner-qualification' -or $Value.location -cne $Location -or $Value.sourceSha -cne $ExpectedSourceSha -or
            $Value.passed -ne $true -or $null -ne $Value.failure -or $null -ne $Value.cleanupFailure -or $Value.launchAllowed -ne $false -or $Value.completeE1 -ne $false -or $Value.completeE11 -ne $false -or $Value.interactiveUiQualified -ne $false) { return $false }
        if ($Value.baseline.expectedPositive -ne $false -or $Value.baseline.independentCounter -ne 0 -or $Value.baseline.native.inspected -ne $false -or $Value.baseline.native.cleanupConfirmed -ne $true) { return $false }
        foreach ($positive in @($Value.positive, $Value.upgrade)) {
            if ($positive.passed -ne $true -or $positive.expectedPositive -ne $true -or $positive.independentCounter -ne 1 -or $positive.native.inspected -ne $true -or $positive.native.cleanupConfirmed -ne $true -or
                $positive.independentlyObservedOwner.sid -cne 'S-1-5-18' -or $positive.independentlyObservedOwner.exactProcessExited -ne $true -or $positive.native.operatorAuthentication -cnotmatch '^[a-f0-9]{16}$') { return $false }
        }
        $installationSid = $Value.baseline.accountProfile.sid
        if ($installationSid -isnot [string] -or $installationSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
            $Value.positive.accountProfile.sid -isnot [string] -or $Value.upgrade.accountProfile.sid -isnot [string] -or
            $Value.mutation.actual.operatorSid -isnot [string] -or $Value.mutation.independentTokenAndJob.operatorSid -isnot [string] -or
            $Value.positive.accountProfile.sid -cne $installationSid -or $Value.upgrade.accountProfile.sid -cne $installationSid -or
            $Value.mutation.actual.operatorSid -cne $installationSid -or $Value.mutation.independentTokenAndJob.operatorSid -cne $installationSid) { return $false }
        if ($Value.mutation.actorSha256 -cne $pins['native/installed-owner-actor.exe'] -or !$Value.mutation.actual.passed -or $Value.mutation.actual.administrator -or !$Value.mutation.actual.policyReadable -or
            !$Value.mutation.actual.permitted.write -or !$Value.mutation.actual.permitted.delete -or !$Value.mutation.actual.permitted.replace -or !$Value.mutation.actual.permitted.writeDac -or !$Value.mutation.actual.permitted.writeOwner -or
            $Value.mutation.passed -ne $true -or $Value.mutation.protectedFilesAndAncestorsUnchanged -ne $true -or $Value.mutation.independentlyObservedPermittedReplacement -ne $true -or
            $Value.mutation.independentlyObservedPermittedWrite -ne $true -or $Value.mutation.independentlyObservedPermittedDelete -ne $true -or
            $Value.mutation.independentTokenAndJob.elevated -ne $false -or $Value.mutation.independentTokenAndJob.enabledAdministrator -ne $false -or $Value.mutation.independentTokenAndJob.integritySid -cne 'S-1-16-8192' -or
            $Value.mutation.independentTokenAndJob.adminCapable -ne $false -or $Value.mutation.independentTokenAndJob.powerfulPrivilegesAssigned -ne $false -or $Value.mutation.independentTokenAndJob.strictStandardProfile -ne $true -or
            $Value.mutation.independentTokenAndJob.jobEmpty -ne $true -or $Value.mutation.independentTokenAndJob.exactProcessExited -ne $true -or !(Test-InstalledOwnerMutationActions $Value.mutation.actual.attempts)) { return $false }
        if ($Value.rollback.passed -ne $true -or $Value.rollback.originalRootAndFilesRestored -ne $true -or $Value.partial.passed -ne $true -or
            $Value.partial.serviceAbsent -ne $true -or $Value.partial.protectedParentAbsent -ne $true -or $Value.partial.accountAbsent -ne $true -or
            $Value.uninstall.passed -ne $true -or $Value.uninstall.serviceAbsent -ne $true -or $Value.uninstall.protectedParentAbsent -ne $true -or $Value.uninstall.exactAccountSidAbsent -ne $true) { return $false }
        return $true
    } catch { return $false }
}
