param([Parameter(Mandatory = $true)][string]$TaskPassword, [Parameter(Mandatory = $true)][string]$ExpectedSid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$result = @{ schemaVersion = 1; kind = 'fixed-cloud-owner-lifetime'; passed = $false; native = $null; controls = $null;
    failureStage = $null; newReceiversStarted = $false; inputPinsVerified = $false; inputsHeldThroughClosure = $false;
    e2Qualified = $false; e3Qualified = $false; e6Qualified = $false; acceptancePassed = $false; launchAllowed = $false; fullE33Accepted = $false }
$held = [Collections.Generic.List[IO.FileStream]]::new(); $stage = 'scope'
function Read-CloudGuestOwnerLifetimeManifestUtf8([IO.FileStream]$Stream) {
    $bytes = New-Object byte[] (64KB + 1); $count = 0
    while ($count -lt $bytes.Length) {
        $read = $Stream.Read($bytes, $count, $bytes.Length - $count)
        if ($read -eq 0) { break }; $count += $read
    }
    if ($count -gt 64KB) { throw 'owner-lifetime-refused' }
    $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, 0, $count)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { return $text.Substring(1) }
    return $text
}
try {
    if ($env:AEGIS_CLOUD_GUEST_LAB -cne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        !([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'owner-lifetime-refused' }
    $account = Get-LocalUser -Name AegisTask
    if (!$account.Enabled -or $account.SID.Value -cne $ExpectedSid -or
        @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $account.SID).Count) { throw 'owner-lifetime-refused' }
    $trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $stage = 'fixed-inputs'
    foreach ($path in @($trusted, 'C:\AegisLab\work')) {
        $entry = Get-Item -LiteralPath $path -Force
        while ($null -ne $entry) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner-lifetime-refused' }; $entry = $entry.Parent }
    }
    $manifestFile = Get-Item -LiteralPath "$trusted\manifest.json" -Force
    if ($manifestFile.PSIsContainer -or ($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $manifestFile.Length -gt 64KB) { throw 'owner-lifetime-refused' }
    $manifestStream = [IO.File]::Open($manifestFile.FullName, 'Open', 'Read', 'Read'); $held.Add($manifestStream)
    $manifest = Read-CloudGuestOwnerLifetimeManifestUtf8 $manifestStream | ConvertFrom-Json
    $inputBytes = @{}
    foreach ($leaf in @('node.exe', 'guest-process.dll', 'guest-owner-lifetime.exe', 'cloud-owner-lifetime-runtime.cjs',
        'cloud-owner-lifetime-task.cjs', 'owner-lifetime-fixed-task.cjs', 'cloud-guest-owner-lifetime-reader.ps1')) {
        $expected = @($manifest.files | Where-Object name -CEQ $leaf)
        $file = Get-Item -LiteralPath (Join-Path $trusted $leaf) -Force
        $cap = if ($leaf -ceq 'node.exe') { 256MB } elseif ($leaf -ceq 'guest-process.dll') { 80KB } else { 64KB }
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.PSIsContainer -or
            ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt $cap) { throw 'owner-lifetime-refused' }
        $stream = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read'); $held.Add($stream)
        if ($stream.Length -ne $file.Length) { throw 'owner-lifetime-refused' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($actual -cne $expected[0].sha256) { throw 'owner-lifetime-refused' }
        $inputBytes[$leaf] = $stream.Length
        if ($leaf -ceq 'cloud-guest-owner-lifetime-reader.ps1') {
            $stream.Position = 0; $sourceReader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false, $true), $false, 1024, $true)
            try { $readerSource = $sourceReader.ReadToEnd() } finally { $sourceReader.Dispose() }
        }
    }
    . ([scriptblock]::Create($readerSource))
    $result.inputPinsVerified = $true; $result.inputBytes = $inputBytes
    $stage = 'loader'; Add-Type -Path "$trusted\guest-process.dll"
    $loader = [CloudGuestLoaderProbe]::QualifyDocumentedForNewOwner($TaskPassword, $ExpectedSid)
    if ($loader.passed -isnot [bool] -or !$loader.passed) { throw 'owner-lifetime-refused' }
    $stage = 'native-owner-lifetime'; $native = [CloudGuestProcess]::RunOwnerLifetime($TaskPassword, $ExpectedSid); $result.native = $native
    Assert-CloudGuestOwnerLifetimeOuterClosure $native $ExpectedSid
    foreach ($flag in @('privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure', 'ownerNodeVersionPassed')) {
        if ($native[$flag] -isnot [bool] -or !$native[$flag]) { throw 'owner-lifetime-refused' }
    }
    foreach ($flag in @('administratorGroupPresent', 'administratorEnabled', 'elevated', 'acceptancePassed', 'e6Qualified', 'launchAllowed')) {
        if ($native[$flag] -isnot [bool] -or $native[$flag]) { throw 'owner-lifetime-refused' }
    }
    if ($native.verificationKind -cne 'fixed-owner-lifetime-runtime') { throw 'owner-lifetime-refused' }
    $result.inputsHeldThroughClosure = $true
    $stage = 'closed-result'; $result.controls = Read-CloudGuestOwnerLifetimeAfterClosure $native 'C:\AegisLab\work\owner-lifetime-result.jsonl' $ExpectedSid -RequireStandardPrincipal
    $result.passed = $result.controls.passed -is [bool] -and $result.controls.passed
} catch {
    $result.failureStage = $stage; $result.passed = $false
    if ($null -eq $result.native -and $stage -ceq 'native-owner-lifetime') {
        try { $result.native = [CloudGuestProcess]::FailureReceipt($_.Exception) } catch { }
    }
} finally { foreach ($stream in $held) { $stream.Dispose() } }
return $result
