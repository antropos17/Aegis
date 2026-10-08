param([Parameter(Mandatory = $true)][string]$TaskPassword, [Parameter(Mandatory = $true)][string]$ExpectedSid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$result = @{ schemaVersion = 1; kind = 'fixed-cloud-cancellation'; passed = $false; before = $null; after = $null;
    payloadAbsentBeforeRelease = $false; payloadObservedAfterRelease = $false; newReceiversStarted = $false;
    failureStage = $null; e2Qualified = $false; e3Qualified = $false; launchAllowed = $false }
$stage = 'scope'
try {
    if ($env:AEGIS_CLOUD_GUEST_LAB -cne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        $ExpectedSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'cancellation-refused' }
    if (!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'cancellation-refused' }
    $trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $project = 'C:\AegisLab\work\cancellation'; $marker = "$project\released.txt"
    $account = Get-LocalUser -Name AegisTask
    if (!$account.Enabled -or $account.SID.Value -cne $ExpectedSid -or @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object SID -eq $account.SID).Count) { throw 'cancellation-refused' }
    $stage = 'fixed-inputs'
    foreach ($path in @($trusted, 'C:\AegisLab\work')) {
        $entry = Get-Item -LiteralPath $path -Force
        while ($null -ne $entry) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cancellation-refused' }; $entry = $entry.Parent }
    }
    if (Test-Path -LiteralPath $project) { throw 'cancellation-refused' }
    $manifestFile = Get-Item -LiteralPath "$trusted\manifest.json" -Force
    if ($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $manifestFile.Length -gt 64KB) { throw 'cancellation-refused' }
    $manifest = [IO.File]::ReadAllText($manifestFile.FullName) | ConvertFrom-Json
    foreach ($leaf in @('node.exe', 'guest-process.dll', 'cloud-cancellation-runtime.cjs', 'cloud-cancellation-task.cjs', 'cloud-cancellation-child.cjs')) {
        $expected = @($manifest.files | Where-Object name -CEQ $leaf)
        $file = Get-Item -LiteralPath (Join-Path $trusted $leaf) -Force
        $cap = if ($leaf -ceq 'node.exe') { 256MB } elseif ($leaf -ceq 'guest-process.dll') { 80KB } else { 64KB }
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.PSIsContainer -or
            $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt $cap -or
            (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected[0].sha256) { throw 'cancellation-refused' }
    }
    New-Item -ItemType Directory -Path $project | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($account.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')); Set-Acl -LiteralPath $project -AclObject $acl
    $stage = 'loader'; Add-Type -Path "$trusted\guest-process.dll"
    $loader = [CloudGuestLoaderProbe]::QualifyDocumentedForNewOwner($TaskPassword, $ExpectedSid)
    if ($loader.passed -isnot [bool] -or !$loader.passed) { throw 'cancellation-refused' }
    $stage = 'before-release'; $result.before = [CloudGuestCancellation]::BeforeRelease($TaskPassword, $ExpectedSid)
    $result.payloadAbsentBeforeRelease = !(Test-Path -LiteralPath $marker)
    if ($result.before.passed -isnot [bool] -or !$result.before.passed -or !$result.payloadAbsentBeforeRelease) { throw 'cancellation-refused' }
    $stage = 'after-release'; $result.after = [CloudGuestCancellation]::AfterRelease($TaskPassword, $ExpectedSid)
    if ($result.after.passed -isnot [bool] -or !$result.after.passed) { throw 'cancellation-refused' }
    $file = Get-Item -LiteralPath $marker -Force
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -ne 26) { throw 'cancellation-refused' }
    $result.payloadObservedAfterRelease = [IO.File]::ReadAllText($file.FullName) -ceq 'fixed-cancellation-payload'
    $result.passed = $result.payloadObservedAfterRelease
} catch { $result.failureStage = $stage; $result.passed = $false }
return $result
