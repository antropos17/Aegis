param([Parameter(Mandatory = $true)][string]$OutputRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-git.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-claude-public.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-claude-phase.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-cancellation.ps1')
Assert-CloudGuestRunner
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'windows-powershell51-required' }
$expectedRoot = 'D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT
if ([IO.Path]::GetFullPath($OutputRoot).TrimEnd('\') -cne $expectedRoot -or (Test-Path -LiteralPath $OutputRoot)) { throw 'fresh-exact-owned-root-required' }
$cursor = Get-Item -LiteralPath D:/
if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse-output-parent-refused' }
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
foreach ($leaf in @('evidence', 'temp', 'media', 'native', 'transfer', 'vm', 'canaries')) { New-Item -ItemType Directory -Path (Join-Path $OutputRoot $leaf) | Out-Null }
$env:TEMP = Join-Path $OutputRoot 'temp'; $env:TMP = $env:TEMP
. (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-vm.ps1')
. (Join-Path $PSScriptRoot 'cloud-host-routes.ps1')
$name = 'aegis-cloud-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '-' + [guid]::NewGuid().ToString('N')
$vmRoot = Join-Path $OutputRoot 'vm'; $mediaRoot = Join-Path $OutputRoot 'media'
$id = $null; $owner = $null; $unknown = $false; $createAttempted = $false; $absence = $false; $mounted = $false
$windowsIso = Join-Path $mediaRoot 'windows.iso'; $answerIso = Join-Path $mediaRoot 'answer.iso'
$report = [ordered]@{ schemaVersion = 1; scope = 'cloud-windows11-fixed-standard-user-lab'; startedAt = [DateTime]::UtcNow.ToString('o'); sourceSha = $env:EXPECTED_SOURCE_SHA;
    actualHead = $null; sourceObservation = $null; sourceHashes = [ordered]@{}; compilerSha256 = $null; stages = [Collections.Generic.List[object]]::new(); host = $null; disks = [Collections.Generic.List[object]]::new();
    media = $null; runtime = $null; hardware = $null; vmName = $name; vmId = $null; startOperation = $null; stopOperation = $null; guest = $null; keyboard = $null; keyboardWindow = $null;
    cancellationPhase = $null; cancellationControlsComplete = $false; hostCanariesUnchangedAfterCancellation = $false; claudeProvenance = $null; claudePhase = $null; claudeCorpusComplete = $false; claudeAcceptancePassed = $false; E6Qualified = $false;
    hostCanariesUnchangedAfterTask = $false; hostCanariesUnchangedAfterRemoval = $false; offObserved = $false; removedObserved = $false; operationSettlement = 'not-submitted';
    cleanupFailure = $null; failure = $null; hostRouteEarlySnapshot = $null; passed = $false; launchAllowed = $false; A1Qualified = $false; sharedHostRoutesTested = $false; hostGuestVhdMounted = $false }
# Deletes only fixed disposable leaves after settled VM absence or no VM request.
function Remove-CloudGuestClosedFiles([string]$Root, [string]$RunId, [string]$Attempt, $CreateAttempted, $HasVmId, $HasOwner, $Unknown, $RemovedObserved, $Mounted) {
    $result = @{ eligible = $false; completed = $false; mode = 'refused'; failure = $null; files = [Collections.Generic.List[object]]::new() }
    foreach ($flag in @($CreateAttempted, $HasVmId, $HasOwner, $Unknown, $RemovedObserved, $Mounted)) {
        if ($flag -isnot [bool]) { $result.failure = 'state-invalid'; return $result }
    }
    if ($Unknown -or $Mounted) { $result.mode = 'not-eligible'; return $result }
    $neverCreated = !$CreateAttempted -and !$HasVmId -and !$HasOwner -and !$RemovedObserved
    if (!$neverCreated -and !($CreateAttempted -and $HasVmId -and $RemovedObserved)) { $result.mode = 'not-eligible'; return $result }
    try {
        if ($RunId -cnotmatch '^[0-9]{1,20}$' -or $Attempt -cnotmatch '^[0-9]{1,20}$') { throw 'closed-root-invalid' }
        $expected = 'D:\aegis-cloud-guest-' + $RunId + '-' + $Attempt
        if (![StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($Root), $expected)) { throw 'closed-root-invalid' }
        $rootItem = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
        if ($rootItem -isnot [IO.DirectoryInfo]) { throw 'closed-root-invalid' }
        $cursor = $rootItem
        while ($null -ne $cursor) {
            if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'closed-path-invalid' }
            $cursor = $cursor.Parent
        }
        $leaves = @(@{ id = 'answerIso'; path = 'media\answer.iso' }, @{ id = 'answerXml'; path = 'media\answer\Autounattend.xml' }, @{ id = 'windowsIso'; path = 'media\windows.iso' })
        if (!$neverCreated) { $leaves = @(@{ id = 'guestVhd'; path = 'vm\guest.vhdx' }) + $leaves }
        # Validate the entire finite set before any deletion, including ancestors.
        function Read-ClosedItem([string]$Path) {
            try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
            catch [Management.Automation.ItemNotFoundException] { return $null }
        }
        $present = [Collections.Generic.List[object]]::new()
        foreach ($leaf in $leaves) {
            $path = Join-Path $Root $leaf.path
            $parent = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($path))
            while ($null -ne $parent -and $parent.FullName.Length -ge $expected.Length) {
                $item = Read-ClosedItem $parent.FullName
                if ($null -ne $item) {
                    if ($item -isnot [IO.DirectoryInfo] -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'closed-path-invalid' }
                }
                $parent = $parent.Parent
            }
            $file = Read-ClosedItem $path
            if ($null -eq $file) { $result.files.Add(@{ file = $leaf.id; state = 'absent' }); continue }
            if ($file -isnot [IO.FileInfo] -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'closed-path-invalid' }
            $present.Add(@{ file = $leaf.id; path = $path })
        }
        foreach ($item in $present) {
            if ($item.file -in @('windowsIso', 'answerIso', 'guestVhd')) {
                $images = @(Get-DiskImage -ImagePath $item.path -ErrorAction Stop)
                if ($images.Count -ne 1 -or $images[0].Attached -isnot [bool] -or $images[0].Attached -or
                    ![StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($images[0].ImagePath), $item.path)) { throw 'closed-image-unconfirmed' }
            }
        }
        $result.eligible = $true; $result.mode = if ($neverCreated) { 'never-created' } else { 'exact-vm-absent' }
        foreach ($item in $present) {
            $stream = $null
            try {
                # Exclusive read/write open refuses locked/in-use files. Delete on
                # close avoids a later pathname-based delete after releasing it.
                $stream = [IO.FileStream]::new($item.path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
                $bytes = $stream.Length; $stream.Dispose(); $stream = $null
                if (Test-Path -LiteralPath $item.path -ErrorAction Stop) { throw 'closed-delete-unconfirmed' }
                $result.files.Add(@{ file = $item.file; state = 'removed'; bytes = $bytes })
            }
            catch { $result.failure = 'closed-file-cleanup-failed'; $result.files.Add(@{ file = $item.file; state = 'failed'; hResult = $_.Exception.HResult }) }
            finally { if ($null -ne $stream) { $stream.Dispose() } }
        }
        $result.completed = $null -eq $result.failure
    }
    catch { $result.failure = 'closed-file-validation-failed' }
    return $result
}

function RecordDisk([string]$Phase) {
    $values = @('C', 'D') | ForEach-Object { $drive = Get-PSDrive -Name $_; @{ drive = $_; freeBytes = [long]$drive.Free; usedBytes = [long]$drive.Used } }
    $report.disks.Add(@{ phase = $Phase; capturedAt = [DateTime]::UtcNow.ToString('o'); drives = @($values) })
    return @($values)
}
function Stage([string]$StageName, [scriptblock]$Operation) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Write-Host ('stage-begin ' + $StageName + ' ' + [DateTime]::UtcNow.ToString('o'))
    try { $value = & $Operation; $report.stages.Add(@{ stage = $StageName; passed = $true; milliseconds = $watch.ElapsedMilliseconds }); return $value }
    catch {
        # Never publish dynamic guest error text: remote errors can carry credentials.
        $detail = Get-CloudGuestFailureDetails $_.Exception
        $report.stages.Add(@{ stage = $StageName; passed = $false; code = $detail.code; milliseconds = $watch.ElapsedMilliseconds; hResult = $detail.hResult; exceptionType = $detail.exceptionType; innerDepth = $detail.innerDepth; category = $_.CategoryInfo.Category.ToString() })
        $report.failure = @{ stage = $StageName; code = $detail.code; hResult = $detail.hResult; exceptionType = $detail.exceptionType; innerDepth = $detail.innerDepth; category = $_.CategoryInfo.Category.ToString() }; throw
    }
    finally { $watch.Stop(); Write-Host ('stage-end ' + $StageName + ' ' + [DateTime]::UtcNow.ToString('o')) }
}
function Compile([string]$Leaf, [string[]]$Sources, [string[]]$References) {
    $output = Join-Path $OutputRoot ('native\' + $Leaf)
    $arguments = @('/nologo', '/target:library', '/platform:x64', '/optimize+', '/warnaserror+', ('/out:"' + $output + '"'))
    foreach ($reference in $References) { $arguments += '/reference:' + $reference }
    foreach ($relative in $Sources) {
        $file = Get-Item -LiteralPath (Join-Path $project $relative) -Force
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'native-source-budget-failed' }
        $report.sourceHashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $arguments += '"' + $file.FullName + '"'
    }
    $stdout = Join-Path $OutputRoot ('native\' + $Leaf + '.txt'); $stderr = $stdout + '.error'
    $exitCode = Invoke-CloudGuestNativeProcess $compiler $arguments $stdout $stderr 30000
    if ($exitCode -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 1MB -or (Get-Item -LiteralPath $stdout).Length -gt 64KB -or (Get-Item -LiteralPath $stderr).Length -gt 64KB) { throw 'native-compile-failed' }
    return $output
}
function CanariesUnchanged {
    foreach ($entry in $canaries) {
        if (!(Test-Path -LiteralPath $entry.path)) { return $false }
        $file = Get-Item -LiteralPath $entry.path -Force
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 1024 -or
            (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { return $false }
    }
    return $true
}
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$canaries = @()
try {
    Stage 'host-preflight' {
        $disks = @(RecordDisk 'before')
        if (@($disks | Where-Object { ($_.drive -eq 'D' -and $_.freeBytes -lt 80GB) -or ($_.drive -eq 'C' -and $_.freeBytes -lt 8GB) }).Count) { throw 'cloud-disk-headroom-unavailable' }
        if ($report.sourceSha -notmatch '^[a-f0-9]{40}$') { throw 'expected-source-required' }
        $headFile = Join-Path $OutputRoot 'temp\head.txt'; $gitError = Join-Path $OutputRoot 'temp\git-error.txt'
        $exitCode = Invoke-CloudGuestNativeProcess 'git.exe' @('-C', ('"' + $project + '"'), 'rev-parse', 'HEAD') $headFile $gitError 10000
        $report.sourceObservation = @{ exitCode = $exitCode; headBytes = (Get-Item -LiteralPath $headFile).Length; stderrBytes = (Get-Item -LiteralPath $gitError).Length }
        if ($exitCode -ne 0 -or $report.sourceObservation.headBytes -gt 128 -or $report.sourceObservation.stderrBytes -ne 0) { throw 'source-head-unavailable' }
        $report.actualHead = [IO.File]::ReadAllText($headFile).Trim()
        if ($report.actualHead -cne $report.sourceSha) { throw 'source-head-mismatch' }
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5; $computer = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 5
        $report.host = @{ caption = $os.Caption; build = $os.BuildNumber; admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); hypervisorPresent = $computer.HypervisorPresent; memoryBytes = [long]$computer.TotalPhysicalMemory; vmms = (Get-Service vmms).Status.ToString() }
        if (!$report.host.admin -or $report.host.vmms -ne 'Running' -or [long]$os.FreePhysicalMemory * 1024 -lt 6GB) { throw 'cloud-hyperv-admin-memory-unavailable' }
        foreach ($relative in @('scripts/qualification/cloud-guest-lab.ps1', 'scripts/qualification/cloud-guest-vm.ps1', 'scripts/qualification/cloud-guest-media.ps1', 'scripts/qualification/cloud-guest-bootstrap.ps1', 'scripts/qualification/cloud-guest-task.cjs', 'scripts/qualification/cloud-hyperv-operations.ps1', 'scripts/qualification/protocol.cjs', 'scripts/qualification/receiver.cjs', 'scripts/qualification/client.cjs', 'scripts/qualification/cloud-guest-runtime.cjs', 'scripts/qualification/test-cloud-guest-cancellation.ps1', 'tests/fixtures/native-cloud-guest-cancellation/CancellationFixture.cs', 'tests/fixtures/native-cloud-guest-cancellation/cancellation-client.cjs', 'scripts/qualification/cloud-host-routes.ps1', 'scripts/qualification/route-protocol.cjs', 'scripts/qualification/route-client.cjs', 'scripts/qualification/route-receiver.cjs', 'scripts/qualification/route-oracle.cjs', 'scripts/qualification/cloud-guest-git.cjs', 'scripts/qualification/cloud-guest-git.ps1', 'scripts/qualification/git-runtime-manifest.json')) {
            $file = Get-Item -LiteralPath (Join-Path $project $relative) -Force
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'script-source-budget-failed' }
            $report.sourceHashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $report.compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant()
        foreach ($relative in @('cloud-guest-claude-public.ps1', 'cloud-guest-claude-phase.ps1', 'cloud-guest-claude-bootstrap.ps1',
            'cloud-guest-cancellation.ps1', 'cloud-guest-cancellation-bootstrap.ps1', 'cloud-cancellation-runtime.cjs', 'cloud-cancellation-task.cjs', 'cloud-cancellation-child.cjs',
            'claude-protocol.cjs', 'claude-receiver.cjs', 'claude-task.cjs', 'claude-runtime.cjs', 'claude-sum.test.cjs', 'claude-test-witness-runtime.cjs', 'claude-test-witness.cjs',
            'claude-public/provenance.ps1', 'claude-public/official-manifest.json', 'claude-public/official-manifest.json.sig', 'claude-public/official-release-key.asc')) {
            $file = Get-Item -LiteralPath (Join-Path $PSScriptRoot $relative) -Force
            if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'claude-fixed-source-refused' }
            $report.sourceHashes['scripts/qualification/' + $relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Out-Null
    Stage 'compile-fixed-native-helpers' {
        Add-Type -Path (Compile 'metadata.dll' @('scripts/qualification/CloudGuestMetadata.cs') @('System.Net.Http.dll'))
        Add-Type -Path (Compile 'vm-owner.dll' @('scripts/qualification/CloudGuestVm.cs', 'scripts/qualification/CloudGuestBootDiagnostics.cs', 'sidecar/session/OwnedVmLifecycle.cs', 'sidecar/session/VmManagementNative.cs') @('System.Management.dll'))
        Add-Type -Path (Compile 'claude-download.dll' @('scripts/qualification/CloudGuestClaudeDownload.cs') @('System.Net.Http.dll'))
        $guestDll = Compile 'guest-process.dll' @('scripts/qualification/CloudGuestProcess.cs', 'scripts/qualification/CloudGuestLoaderProbe.cs', 'scripts/qualification/CloudGuestTestWitness.cs', 'scripts/qualification/CloudGuestDesktop.cs', 'scripts/qualification/CloudGuestNetwork.cs', 'scripts/qualification/CloudGuestClaudeReceiver.cs', 'scripts/qualification/CloudGuestRuntimeGate.cs', 'sidecar/session/CallerAdmission.cs', 'sidecar/session/CallerRegistration.cs', 'sidecar/session/CallerIdentity.cs', 'sidecar/session/CallerNative.cs', 'sidecar/session/GuestJobNative.cs', 'sidecar/session/GuestJobInventory.cs') @()
        Copy-Item -LiteralPath $guestDll -Destination (Join-Path $OutputRoot 'transfer\guest-process.dll')
    } | Out-Null
    $report.media = Stage 'pinned-media-download-and-hash' {
        $url = 'https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
        $digest = [CloudGuestMetadata]::Download($url, $windowsIso, 8225329152)
        if ($digest -cne 'bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38') { throw 'published-media-hash-mismatch' }
        return @{ url = $url; bytes = 8225329152; sha256 = $digest; hashSource = 'https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/09/verify-the-authenticity-of-a-windows-11-enterprise-evaluation-iso-file'; license = 'Microsoft 90-day evaluation; disposable testing'; verifiedBeforeMount = $true }
    }
    $metadata = Stage 'read-only-exact-wim-metadata' {
        Mount-DiskImage -ImagePath $windowsIso -Access ReadOnly -PassThru | Out-Null; $script:mounted = $true
        $volumes = @(Get-DiskImage -ImagePath $windowsIso | Get-Volume | Where-Object DriveLetter)
        if ($volumes.Count -ne 1) { throw 'pinned-media-volume-unavailable' }
        return (Get-CloudGuestImageMetadata ([CloudGuestMetadata]::ImageXml(($volumes[0].DriveLetter + ':\sources\install.wim'))))
    }
    $report.media.image = $metadata
    Dismount-DiskImage -ImagePath $windowsIso | Out-Null; $mounted = $false
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create(); $bytes = New-Object byte[] 24
    $generator.GetBytes($bytes); $adminPassword = 'Aa1!' + [Convert]::ToBase64String($bytes)
    $generator.GetBytes($bytes); $taskPassword = 'Bb2!' + [Convert]::ToBase64String($bytes); $generator.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length)
    $adminCredential = [pscredential]::new('AegisSetup', (ConvertTo-SecureString $adminPassword -AsPlainText -Force))
    Stage 'tiny-answer-iso' {
        $answer = New-CloudGuestAnswerText $metadata.index $adminPassword $taskPassword
        $length = New-CloudGuestAnswerIso (Join-Path $mediaRoot 'answer') $answerIso $answer
        $report.media.answerIsoBytes = $length; $answer = $null
    } | Out-Null
    Stage 'stage-fixed-runtime-and-host-controls' {
        $report['runtimeStagingPhase'] = 'NodeSelect'
        $transfer = Join-Path $OutputRoot 'transfer'
        $node = Get-Item -LiteralPath (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
        if ($node.Attributes -band [IO.FileAttributes]::ReparsePoint -or $node.Length -gt 256MB) { throw 'trusted-node-input-invalid' }
        Copy-Item -LiteralPath $node.FullName -Destination (Join-Path $transfer 'node.exe')
        $report['runtimeStagingPhase'] = 'NodeVersion'
        $versionFile = Join-Path $OutputRoot 'temp\node-version.txt'; $errorFile = $versionFile + '.error'
        $exitCode = Invoke-CloudGuestNativeProcess $node.FullName @('--version') $versionFile $errorFile 5000
        if ($exitCode -ne 0 -or (Get-Item $versionFile).Length -gt 128 -or (Get-Item $errorFile).Length -ne 0) { throw 'node-version-observation-failed' }
        $report.runtime = @{ path = $node.FullName; bytes = $node.Length; version = [IO.File]::ReadAllText($versionFile).Trim(); sha256 = (Get-FileHash -LiteralPath (Join-Path $transfer 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() }
        $report['runtimeStagingPhase'] = 'FixedRuntimeCopies'
        foreach ($leaf in @('cloud-guest-bootstrap.ps1', 'cloud-guest-task.cjs', 'protocol.cjs', 'receiver.cjs', 'client.cjs', 'cloud-guest-runtime.cjs', 'route-protocol.cjs', 'route-client.cjs', 'cloud-guest-git.cjs', 'cloud-guest-git.ps1', 'git-runtime-manifest.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $transfer }
        $report['runtimeStagingPhase'] = 'FixedClaudeCopies'
        foreach ($leaf in @('cloud-guest-cancellation-bootstrap.ps1', 'cloud-cancellation-runtime.cjs', 'cloud-cancellation-task.cjs', 'cloud-cancellation-child.cjs', 'cloud-guest-claude-bootstrap.ps1', 'claude-protocol.cjs', 'claude-receiver.cjs', 'claude-task.cjs', 'claude-runtime.cjs', 'claude-sum.test.cjs', 'claude-test-witness-runtime.cjs', 'claude-test-witness.cjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $transfer }
        $report['runtimeStagingPhase'] = 'ClaudeProvenance'
        $report.claudeProvenance = Save-CloudGuestClaudeBinary $transfer (Join-Path $OutputRoot 'temp')
        $report['runtimeStagingPhase'] = 'GitArchive'
        $gitArchive = Join-Path $transfer 'git-runtime.zip'
        Save-CloudGuestGitArchive $gitArchive
        $report.sourceHashes['git-runtime.zip'] = (Get-FileHash -LiteralPath $gitArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        $report['runtimeStagingPhase'] = 'GitArchiveControls'
        & (Join-Path $PSScriptRoot 'test-cloud-guest-git.ps1') -OwnedFixtureRoot (Join-Path $OutputRoot 'temp') -PinnedArchivePath $gitArchive | Out-Null
        $report['runtimeStagingPhase'] = 'GitInvocationControls'
        & (Join-Path $PSScriptRoot 'test-cloud-guest-git-invocation.ps1') | Out-Null
        $report['runtimeStagingPhase'] = 'FixedSealedCopy'
        $sealedOut = Join-Path $OutputRoot 'temp\sealed-copy-stage.json'; $sealedErr = $sealedOut + '.error'
        $sealedCode = Invoke-CloudGuestNativeProcess $node.FullName @((Join-Path $PSScriptRoot 'cloud-sealed-copy-host.mjs'), $OutputRoot) $sealedOut $sealedErr 30000
        if ($sealedCode -ne 0 -or (Get-Item -LiteralPath $sealedOut).Length -gt 16KB -or (Get-Item -LiteralPath $sealedErr).Length -ne 0) { throw 'fixed-sealed-copy-host-refused' }
        $report['sealedCopyHost'] = [IO.File]::ReadAllText($sealedOut) | ConvertFrom-Json
        if ($report.sealedCopyHost.passed -isnot [bool] -or !$report.sealedCopyHost.passed) { throw 'fixed-sealed-copy-host-refused' }
        foreach ($leaf in @('cloud-sealed-copy.cjs', 'cloud-sealed-copy-verify.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $transfer }
        foreach ($leaf in @('cloud-sealed-copy.cjs', 'cloud-sealed-copy-host.mjs', 'cloud-sealed-copy-verify.ps1', 'sealed-import-build.mjs', 'sealed-import-oracle.mjs')) {
            $report.sourceHashes['scripts/qualification/' + $leaf] = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $leaf)).Hash.ToLowerInvariant()
        }
        foreach ($row in $report.sealedCopyHost.fixture.sources) { $report.sourceHashes['tests/fixtures/sealed-import/' + $row.name] = $row.sha256 }
        $report['runtimeStagingPhase'] = 'HostCanaries'
        $canaryEntries = @()
        foreach ($index in 1..2) {
            $selected = Join-Path $OutputRoot ('canaries\' + [guid]::NewGuid().ToString('N') + '.txt')
            [IO.File]::WriteAllText($selected, 'host-positive-control'); if ([IO.File]::ReadAllText($selected) -ne 'host-positive-control') { throw 'host-read-write-control-failed' }
            Remove-Item -LiteralPath $selected; if (Test-Path -LiteralPath $selected) { throw 'host-delete-control-failed' }
            [IO.File]::WriteAllText($selected, 'host-final-canary-' + [guid]::NewGuid().ToString('N'))
            $canaryEntries += @{ path = $selected; sha256 = (Get-FileHash -LiteralPath $selected -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
        $script:canaries = $canaryEntries
        $report['runtimeStagingPhase'] = 'TransferManifest'
        $files = @(Get-ChildItem -LiteralPath $transfer -File | ForEach-Object { @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
        $manifestText = @{ schemaVersion = 1; scope = 'fixed-cloud-guest-task'; files = $files; hostCanaries = @($canaryEntries | ForEach-Object path) } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $transfer 'manifest.json'), $manifestText, [Text.UTF8Encoding]::new($false))
        $report['runtimeStagingPhase'] = 'Complete'
    } | Out-Null
    Stage 'create-exact-owned-vm' {
        $initial = Invoke-CloudHyperVCommand recover $name $vmRoot $null
        if ($initial.exists) { throw 'owned-name-preexisting' }; $script:absence = $true; $script:createAttempted = $true; $script:unknown = $true
        $created = Invoke-CloudHyperVCommand create $name $vmRoot $null
        if (!$created.exists -or $created.name -cne $name -or $created.vmId -notmatch '^[a-f0-9-]{36}$') { throw 'created-identity-unknown' }
        $script:id = $created.vmId; $report.vmId = $id; $script:unknown = $false
    } | Out-Null
    $report.hardware = Stage 'configure-supported-windows11-guest' {
        $script:unknown = $true; $hardware = Invoke-CloudGuestConfiguration $id $name $vmRoot $windowsIso $answerIso; $script:unknown = $false; return $hardware
    }
    Stage 'native-start-and-firmware-key' {
        $script:owner = [CloudGuestVm]::new($id)
        $running = $owner.Start(); $report.startOperation = $owner.Operation(); $script:unknown = $owner.PendingUnknown
        if (!$running -or $unknown) { throw 'native-start-unconfirmed' }
        $report.operationSettlement = 'actual-native-start-settled'
    } | Out-Null
    Stage 'early-owned-host-route-snapshot' {
        $earlyDiagnostic = $null
        try { Get-CloudHostRouteSnapshot $id $name $vmRoot ([ref]$earlyDiagnostic) | Out-Null }
        finally { $report.hostRouteEarlySnapshot = $earlyDiagnostic }
    } | Out-Null
    Stage 'optional-fixed-setup-key-window' {
        $report.keyboardWindow = Invoke-CloudGuestBootWindow $owner
        if ($report.keyboardWindow.mandatoryFailure) { throw $report.keyboardWindow.failure.code }
    } | Out-Null
    RecordDisk 'before-guest-setup' | Out-Null
    $report.guest = Stage 'actual-guest-setup-and-standard-task' {
        # A lost worker may have submitted a device mutation. Only its bounded
        # result can establish whether a later native Stop is safe to request.
        $script:unknown = $true
        $result = Invoke-CloudGuestBootstrap $id $name $vmRoot $adminCredential $taskPassword (Join-Path $OutputRoot 'transfer') $report.actualHead
        $script:report.guest = $result
        if ($result.mediaMutationUnknown -isnot [bool]) { throw 'guest-bootstrap-failed' }
        $script:unknown = $result.mediaMutationUnknown
        if ($null -ne $result.failure) { throw $result.failure.code }
        return $result
    }
    $report.hostCanariesUnchangedAfterTask = CanariesUnchanged
    if (!$report.hostCanariesUnchangedAfterTask -or !$report.guest.guestResult.task.passed -or !$report.guest.hostRoutes.passed) { throw 'host-or-guest-task-control-failed' }
    $sealedOut = Join-Path $OutputRoot 'temp\sealed-copy-recheck.json'; $sealedErr = $sealedOut + '.error'
    $sealedNode = Join-Path $OutputRoot 'transfer\node.exe'
    if ((Get-FileHash -LiteralPath $sealedNode).Hash.ToLowerInvariant() -cne $report.runtime.sha256) { throw 'fixed-sealed-copy-host-refused' }
    $sealedCode = Invoke-CloudGuestNativeProcess $sealedNode @((Join-Path $PSScriptRoot 'cloud-sealed-copy-host.mjs'), $OutputRoot, 'recheck', $report.sealedCopyHost.bundleSha256) $sealedOut $sealedErr 10000
    if ($sealedCode -ne 0 -or (Get-Item -LiteralPath $sealedOut).Length -gt 16KB -or (Get-Item -LiteralPath $sealedErr).Length -ne 0) { throw 'fixed-sealed-copy-host-refused' }
    $report['sealedCopyHostRecheck'] = [IO.File]::ReadAllText($sealedOut) | ConvertFrom-Json
    if ($report.sealedCopyHostRecheck.passed -isnot [bool] -or !$report.sealedCopyHostRecheck.passed -or
        !$report.guest.guestResult.ContainsKey('sealedCopyControls') -or $report.guest.guestResult.sealedCopyControls.passed -isnot [bool] -or
        !$report.guest.guestResult.sealedCopyControls.passed) { throw 'fixed-sealed-copy-guest-refused' }
    $report.claudePhase = Stage 'second-fixed-claude-guest-phase' {
        Invoke-CloudGuestClaudePhase $id $name $vmRoot $adminCredential $taskPassword (Join-Path $OutputRoot 'transfer') $report.guest
    }
    $report.claudeCorpusComplete = $report.claudePhase.passed -eq $true
    $report.hostCanariesUnchangedAfterTask = CanariesUnchanged
    if (!$report.claudeCorpusComplete -or !$report.hostCanariesUnchangedAfterTask) { throw 'claude-fixed-corpus-incomplete' }
    $report.cancellationPhase = Stage 'fixed-cloud-cancellation' {
        $value = Invoke-CloudGuestCancellationPhase $id $name $vmRoot $adminCredential $taskPassword (Join-Path $OutputRoot 'transfer') $report.guest $report.claudePhase
        $script:report.cancellationPhase = $value
        $script:report.cancellationControlsComplete = $value.passed -is [bool] -and $value.passed
        $script:report.hostCanariesUnchangedAfterCancellation = CanariesUnchanged
        if (!$report.cancellationControlsComplete -or !$report.hostCanariesUnchangedAfterCancellation) { throw 'cloud-cancellation-controls-refused' }
        return $value
    }
    $report.cancellationControlsComplete = $report.cancellationPhase.passed -eq $true
    $report.hostCanariesUnchangedAfterCancellation = CanariesUnchanged
    if (!$report.cancellationControlsComplete -or !$report.hostCanariesUnchangedAfterCancellation) { throw 'cloud-cancellation-controls-refused' }
}
catch { if ($null -eq $report.failure) { $report.failure = @{ stage = 'driver'; hResult = $_.Exception.HResult; category = $_.CategoryInfo.Category.ToString() } } }
finally {
    $adminPassword = $null; $taskPassword = $null; $adminCredential = $null
    try {
        if ($null -ne $owner) {
            $report.keyboard = $owner.KeyboardObservation
            if ($owner.PendingUnknown) { $unknown = $true }
            if (!$unknown) { $stopped = $owner.Stop(); $report.stopOperation = $owner.Operation(); $report.offObserved = $stopped -and $owner.ObserveOff(); $unknown = $owner.PendingUnknown }
        }
        elseif ($id -and !$unknown) { $snapshot = Invoke-CloudHyperVCommand observe $name $vmRoot $id; $report.offObserved = $snapshot.exists -and $snapshot.state -eq 'Off' }
        if ($id -and !$unknown -and $report.offObserved) {
            $unknown = $true; Invoke-CloudHyperVCommand remove $name $vmRoot $id | Out-Null
            $unknown = $false; $after = Invoke-CloudHyperVCommand observe $name $vmRoot $id; $report.removedObserved = !$after.exists
            if (!$report.removedObserved) { throw 'exact-vm-removal-unconfirmed' }
        }
        elseif ($createAttempted) { throw 'vm-cleanup-refused-unsettled-or-off-unknown' }
    }
    catch { $report.cleanupFailure = @{ stage = 'exact-vm-cleanup'; hResult = $_.Exception.HResult }; if ($null -ne $owner -and $owner.PendingUnknown) { $unknown = $true } }
    finally { if ($null -ne $owner) { $owner.Dispose() } }
    if ($unknown) { $report.operationSettlement = 'unknown-provider-operation'; $report.removedObserved = $false }
    elseif ($report.removedObserved) { $report.operationSettlement = 'settled-and-exact-vm-absent' }
    try { if ($mounted) { Dismount-DiskImage -ImagePath $windowsIso | Out-Null; $mounted = $false } } catch { $report.cleanupFailure = @{ stage = 'trusted-iso-dismount'; hResult = $_.Exception.HResult } }
    $report.hostCanariesUnchangedAfterRemoval = $canaries.Count -eq 2 -and (CanariesUnchanged)
    # Preserves all receipts, transfer files and unknown/in-use VM media.
    $report['closedOwnedFilesCleanup'] = Remove-CloudGuestClosedFiles $OutputRoot $env:GITHUB_RUN_ID $env:GITHUB_RUN_ATTEMPT $createAttempted ([bool]$id) ($null -ne $owner) $unknown $report.removedObserved $mounted
    if ($null -ne $report.closedOwnedFilesCleanup.failure -and $null -eq $report.cleanupFailure) {
        $report.cleanupFailure = @{ stage = 'closed-owned-file-cleanup'; code = $report.closedOwnedFilesCleanup.failure }
    }
    RecordDisk 'after' | Out-Null
    $report.completedAt = [DateTime]::UtcNow.ToString('o')
    $report.passed = $report.cancellationControlsComplete -and $report.hostCanariesUnchangedAfterCancellation -and $null -eq $report.failure -and $null -eq $report.cleanupFailure -and $report.offObserved -and $report.removedObserved -and $report.hostCanariesUnchangedAfterTask -and $report.hostCanariesUnchangedAfterRemoval
    $json = $report | ConvertTo-Json -Depth 16
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1MB) { throw 'guest-receipt-budget-failed' }
    [IO.File]::WriteAllText((Join-Path $OutputRoot 'evidence\cloud-windows11.json'), $json)
    if ($env:GITHUB_STEP_SUMMARY) {
        $failureLabel = if ($null -eq $report.failure) { 'none' } else { $report.failure.stage }
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ("Windows 11 guest fixed task passed: $($report.passed); failure stage: $failureLabel. PS Direct is lab-only; A1Qualified=false and launchAllowed=false.")
    }
}
if (!$report.passed) { exit 1 }
