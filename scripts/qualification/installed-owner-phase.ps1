Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../installation/protected-installation.ps1')

function Test-InstalledOwnerPayload([string]$PayloadRoot, [string]$ExpectedSourceSha) {
    $names = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe', 'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
        'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs', 'scripts/installation/protected-install-files.ps1',
        'scripts/installation/protected-install-transaction.ps1', 'scripts/installation/protected-installation.ps1', 'scripts/qualification/installed-owner-phase.ps1', 'scripts/qualification/installed-owner-guest-bootstrap.ps1')
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
function Invoke-InstalledOwnerAttempt($Association, [bool]$ExpectedPositive) {
    Assert-ProtectedInstallation $Association
    $paths = Get-InstalledOwnerReceiptPaths $Association
    if ((Test-Path -LiteralPath $paths.result) -or (Test-Path -LiteralPath $paths.count)) { throw 'installed-fresh-attempt-receipts-required' }
    $Association.attemptedReceiptPaths += @($paths.result, $paths.count)
    # Owner exit alone does not prove original children/Jobs closed. Only a fresh
    # authenticated maintained-owner closure result may clear this terminal latch.
    $Association.cleanupUnknown = $true
    $started = [DateTime]::UtcNow; $Association.service.Start()
    $watch = [Diagnostics.Stopwatch]::StartNew(); $states = [Collections.Generic.List[object]]::new()
    do {
        $status = $Association.service.Status()
        if ($states.Count -eq 0 -or $states[$states.Count - 1].state -ne $status[0]) { $states.Add(@{ state = $status[0]; pid = $status[1]; milliseconds = $watch.ElapsedMilliseconds }) }
        if ($status[0] -eq 1) { break }
        if ($watch.ElapsedMilliseconds -ge 20000) { throw 'installed-owner-attempt-deadline' }
        Start-Sleep -Milliseconds 50
    } while ($true)
    $Association.service.WaitExited()
    $resultFile = Get-Item -LiteralPath $paths.result -Force
    if ($resultFile.CreationTimeUtc -lt $started.AddSeconds(-1) -or $resultFile.Length -gt 32KB) { throw 'installed-owner-fresh-result-refused' }
    $row = Read-ProtectedInstallSnapshot $paths.result; $Association.receiptRows += $row
    $native = [IO.File]::ReadAllText($paths.result) | ConvertFrom-Json
    $count = 0; $counter = $null
    if (Test-Path -LiteralPath $paths.count) {
        $counterFile = Get-Item -LiteralPath $paths.count -Force
        if ($counterFile.CreationTimeUtc -lt $started.AddSeconds(-1) -or $counterFile.Length -ne 1 -or [IO.File]::ReadAllText($paths.count) -cne '1') { throw 'installed-owner-independent-counter-refused' }
        $counter = Read-ProtectedInstallSnapshot $paths.count; $Association.receiptRows += $counter; $count = 1
    }
    Update-ProtectedInstallRuntimeRows $Association.stage
    if ($native.cleanupConfirmed -isnot [bool] -or !$native.cleanupConfirmed -or $native.ownedJobsEmpty -isnot [bool] -or !$native.ownedJobsEmpty -or
        !$Association.service.ObservedOwner['exactProcessExited']) { throw 'installed-native-child-cleanup-unknown' }
    if ($native.ownerSid -cne 'S-1-5-18' -or $native.ownerAuthentication -cne $Association.service.ObservedOwner['authentication'] -or
        $native.ownerSession -ne $Association.service.ObservedOwner['session'] -or $native.ownerBirth -cne ([long]$Association.service.ObservedOwner['birthFileTime']).ToString('x16') -or
        $native.installId -cne $Association.installId -or $native.epoch -cne $Association.stage.epoch -or $native.revision -ne $Association.stage.revision) { throw 'installed-original-owner-binding-refused' }
    if ($native.schemaVersion -ne 1 -or $native.scope -cne 'installed-owner-inspection' -or $native.inspected -isnot [bool] -or $native.inspected -ne $ExpectedPositive -or
        $native.inspectionCount -ne $count -or $count -ne ([int]$ExpectedPositive) -or $native.cleanupConfirmed -ne $true -or $native.launchAllowed -ne $false -or $native.completeE1 -ne $false) { throw 'installed-owner-behavior-or-cleanup-refused' }
    if ($ExpectedPositive -and ($native.operatorSid -cne $Association.operatorSid -or $native.operatorAuthentication -cnotmatch '^[a-f0-9]{16}$' -or $native.supervisorPid -lt 1 -or $native.mainPid -lt 1)) { throw 'installed-owner-token-refused' }
    foreach ($flag in @('nativeProducerReady', 'bootstrapWriteCompleted', 'bootstrapEofClosed', 'supervisorReleased', 'ownedJobsEmpty')) {
        if ($native.$flag -isnot [bool] -or !$native.$flag) { throw 'installed-original-producer-readiness-refused' }
    }
    if ($native.mainReleased -isnot [bool] -or $native.mainReleased -ne $ExpectedPositive -or $native.supervisorPid -lt 1 -or $native.mainPid -lt 1 -or
        $native.supervisorExitCode -ne $(if ($ExpectedPositive) { 0 } else { 2 })) { throw 'installed-original-program-exit-refused' }
    foreach ($image in @(@{ field = 'ownerImageSha256'; name = 'aegis-owner.exe' }, @{ field = 'supervisorImageSha256'; name = 'aegis-session.exe' }, @{ field = 'mainImageSha256'; name = 'aegis-main.exe' })) {
        $pin = @($Association.manifest.files | Where-Object { $_.name -ceq $image.name })[0].sha256
        if ($native.($image.field) -cne $pin) { throw 'installed-original-image-binding-refused' }
    }
    $Association.cleanupUnknown = $false
    return @{ expectedPositive = $ExpectedPositive; native = $native; independentCounter = $count; resultIdentity = $row; counterIdentity = $counter; scm = $states.ToArray();
        serviceConfiguration = $Association.service.Configuration(); serviceSddl = $Association.service.Security(); root = Read-ProtectedInstallSnapshot $Association.stage.root.PathName $true;
        independentlyObservedOwner = $Association.service.ObservedOwner; accountProfile = @{ sid = $Association.operatorSid; usersGroupSid = 'S-1-5-32-545'; usersMembershipConfirmed = $true };
        staticFiles = @($Association.stage.rows); passed = $true }
}
function Invoke-InstalledOwnerMutations($Association, [string]$Actor, [string]$Scratch, [string]$ExpectedActorSha256) {
    if ($Association.service.Status()[0] -ne 1) { throw 'installed-mutation-owner-stopped-required' }
    Assert-ProtectedInstallation $Association
    $before = @($Association.stage.rows | ForEach-Object { Read-ProtectedInstallSnapshot $_.path })
    $parent = Read-ProtectedInstallSnapshot $Association.parent.PathName $true; $root = Read-ProtectedInstallSnapshot $Association.stage.root.PathName $true
    foreach ($name in @('delete-original.txt', 'replace-original.txt')) { [IO.File]::WriteAllText((Join-Path $Scratch $name), 'seeded-original', [Text.UTF8Encoding]::new($false)) }
    $originalReplace = [ProtectedInstallFile]::new((Join-Path $Scratch 'replace-original.txt'), $false, $false)
    try { $originalReplaceId = $originalReplace.FileId; $originalReplaceHash = $originalReplace.Hash(1024) } finally { $originalReplace.Dispose() }
    $actorHeld = [ProtectedInstallFile]::new($Actor, $false, $false)
    try {
        $actorHash = $actorHeld.Hash(4MB)
        if ($ExpectedActorSha256 -cnotmatch '^[a-f0-9]{64}$' -or $actorHash -cne $ExpectedActorSha256) { throw 'installed-mutation-actor-source-refused' }
        Add-Type -Path $Actor
        try { $observed = [InstalledOwnerMutationLauncher]::Run($Actor, $Association.operatorAccount, $Association.password, $Scratch, $Association.operatorSid) }
        catch {
            $error = $_.Exception
            for ($depth = 0; $depth -lt 8 -and $null -ne $error; $depth++) {
                if ($error.Message -like '*installed-mutation-cleanup-unknown*') { $Association.cleanupUnknown = $true }
                $error = $error.InnerException
            }
            throw
        }
        $actorHeld.Recheck()
    } finally { $actorHeld.Dispose() }
    $path = Join-Path $Scratch 'actor-result.json'; $file = Get-Item -LiteralPath $path -Force
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 16KB) { throw 'installed-mutation-output-refused' }
    $actual = [IO.File]::ReadAllText($path) | ConvertFrom-Json
    $permitted = Join-Path $Scratch 'replace-original.txt'
    $permittedHeld = [ProtectedInstallFile]::new($permitted, $false, $false)
    try { $permittedHash = $permittedHeld.Hash(1024); $permittedObserved = $permittedHeld.FileId -cne $originalReplaceId -and [Text.Encoding]::UTF8.GetString($permittedHeld.Read(1024)) -ceq 'allowed-disposable-replacement' }
    finally { $permittedHeld.Dispose() }
    $writeHeld = [ProtectedInstallFile]::new((Join-Path $Scratch 'write-marker.txt'), $false, $false)
    try { $writeHash = $writeHeld.Hash(1024); $writeObserved = [Text.Encoding]::UTF8.GetString($writeHeld.Read(1024)) -ceq 'allowed-disposable-write' } finally { $writeHeld.Dispose() }
    $deleteObserved = !(Test-Path -LiteralPath (Join-Path $Scratch 'delete-original.txt'))
    $Association.controlRows = @('actor-result.json', 'write-marker.txt', 'replace-original.txt' | ForEach-Object { Read-ProtectedInstallSnapshot (Join-Path $Scratch $_) $false $false })
    $unchanged = $true
    foreach ($row in @($before) + @($root, $parent)) { try { Assert-ProtectedInstallSnapshot $row } catch { $unchanged = $false } }
    if ($observed.exitCode -ne 0 -or !$observed.jobEmpty -or !$observed.exactProcessExited -or !$unchanged -or !$actual.passed -or $actual.operatorSid -cne $Association.operatorSid -or
        @($actual.attempts).Count -ne 28 -or @($actual.attempts | Where-Object { $_.win32Error -ne 5 -or $_.denied -ne $true }).Count -ne 0 -or
        !$actual.permitted.write -or !$actual.permitted.delete -or !$actual.permitted.replace -or !$actual.policyReadable -or !$permittedObserved -or !$writeObserved -or !$deleteObserved) { throw 'installed-mutation-effect-refused' }
    return @{ actorSha256 = $actorHash; independentTokenAndJob = $observed; actual = $actual; independentlyObservedPermittedReplacement = $permittedObserved; permittedReplacementSha256 = $permittedHash;
        independentlyObservedPermittedWrite = $writeObserved; permittedWriteSha256 = $writeHash; independentlyObservedPermittedDelete = $deleteObserved; seededReplaceFileId = $originalReplaceId; seededReplaceSha256 = $originalReplaceHash;
        protectedFilesAndAncestorsUnchanged = $unchanged; before = $before; passed = $true }
}

function Invoke-InstalledOwnerQualification([string]$PayloadRoot, [string]$ScratchRoot, [string]$ExpectedSourceSha, [ValidateSet('fresh-host', 'windows11-guest')][string]$Location) {
    $report = [ordered]@{ schemaVersion = 1; scope = 'protected-installed-owner-qualification'; location = $Location; sourceSha = $ExpectedSourceSha;
        os = $null; inputHashes = $null; baseline = $null; positive = $null; mutation = $null; rollback = $null; upgrade = $null; partial = $null; uninstall = $null;
        failure = $null; cleanupFailure = $null; passed = $false; launchAllowed = $false; completeE1 = $false; completeE11 = $false; interactiveUiQualified = $false }
    $association = $null; $stage = 'preflight'; $scratch = $null; $scratchParent = $null; $password = $null
    try {
        Assert-ProtectedInstallAdministrator; Initialize-ProtectedInstallNative
        if ($Location -ceq 'fresh-host') {
            if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $ScratchRoot -cne ('D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '\installed-owner-control')) { throw 'installed-fresh-host-scope-refused' }
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
        $stage = 'baseline-install'; $association = New-ProtectedInstallation $baselineSources $baselineManifest $account $password
        $stage = 'original-program-behavioral-red'; $report.baseline = Invoke-InstalledOwnerAttempt $association $false
        $stage = 'upgrade-to-maintained-native-owner'; Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest | Out-Null
        $stage = 'actual-installed-positive'; $report.positive = Invoke-InstalledOwnerAttempt $association $true
        $stage = 'ordinary-token-mutation';
        # Same-volume replacement makes ERROR_ACCESS_DENIED a real ACL result.
        $scratch = Join-Path $script:ProtectedInstallParent 'MutationControl'
        $scratchAcl = New-ProtectedInstallAcl $true $association.operatorSid
        $scratchAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($association.operatorSid), [Security.AccessControl.FileSystemRights]::Modify, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
        $association.control = [ProtectedInstallFile]::CreateDirectory($scratch, $scratchAcl.GetSecurityDescriptorBinaryForm())
        $actorPin = @($payload.files | Where-Object { $_.path -ceq 'native/installed-owner-actor.exe' })[0].sha256
        $report.mutation = Invoke-InstalledOwnerMutations $association (Join-Path $PayloadRoot 'native/installed-owner-actor.exe') $scratch $actorPin
        $stage = 'actual-upgrade-rollback'; $before = Read-ProtectedInstallSnapshot $association.stage.root.PathName $true; $oldRows = @($association.stage.rows); $fault = $false
        try { Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest $true | Out-Null } catch { if ($_.Exception.Message -notlike '*protected-qualified-upgrade-fault*') { throw }; $fault = $true }
        Assert-ProtectedInstallSnapshot $before; foreach ($row in $oldRows) { Assert-ProtectedInstallSnapshot $row }
        $report.rollback = @{ injectedAfterPublication = $fault; originalRootAndFilesRestored = $true; root = $before; serviceConfiguration = $association.service.Configuration(); passed = $fault }
        $stage = 'actual-successful-upgrade'; Update-ProtectedInstallation $association (Join-Path $PayloadRoot 'binaries') $manifest | Out-Null
        $report.upgrade = Invoke-InstalledOwnerAttempt $association $true
    } catch { $report.failure = @{ stage = $stage; hResult = $_.Exception.HResult } }
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
                $report.uninstall = @{ serviceAbsent = [ProtectedInstallService]::Absent(); protectedParentAbsent = !(Test-Path -LiteralPath $script:ProtectedInstallParent); exactAccountSidAbsent = @((Get-LocalUser) | Where-Object { $_.SID.Value -ceq $sid }).Count -eq 0; passed = $true }
                $association = $null
            } catch { $report.cleanupFailure = @{ stage = 'exact-owned-uninstall'; hResult = $_.Exception.HResult } }
        }
        $password = $null; if ($null -ne $scratchParent) { $scratchParent.Dispose() }
    }
    if ($null -eq $report.failure -and $null -eq $report.cleanupFailure) {
        $journal = @{}; $partialAccount = 'AegisOp' + [guid]::NewGuid().ToString('N').Substring(0, 12); $fault = $false
        try { New-ProtectedInstallation (Join-Path $PayloadRoot 'binaries') $manifest $partialAccount ('Ae!9-' + [guid]::NewGuid().ToString('N')) $true $journal | Out-Null }
        catch { $fault = $_.Exception.Message -like '*protected-qualified-partial-fault*' }
        $report.partial = @{ injectedAfterPublication = $fault; journal = $journal; serviceAbsent = [ProtectedInstallService]::Absent(); protectedParentAbsent = !(Test-Path -LiteralPath $script:ProtectedInstallParent);
            accountAbsent = @((Get-LocalUser) | Where-Object { $_.Name -ceq $partialAccount }).Count -eq 0 }
        $report.partial.passed = $fault -and $report.partial.serviceAbsent -and $report.partial.protectedParentAbsent -and $report.partial.accountAbsent
    }
    $report.passed = $null -eq $report.failure -and $null -eq $report.cleanupFailure -and $null -ne $report.partial -and $report.partial.passed
    $json = $report | ConvertTo-Json -Depth 20
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
            @{ value = $Value.mutation.actual.permitted; fields = @('write', 'delete', 'replace') },
            @{ value = $Value.rollback; fields = @('passed', 'injectedAfterPublication', 'originalRootAndFilesRestored') },
            @{ value = $Value.partial; fields = @('passed', 'injectedAfterPublication', 'serviceAbsent', 'protectedParentAbsent', 'accountAbsent') },
            @{ value = $Value.uninstall; fields = @('passed', 'serviceAbsent', 'protectedParentAbsent', 'exactAccountSidAbsent') })
        foreach ($group in $typed) { foreach ($field in $group.fields) { if ($group.value.$field -isnot [bool]) { return $false } } }
        $leafNames = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe', 'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
            'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs', 'scripts/installation/protected-install-files.ps1', 'scripts/installation/protected-install-transaction.ps1',
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
        if ($Value.mutation.actorSha256 -cne $pins['native/installed-owner-actor.exe'] -or !$Value.mutation.actual.passed -or $Value.mutation.actual.administrator -or !$Value.mutation.actual.policyReadable -or
            !$Value.mutation.actual.permitted.write -or !$Value.mutation.actual.permitted.delete -or !$Value.mutation.actual.permitted.replace -or
            $Value.mutation.passed -ne $true -or $Value.mutation.protectedFilesAndAncestorsUnchanged -ne $true -or $Value.mutation.independentlyObservedPermittedReplacement -ne $true -or
            $Value.mutation.independentlyObservedPermittedWrite -ne $true -or $Value.mutation.independentlyObservedPermittedDelete -ne $true -or
            $Value.mutation.independentTokenAndJob.elevated -ne $false -or $Value.mutation.independentTokenAndJob.enabledAdministrator -ne $false -or $Value.mutation.independentTokenAndJob.integritySid -cne 'S-1-16-8192' -or
            $Value.mutation.independentTokenAndJob.adminCapable -ne $false -or $Value.mutation.independentTokenAndJob.powerfulPrivilegesAssigned -ne $false -or $Value.mutation.independentTokenAndJob.strictStandardProfile -ne $true -or
            $Value.mutation.independentTokenAndJob.jobEmpty -ne $true -or $Value.mutation.independentTokenAndJob.exactProcessExited -ne $true -or @($Value.mutation.actual.attempts).Count -ne 28 -or
            @($Value.mutation.actual.attempts | Where-Object { $_.denied -isnot [bool] -or $_.denied -ne $true -or $_.win32Error -ne 5 }).Count -ne 0) { return $false }
        if ($Value.rollback.passed -ne $true -or $Value.rollback.originalRootAndFilesRestored -ne $true -or $Value.partial.passed -ne $true -or
            $Value.partial.serviceAbsent -ne $true -or $Value.partial.protectedParentAbsent -ne $true -or $Value.partial.accountAbsent -ne $true -or
            $Value.uninstall.passed -ne $true -or $Value.uninstall.serviceAbsent -ne $true -or $Value.uninstall.protectedParentAbsent -ne $true -or $Value.uninstall.exactAccountSidAbsent -ne $true) { return $false }
        return $true
    } catch { return $false }
}
