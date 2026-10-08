param([Parameter(Mandatory = $true)][string]$OutputRoot, [switch]$NativeLifecycle)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Explicitly restricted to the user-authorized disposable hosted runner. No local VM effects.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or
    $env:GITHUB_RUN_ID -notmatch '^\d+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^\d+$') { throw 'Cloud-only runner scope refused' }
$parent = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$expected = Join-Path $parent ('aegis-cloud-hyperv-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT)
if ([IO.Path]::GetFullPath($OutputRoot) -cne $expected -or (Test-Path -LiteralPath $OutputRoot)) { throw 'Fresh owned output root required' }
$cursor = Get-Item -LiteralPath $parent -Force
while ($null -ne $cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse output parent refused' }
    $cursor = $cursor.Parent
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$evidence = New-Item -ItemType Directory -Path (Join-Path $OutputRoot 'evidence')
$vmRoot = (New-Item -ItemType Directory -Path (Join-Path $OutputRoot 'vm')).FullName
$env:TEMP = (New-Item -ItemType Directory -Path (Join-Path $OutputRoot 'temp')).FullName
$env:TMP = $env:TEMP
$name = 'aegis-cloud-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '-' + [guid]::NewGuid().ToString('N')
$report = [ordered]@{ schemaVersion = 1; scope = 'cloud-hyperv-empty-firmware-lifecycle'; startedAt = [DateTime]::UtcNow.ToString('o');
    sourceSha = $env:EXPECTED_SOURCE_SHA; actualHead = $null; scriptSha256 = [ordered]@{}; vmName = $name; host = $null;
    diskBefore = $null; diskAfter = $null; lifecycle = $null; failure = $null; nativeArtifacts = $null; guestBoot = 'not-run-no-disk'; launchAllowed = $false }
function Disks {
    return @('C', 'D') | ForEach-Object {
        $drive = Get-PSDrive -Name $_ -ErrorAction SilentlyContinue
        if ($null -eq $drive) { @{ drive = $_; available = $false } }
        else { @{ drive = $_; available = $true; freeBytes = $drive.Free; usedBytes = $drive.Used } }
    }
}
function HostFacts {
    $job = Start-Job -ScriptBlock {
        $ErrorActionPreference = 'Stop'
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
        $cpus = @(Get-CimInstance Win32_Processor -OperationTimeoutSec 5 | Select-Object Name, VirtualizationFirmwareEnabled, VMMonitorModeExtensions, SecondLevelAddressTranslationExtensions)
        $computer = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 5
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        $service = Get-Service vmms -ErrorAction SilentlyContinue
        return @{ os = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture };
            admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); hypervisorPresent = $computer.HypervisorPresent; cpus = $cpus;
            vmms = if ($service) { $service.Status.ToString() } else { 'absent' }; hyperVModule = [bool](Get-Module -ListAvailable Hyper-V) }
    }
    try {
        if ($null -eq (Wait-Job -Job $job -Timeout 20)) { throw 'host-observation-timeout' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -ne 'Completed' -or $values.Count -ne 1) { throw 'host-observation-failed' }
        return $values[0]
    }
    finally { if ($job.State -eq 'Running') { Stop-Job -Job $job }; Remove-Job -Job $job -Force }
}
try {
    $report.diskBefore = @(Disks)
    if (@($report.diskBefore | Where-Object { $_.available -and $_.freeBytes -lt 3GB }).Count) { throw 'Insufficient disk headroom' }
    if ($report.sourceSha -notmatch '^[a-f0-9]{40}$') { throw 'Expected source revision required' }
    $headFile = Join-Path $OutputRoot 'head.txt'; $errorFile = Join-Path $OutputRoot 'git-error.txt'
    $git = Start-Process -FilePath 'git.exe' -ArgumentList @('rev-parse', 'HEAD') -PassThru -WindowStyle Hidden -RedirectStandardOutput $headFile -RedirectStandardError $errorFile
    if (!$git.WaitForExit(10000)) { $git.Kill(); throw 'source-observation-timeout' }
    if ($git.ExitCode -ne 0 -or (Get-Item -LiteralPath $headFile).Length -gt 128) { throw 'source-observation-failed' }
    $report.actualHead = (Get-Content -LiteralPath $headFile -Raw).Trim()
    if ($report.actualHead -cne $report.sourceSha) { throw 'Source revision mismatch' }
    foreach ($file in @('qualify-cloud-hyperv.ps1', 'cloud-hyperv-operations.ps1', 'test-cloud-hyperv.ps1')) {
        $selected = Get-Item -LiteralPath (Join-Path $PSScriptRoot $file)
        if ($selected.Attributes -band [IO.FileAttributes]::ReparsePoint -or $selected.Length -gt 64KB) { throw 'Invalid script input' }
        $report.scriptSha256[$file] = (Get-FileHash -LiteralPath $selected.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $report.host = HostFacts
    if (!$report.host.admin -or $report.host.vmms -ne 'Running' -or !$report.host.hyperVModule) { throw 'Hyper-V administration prerequisite unavailable' }
    . (Join-Path $PSScriptRoot 'cloud-hyperv-operations.ps1')
    $nativeExe = $null
    if ($NativeLifecycle) {
        $nativeRoot = (New-Item -ItemType Directory -Path (Join-Path $OutputRoot 'native')).FullName
        $nativeExe = Join-Path $nativeRoot 'lifecycle.exe'
        $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
        $sources = @('sidecar/session/OwnedVmLifecycle.cs', 'sidecar/session/VmManagementNative.cs', 'tests/fixtures/vm-lifecycle/OwnedVmLifecycleFixture.cs')
        $hashes = [ordered]@{}; $arguments = @('/nologo', '/target:exe', '/platform:x64', '/optimize+', '/warnaserror+', '/reference:System.Management.dll', ('/out:"' + $nativeExe + '"'))
        foreach ($relative in $sources) {
            $file = Get-Item -LiteralPath (Join-Path $project $relative) -Force
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'Invalid native source input' }
            $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $arguments += ('"' + $file.FullName + '"')
        }
        $compiled = Start-Process -FilePath $compiler -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $nativeRoot 'compile.txt') -RedirectStandardError (Join-Path $nativeRoot 'compile-error.txt')
        if (!$compiled.WaitForExit(30000)) { $compiled.Kill(); throw 'Native compiler timeout' }
        if ($compiled.ExitCode -ne 0 -or (Get-Item -LiteralPath $nativeExe).Length -gt 1MB) { throw 'Native compiler failed' }
        foreach ($log in @('compile.txt', 'compile-error.txt')) {
            if ((Get-Item -LiteralPath (Join-Path $nativeRoot $log)).Length -gt 64KB) { throw 'Compiler output budget exceeded' }
        }
        $report.nativeArtifacts = @{ sources = $hashes; compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant(); executableSha256 = (Get-FileHash -LiteralPath $nativeExe -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $report.lifecycle = Invoke-OwnedHyperVSequence -Name $name -VmRoot $vmRoot -Command ${function:Invoke-CloudHyperVCommand} -NativeExe $nativeExe
}
catch {
    $text = $_.Exception.Message -replace '[\r\n]', ' '
    $report.failure = @{ message = $text.Substring(0, [Math]::Min(512, $text.Length)); category = $_.CategoryInfo.Category.ToString() }
}
finally {
    $report.diskAfter = @(Disks); $report.completedAt = [DateTime]::UtcNow.ToString('o')
    $json = $report | ConvertTo-Json -Depth 12
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 256KB) { throw 'Receipt budget exceeded' }
    [IO.File]::WriteAllText((Join-Path $evidence.FullName 'cloud-hyperv.json'), $json)
    if ($env:GITHUB_STEP_SUMMARY) {
        $passed = $null -ne $report.lifecycle -and $report.lifecycle.passed
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ("Cloud Hyper-V empty-firmware lifecycle passed: $passed. Guest boot and containment remain unqualified; launchAllowed=false.")
    }
}
if ($report.failure -or $null -eq $report.lifecycle -or !$report.lifecycle.passed) { exit 1 }
