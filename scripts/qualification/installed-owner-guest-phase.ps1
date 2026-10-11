Set-StrictMode -Version Latest

function Get-InstalledOwnerGuestPayloadLeaves {
    return @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe',
        'baseline/aegis-session.exe', 'native/installed-owner-actor.exe',
        'scripts/installation/ProtectedInstallFiles.cs', 'scripts/installation/ProtectedInstallService.cs',
        'scripts/installation/protected-install-files.ps1', 'scripts/installation/protected-install-transaction.ps1',
        'scripts/installation/protected-installation.ps1', 'scripts/qualification/installed-owner-phase.ps1',
        'scripts/qualification/installed-owner-guest-bootstrap.ps1', 'payload-manifest.json')
}

function Test-InstalledOwnerGuestResult($Value, [string]$ExpectedSourceSha, $ExpectedOs, $ExpectedPins) {
    try {
        if ($ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
            $Value.schemaVersion -isnot [int] -or $Value.schemaVersion -ne 1 -or
            $Value.kind -cne 'fixed-installed-owner-windows11' -or $Value.sourceSha -cne $ExpectedSourceSha -or
            $Value.passed -isnot [bool] -or !$Value.passed -or $null -ne $Value.failureStage -or
            $Value.inputPinsVerified -isnot [bool] -or !$Value.inputPinsVerified -or
            $Value.inputsHeldThroughClosure -isnot [bool] -or !$Value.inputsHeldThroughClosure) { return $false }
        foreach ($flag in @('completeE1', 'completeE11', 'launchAllowed')) {
            if ($Value.$flag -isnot [bool] -or $Value.$flag) { return $false }
        }
        if ($Value.os.caption -cne $ExpectedOs.caption -or $Value.os.version -cne $ExpectedOs.version -or
            $Value.os.build -cne $ExpectedOs.build -or $Value.os.architecture -cne '64-bit' -or
            $Value.os.caption -cnotmatch '^Microsoft Windows 11 ') { return $false }
        foreach ($field in @('caption', 'version', 'build', 'architecture')) {
            if ($Value.corpus.os.$field -cne $Value.os.$field) { return $false }
        }
        $leaves = @(Get-InstalledOwnerGuestPayloadLeaves)
        if (@($ExpectedPins).Count -ne $leaves.Count -or @($Value.corpus.inputHashes).Count -ne ($leaves.Count - 1)) { return $false }
        foreach ($relative in @($leaves | Where-Object { $_ -cne 'payload-manifest.json' })) {
            $pins = @($ExpectedPins | Where-Object { $_.relative -ceq $relative })
            $rows = @($Value.corpus.inputHashes | Where-Object { $_.path -ceq $relative })
            if ($pins.Count -ne 1 -or $rows.Count -ne 1 -or $rows[0].sha256 -cne $pins[0].sha256 -or
                ($rows[0].bytes -isnot [int] -and $rows[0].bytes -isnot [long]) -or $rows[0].bytes -ne $pins[0].bytes) { return $false }
        }
        return [bool](Test-InstalledOwnerQualificationReceipt $Value.corpus $ExpectedSourceSha 'windows11-guest')
    } catch { return $false }
}

function Invoke-InstalledOwnerGuestPhase([string]$Id, [string]$Name, [string]$VmRoot, [pscredential]$Credential,
    [string]$TransferRoot, [string]$ExpectedSourceSha, $FirstPhase, $ClaudePhase, $CancellationPhase, $StdioPhase, $OwnerPhase) {
    Assert-CloudGuestRunner
    $gate = Assert-CloudGuestOwnerLifetimePreviousClosures $FirstPhase $ClaudePhase $CancellationPhase $StdioPhase
    if ($OwnerPhase.passed -isnot [bool] -or !$OwnerPhase.passed -or
        !(Test-CloudGuestOwnerLifetimeResult $OwnerPhase.controls $gate.sid) -or
        $ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'installed-owner-guest-prior-closure-refused' }
    Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
    $expectedTransfer = 'D:\aegis-cloud-guest-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '\transfer'
    if (![IO.Path]::GetFullPath($TransferRoot).TrimEnd('\').Equals($expectedTransfer, [StringComparison]::OrdinalIgnoreCase)) { throw 'installed-owner-guest-input-refused' }
    $payload = Join-Path $TransferRoot 'installed-owner'
    $held = [Collections.Generic.List[IO.FileStream]]::new(); $pins = @(); $total = 0; $job = $null; $value = $null
    try {
        foreach ($relative in Get-InstalledOwnerGuestPayloadLeaves) {
            $path = Join-Path $payload ($relative.Replace('/', '\')); $file = Get-Item -LiteralPath $path -Force
            $cap = if ($relative.EndsWith('.exe')) { 4MB } else { 64KB }
            if ($file.PSIsContainer -or $file.Length -lt 1 -or $file.Length -gt $cap -or
                ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'installed-owner-guest-input-refused' }
            $cursor = $file.Directory
            while ($null -ne $cursor) {
                if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'installed-owner-guest-input-refused' }
                $cursor = $cursor.Parent
            }
            $stream = [IO.File]::Open($path, 'Open', 'Read', 'Read'); $held.Add($stream)
            if ($stream.Length -ne $file.Length) { throw 'installed-owner-guest-input-refused' }
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
            $pins += @{ relative = $relative; bytes = [int]$stream.Length; sha256 = $digest }
            $total += $stream.Length; if ($total -gt 16MB) { throw 'installed-owner-guest-input-refused' }
        }
        $pinsJson = $pins | ConvertTo-Json -Depth 3 -Compress
        if ([Text.Encoding]::UTF8.GetByteCount($pinsJson) -gt 16KB) { throw 'installed-owner-guest-input-refused' }
        $invocation = (Get-InstalledOwnerGuestInvocation).ToString()
        $job = Start-Job -ArgumentList $Id, $Credential, $payload, $pinsJson, $ExpectedSourceSha, $invocation -ScriptBlock {
            param($Id, $Credential, $Payload, $PinsJson, $SourceSha, $Invocation)
            $ErrorActionPreference = 'Stop'; $session = $null
            try {
                $session = New-PSSession -VMId ([guid]$Id) -Credential $Credential -ErrorAction Stop
                Invoke-Command -Session $session -ScriptBlock {
                    $ErrorActionPreference = 'Stop'; $root = 'C:\ProgramData\AegisCloudLab\installed-owner-inputs'
                    if (Test-Path -LiteralPath $root) { throw 'installed-owner-guest-transfer-refused' }
                    $cursor = Get-Item -LiteralPath 'C:\ProgramData\AegisCloudLab' -Force
                    while ($null -ne $cursor) {
                        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'installed-owner-guest-transfer-refused' }
                        $cursor = $cursor.Parent
                    }
                    New-Item -ItemType Directory -Path $root | Out-Null
                    $acl = [Security.AccessControl.DirectorySecurity]::new()
                    $acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
                    Set-Acl -LiteralPath $root -AclObject $acl
                    foreach ($leaf in @('binaries', 'baseline', 'native', 'scripts', 'scripts\installation', 'scripts\qualification')) {
                        New-Item -ItemType Directory -Path (Join-Path $root $leaf) | Out-Null
                    }
                } | Out-Null
                foreach ($pin in @($PinsJson | ConvertFrom-Json)) {
                    Copy-Item -LiteralPath (Join-Path $Payload ($pin.relative.Replace('/', '\'))) -ToSession $session -Destination (
                        Join-Path 'C:\ProgramData\AegisCloudLab\installed-owner-inputs' ($pin.relative.Replace('/', '\')))
                }
                Invoke-Command -Session $session -ArgumentList $PinsJson, $SourceSha -ScriptBlock ([scriptblock]::Create($Invocation))
            } finally { if ($null -ne $session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }
        }
        if ($null -eq (Wait-Job -Job $job -Timeout 180)) { throw 'installed-owner-guest-observation-unknown' }
        $values = @(Receive-Job -Job $job -ErrorAction Stop)
        if ($job.State -cne 'Completed' -or $values.Count -ne 1) { throw 'installed-owner-guest-observation-unknown' }
        $value = $values[0]
        if ([Text.Encoding]::UTF8.GetByteCount(($value | ConvertTo-Json -Depth 18 -Compress)) -gt 96KB -or
            !(Test-InstalledOwnerGuestResult $value $ExpectedSourceSha $FirstPhase.guestResult.guest $pins)) { throw 'installed-owner-guest-result-refused' }
        Get-CloudHostRouteSnapshot $Id $Name $VmRoot | Out-Null
        foreach ($at in 0..($held.Count - 1)) {
            $stream = $held[$at]; $stream.Position = 0; $hash = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
            if ($stream.Length -ne $pins[$at].bytes -or $digest -cne $pins[$at].sha256) { throw 'installed-owner-guest-input-refused' }
        }
        return @{ passed = $true; kind = 'installed-owner-guest-phase'; controls = $value; payloadPins = $pins;
            payloadHeldThroughClosure = $true; ordering = $gate; completeE1 = $false; completeE11 = $false; launchAllowed = $false }
    } catch { return @{ passed = $false; kind = 'installed-owner-guest-phase'; controls = $value;
        failure = 'installed-owner-guest-unavailable-or-refused'; payloadHeldThroughClosure = $false;
        completeE1 = $false; completeE11 = $false; launchAllowed = $false } }
    finally {
        if ($null -ne $job) {
            if ($job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $job -ErrorAction SilentlyContinue }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
        foreach ($stream in $held) { $stream.Dispose() }
    }
}

function Get-InstalledOwnerGuestInvocation {
    return {
        param($PinsJson, $SourceSha)
        $ErrorActionPreference = 'Stop'; $root = 'C:\ProgramData\AegisCloudLab\installed-owner-inputs'
        $pins = @($PinsJson | ConvertFrom-Json)
        $expected = @($pins | Where-Object relative -CEQ 'scripts/qualification/installed-owner-guest-bootstrap.ps1')
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'installed-owner-guest-bootstrap-refused' }
        $path = Join-Path $root 'scripts\qualification\installed-owner-guest-bootstrap.ps1'
        $file = Get-Item -LiteralPath $path -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 64KB) { throw 'installed-owner-guest-bootstrap-refused' }
        $held = [IO.File]::Open($path, 'Open', 'Read', 'Read')
        try {
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($hash.ComputeHash($held)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
            if ($held.Length -ne $expected[0].bytes -or $digest -cne $expected[0].sha256) { throw 'installed-owner-guest-bootstrap-refused' }
            $held.Position = 0
            $reader = [IO.StreamReader]::new($held, [Text.UTF8Encoding]::new($false, $true), $false, 1024, $true)
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $env:AEGIS_CLOUD_GUEST_LAB = 'trusted-bootstrap-v1'; $env:GITHUB_ACTIONS = 'true'
            $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:RUNNER_OS = 'Windows'
            & ([scriptblock]::Create($text)) -ExpectedSourceSha $SourceSha -ExpectedPinsJson $PinsJson
        } finally { $held.Dispose() }
    }
}
