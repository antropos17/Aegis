param([Parameter(Mandatory = $true)][string]$ExpectedSourceSha,
    [Parameter(Mandatory = $true)][string]$ExpectedPinsJson)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Get-InstalledOwnerPinnedModule([string]$Text, [string]$Path, [string[]]$Dependencies) {
    # The caller has already held and hashed this exact input. Resolve its known
    # dependency imports from the same pinned set, retaining lexical file paths.
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($Text, $Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'installed-owner-guest-module-refused' }
    $imports = @($ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.CommandAst] -and $node.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot
    }, $true))
    if ($imports.Count -ne $Dependencies.Count) { throw 'installed-owner-guest-module-refused' }
    foreach ($dependency in $Dependencies) {
        $expected = '. (Join-Path $PSScriptRoot ' + "'" + $dependency + "')"
        $matched = @($imports | Where-Object { $_.Extent.Text -ceq $expected })
        if ($matched.Count -ne 1) { throw 'installed-owner-guest-module-refused' }
        $Text = $Text.Replace($expected, (' ' * $expected.Length))
    }
    $ast = [Management.Automation.Language.Parser]::ParseInput($Text, $Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'installed-owner-guest-module-refused' }
    return $ast.GetScriptBlock()
}
$root = 'C:\ProgramData\AegisCloudLab\installed-owner-inputs'
$scratch = 'C:\AegisLab\installed-owner'
$held = [Collections.Generic.List[IO.FileStream]]::new()
$stage = 'scope'
$result = @{ schemaVersion = 1; kind = 'fixed-installed-owner-windows11'; passed = $false;
    inputPinsVerified = $false; inputsHeldThroughClosure = $false; sourceSha = $ExpectedSourceSha;
    os = $null; corpus = $null; failureStage = $null; failureDetail = $null; completeE1 = $false; completeE11 = $false; launchAllowed = $false }
$oldTemp = $env:TEMP; $oldTmp = $env:TMP
try {
    if ($ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or [Text.Encoding]::UTF8.GetByteCount($ExpectedPinsJson) -gt 16KB -or
        $env:AEGIS_CLOUD_GUEST_LAB -cne 'trusted-bootstrap-v1' -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        !([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'installed-owner-guest-refused' }
    $pins = ConvertFrom-Json -InputObject $ExpectedPinsJson
    $leaves = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe',
        'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
        'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs', 'scripts/installation/ProtectedInstallDisk.cs',
        'scripts/installation/protected-install-files.ps1', 'scripts/installation/protected-install-transaction.ps1',
        'scripts/installation/protected-vm-provider.ps1', 'scripts/installation/protected-vm.ps1',
        'scripts/installation/protected-installation.ps1', 'scripts/qualification/installed-owner-phase.ps1',
        'scripts/qualification/installed-owner-guest-bootstrap.ps1', 'payload-manifest.json')
    if ($pins.Count -ne $leaves.Count -or @($pins.relative | Select-Object -Unique).Count -ne $pins.Count) { throw 'installed-owner-guest-refused' }
    $total = 0
    $stage = 'fixed-inputs'
    foreach ($pin in $pins) {
        if ($leaves -cnotcontains $pin.relative) { throw 'installed-owner-guest-refused' }
        $cap = if ($pin.relative.EndsWith('.exe')) { 4MB } else { 64KB }
        if ($pin.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $pin.bytes -isnot [int] -or $pin.bytes -le 0 -or $pin.bytes -gt $cap) { throw 'installed-owner-guest-refused' }
        $total += $pin.bytes; if ($total -gt 16MB) { throw 'installed-owner-guest-refused' }
        $path = Join-Path $root ($pin.relative.Replace('/', '\'))
        $file = Get-Item -LiteralPath $path -Force
        if ($file.PSIsContainer -or $file.Length -ne $pin.bytes -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'installed-owner-guest-refused' }
        $cursor = $file.Directory
        while ($null -ne $cursor) {
            if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'installed-owner-guest-refused' }
            $cursor = $cursor.Parent
        }
        $stream = [IO.File]::Open($path, 'Open', 'Read', 'Read'); $held.Add($stream)
        if ($stream.Length -ne $pin.bytes) { throw 'installed-owner-guest-refused' }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($actual -cne $pin.sha256) { throw 'installed-owner-guest-refused' }
    }
    $result.inputPinsVerified = $true
    $stage = 'windows11-observation'
    $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
    if ($os.Caption -cnotmatch '^Microsoft Windows 11 ' -or $os.Version -cnotmatch '^10\.0\.[0-9]+$' -or
        $os.BuildNumber -cnotmatch '^[0-9]{5}$' -or $os.OSArchitecture -cne '64-bit') { throw 'installed-owner-guest-refused' }
    $result.os = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture }
    $stage = 'scratch'
    $temp = 'C:\AegisLab\installed-owner-temp'
    if ((Test-Path -LiteralPath $scratch) -or (Test-Path -LiteralPath $temp)) { throw 'installed-owner-guest-refused' }
    $parent = Get-Item -LiteralPath 'C:\AegisLab' -Force
    while ($null -ne $parent) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'installed-owner-guest-refused' }
        $parent = $parent.Parent
    }
    New-Item -ItemType Directory -Path $temp | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    Set-Acl -LiteralPath $temp -AclObject $acl
    $env:TEMP = $temp; $env:TMP = $temp
    $stage = 'maintained-corpus'
    $modules = @(
        @{ relative = 'scripts/installation/protected-install-files.ps1'; dependencies = @() },
        @{ relative = 'scripts/installation/protected-install-transaction.ps1'; dependencies = @() },
        @{ relative = 'scripts/installation/protected-vm-provider.ps1'; dependencies = @() },
        @{ relative = 'scripts/installation/protected-vm.ps1'; dependencies = @() },
        @{ relative = 'scripts/installation/protected-installation.ps1'; dependencies = @('protected-install-files.ps1', 'protected-install-transaction.ps1', 'protected-vm-provider.ps1', 'protected-vm.ps1') },
        @{ relative = 'scripts/qualification/installed-owner-phase.ps1'; dependencies = @('../installation/protected-installation.ps1') }
    )
    foreach ($module in $modules) {
        $index = @($pins.relative).IndexOf($module.relative)
        if ($index -lt 0) { throw 'installed-owner-guest-module-refused' }
        $stream = $held[$index]; $stream.Position = 0
        $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false, $true), $false, 1024, $true)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $block = Get-InstalledOwnerPinnedModule $text (Join-Path $root $module.relative) $module.dependencies
        . $block
    }
    $value = Invoke-InstalledOwnerQualification -PayloadRoot $root -ScratchRoot $scratch -ExpectedSourceSha $ExpectedSourceSha -Location 'windows11-guest'
    # Preserve the bounded trusted producer's refusal/cleanup observations too.
    # Publication is diagnostic only; the full predicate still controls success.
    $result.corpus = $value
    if (!(Test-InstalledOwnerQualificationReceipt $value $ExpectedSourceSha 'windows11-guest')) { throw 'installed-owner-guest-refused' }
    $stage = 'held-input-recheck'
    foreach ($at in 0..($pins.Count - 1)) {
        $stream = $held[$at]; $stream.Position = 0
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($stream.Length -ne $pins[$at].bytes -or $actual -cne $pins[$at].sha256) { throw 'installed-owner-guest-refused' }
    }
    $result.inputsHeldThroughClosure = $true; $result.passed = $true
} catch {
    $result.failureStage = $stage; $result.passed = $false
    if ($stage -ceq 'maintained-corpus' -and (Get-Command Get-ProtectedInstallFailure -ErrorAction SilentlyContinue)) {
        $result.failureDetail = Get-ProtectedInstallFailure $_ 'qualification'
    }
}
finally {
    $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    foreach ($stream in $held) { $stream.Dispose() }
}
if ([Text.Encoding]::UTF8.GetByteCount(($result | ConvertTo-Json -Depth 18 -Compress)) -gt 96KB) { throw 'installed-owner-guest-receipt-budget' }
return $result
