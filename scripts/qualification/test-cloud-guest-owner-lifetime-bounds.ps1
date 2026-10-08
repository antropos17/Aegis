param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetFullPath($env:TEMP)) 'aegis-owner-lifetime'),
    [switch]$InboxChild)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $WorkRoot)) { New-Item -ItemType Directory -Path $WorkRoot | Out-Null }
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1')
$base = [IO.Path]::GetFullPath($WorkRoot)
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($base))
if ($drive.AvailableFreeSpace -lt 512MB) { throw 'owner-lifetime-disk-headroom-refused' }
$ancestor = Get-Item -LiteralPath $base -Force
while ($null -ne $ancestor) { if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner-lifetime-temp-reparse-refused' }; $ancestor = $ancestor.Parent }
$fixture = Join-Path $base ('owner-lifetime-bounds-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$previousTemp = $env:TEMP; $previousTmp = $env:TMP; $env:TEMP = $fixture; $env:TMP = $fixture
$sourceRoot = $PSScriptRoot
$readerPath = Join-Path $sourceRoot 'cloud-guest-owner-lifetime-reader.ps1'
$bootstrapPath = Join-Path $sourceRoot 'cloud-guest-owner-lifetime-bootstrap.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($readerPath, [ref]$null, [ref]$null)
$boundedDefinitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Read-CloudGuestOwnerLifetimeBoundedUtf8' }, $true))
$bootstrapAst = [Management.Automation.Language.Parser]::ParseFile($bootstrapPath, [ref]$null, [ref]$null)
$manifestDefinitions = @($bootstrapAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Read-CloudGuestOwnerLifetimeManifestUtf8' }, $true))
if ($boundedDefinitions.Count -ne 1 -or $manifestDefinitions.Count -ne 1) { throw 'owner-lifetime-bound-source-seam-refused' }
. ([scriptblock]::Create($manifestDefinitions[0].Extent.Text))
$readerMutant = $boundedDefinitions[0].Extent.Text.Replace("    if (`$count -gt `$MaximumBytes) { throw 'fixed-owner-lifetime-receipt-refused' }", '')
$manifestMutant = $manifestDefinitions[0].Extent.Text.Replace("    if (`$count -gt 64KB) { throw 'owner-lifetime-refused' }", '')
if ($readerMutant -ceq $boundedDefinitions[0].Extent.Text -or $manifestMutant -ceq $manifestDefinitions[0].Extent.Text) { throw 'owner-lifetime-bound-mutant-seam-refused' }
$fixtureRoot = Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-owner-lifetime'
# Inert historical receipt bytes test reader shape; they supply no current native or guest observation.
$validPath = Join-Path $fixtureRoot 'reader-cases.jsonl'
if (!(Test-Path -LiteralPath $validPath)) { throw 'owner-lifetime-retained-receipt-required' }
$records = [IO.File]::ReadAllLines($validPath)
if ($records.Count -ne 2) { throw 'owner-lifetime-bound-receipt-seam-refused' }
$validText = $records -join "`n"
$sid = ($records[0] | ConvertFrom-Json).sid
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$receiptPath = Join-Path $fixture 'receipt.jsonl'; $manifestPath = Join-Path $fixture 'manifest.json'
$readerControls = 0; $manifestControls = 0; $mutantControls = 0
try {
    foreach ($budget in @((16KB - 1), 16KB)) {
        [IO.File]::WriteAllText($receiptPath, $validText + (' ' * ($budget - $utf8.GetByteCount($validText))), $utf8)
        $value = Read-CloudGuestOwnerLifetimeReceipt $receiptPath $sid
        if (!$value.passed) { throw 'owner-lifetime-valid-boundary-receipt-refused' }; $readerControls++
    }
    $withBom = [string][char]0xFEFF + $validText
    [IO.File]::WriteAllText($receiptPath, $withBom + (' ' * (16KB - $utf8.GetByteCount($withBom))), $utf8)
    if (!(Read-CloudGuestOwnerLifetimeReceipt $receiptPath $sid).passed) { throw 'owner-lifetime-utf8-bom-at-byte-cap-refused' }; $readerControls++
    # FileInfo really is captured while this owned fixture is small, then the same file grows.
    [IO.File]::WriteAllText($receiptPath, $validText, $utf8)
    $stale = Get-Item -LiteralPath $receiptPath -Force; $staleBytes = $stale.Length
    [IO.File]::WriteAllText($receiptPath, $validText + (' ' * (16KB + 1 - $utf8.GetByteCount($validText))), $utf8)
    if ($stale.Length -ne $staleBytes -or ([IO.FileInfo]::new($receiptPath)).Length -ne 16KB + 1) { throw 'owner-lifetime-stale-metadata-fixture-refused' }
    & {
        param($Stale, $Path, $Sid)
        function Get-Item { param($LiteralPath, [switch]$Force, $ErrorAction) return $Stale }
        $refused = $false
        try { Read-CloudGuestOwnerLifetimeReceipt $Path $Sid | Out-Null }
        catch { $refused = $_.Exception.Message -ceq 'fixed-owner-lifetime-receipt-refused' }
        if (!$refused) { throw 'owner-lifetime-stale-metadata-read-accepted' }
    } $stale $receiptPath $sid
    $readerControls++
    # A cap-removal mutant accepts the same concrete over-budget UTF-8 file.
    & {
        param($Stale, $Path, $Sid, $Mutant)
        function Get-Item { param($LiteralPath, [switch]$Force, $ErrorAction) return $Stale }
        . ([scriptblock]::Create($Mutant))
        if (!(Read-CloudGuestOwnerLifetimeReceipt $Path $Sid).passed) { throw 'owner-lifetime-reader-mutant-not-exposed' }
    } $stale $receiptPath $sid $readerMutant
    $mutantControls++
    # Reproduce the actual R1 stale-metadata gap with its immutable original function.
    $priorAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $fixtureRoot 'UnboundedReceiptReader.ps1'), [ref]$null, [ref]$null)
    $priorDefinitions = @($priorAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq 'Read-CloudGuestOwnerLifetimeReceipt' }, $true))
    if ($priorDefinitions.Count -ne 1) { throw 'owner-lifetime-prior-bound-seam-refused' }
    & {
        param($Stale, $Path, $Sid, $Definition)
        function Get-Item { param($LiteralPath, [switch]$Force, $ErrorAction) return $Stale }
        . ([scriptblock]::Create($Definition))
        if (!(Read-CloudGuestOwnerLifetimeReceipt $Path $Sid).passed) { throw 'owner-lifetime-r1-regression-not-reproduced' }
    } $stale $receiptPath $sid $priorDefinitions[0].Extent.Text
    $mutantControls++
    foreach ($bytes in @([byte[]](0xff, 0xfe, 0x00), [byte[]](0xc3, 0x28))) {
        [IO.File]::WriteAllBytes($receiptPath, $bytes)
        $refused = $false; try { Read-CloudGuestOwnerLifetimeReceipt $receiptPath $sid | Out-Null } catch { $refused = $true }
        if (!$refused) { throw 'owner-lifetime-invalid-utf8-receipt-accepted' }; $readerControls++
    }
    [IO.File]::WriteAllText($receiptPath, $validText + "`n{}", $utf8)
    $refused = $false; try { Read-CloudGuestOwnerLifetimeReceipt $receiptPath $sid | Out-Null } catch { $refused = $true }
    if (!$refused) { throw 'owner-lifetime-third-line-accepted' }; $readerControls++
    $unicodeLine = $records[0].Substring(0, $records[0].Length - 1) + ',"padding":"' + ([string][char]0xe9 * 8192) + '"}'
    [IO.File]::WriteAllText($receiptPath, $unicodeLine + "`n" + $records[1], $utf8)
    $refused = $false; try { Read-CloudGuestOwnerLifetimeReceipt $receiptPath $sid | Out-Null } catch { $refused = $true }
    if (!$refused -or ([IO.FileInfo]::new($receiptPath)).Length -le 16KB) { throw 'owner-lifetime-byte-versus-character-bound-lost' }; $readerControls++
    # Real held reads prove the byte consumption ceiling and denial of concurrent writers.
    [IO.File]::WriteAllText($manifestPath, '{"files":[]}' + (' ' * (64KB + 32)), $utf8)
    $stream = [IO.File]::Open($manifestPath, 'Open', 'Read', 'Read')
    try {
        $refused = $false; try { Read-CloudGuestOwnerLifetimeManifestUtf8 $stream | Out-Null } catch { $refused = $_.Exception.Message -ceq 'owner-lifetime-refused' }
        if (!$refused -or $stream.Position -ne 64KB + 1) { throw 'owner-lifetime-held-manifest-budget-lost' }; $manifestControls++
        $refused = $false; try { $writer = [IO.File]::Open($manifestPath, 'Open', 'Write', 'ReadWrite'); $writer.Dispose() } catch [IO.IOException] { $refused = $true }
        if (!$refused) { throw 'owner-lifetime-held-manifest-write-accepted' }; $manifestControls++
        $stream.Position = 0
        $refused = $false; try { Read-CloudGuestOwnerLifetimeBoundedUtf8 $stream 16KB | Out-Null } catch { $refused = $_.Exception.Message -ceq 'fixed-owner-lifetime-receipt-refused' }
        if (!$refused -or $stream.Position -ne 16KB + 1) { throw 'owner-lifetime-held-receipt-budget-lost' }; $readerControls++
    } finally { $stream.Dispose() }
    foreach ($budget in @((64KB - 1), 64KB, (64KB + 1))) {
        $text = '{"files":[]}'
        [IO.File]::WriteAllText($manifestPath, $text + (' ' * ($budget - $utf8.GetByteCount($text))), $utf8)
        $stream = [IO.File]::Open($manifestPath, 'Open', 'Read', 'Read')
        try {
            $refused = $false; try { $value = Read-CloudGuestOwnerLifetimeManifestUtf8 $stream | ConvertFrom-Json } catch { $refused = $true }
            if (($budget -gt 64KB) -ne $refused -or (!$refused -and $value.files.Count -ne 0)) { throw 'owner-lifetime-manifest-boundary-lost' }; $manifestControls++
        } finally { $stream.Dispose() }
    }
    & {
        param($Path, $Mutant)
        . ([scriptblock]::Create($Mutant))
        $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read')
        try { if ((Read-CloudGuestOwnerLifetimeManifestUtf8 $stream | ConvertFrom-Json).files.Count -ne 0) { throw 'owner-lifetime-manifest-mutant-not-exposed' } }
        finally { $stream.Dispose() }
    } $manifestPath $manifestMutant
    $mutantControls++
    $withBom = [string][char]0xFEFF + '{"files":[]}'
    [IO.File]::WriteAllText($manifestPath, $withBom + (' ' * (64KB - $utf8.GetByteCount($withBom))), $utf8)
    $stream = [IO.File]::Open($manifestPath, 'Open', 'Read', 'Read')
    try { if ((Read-CloudGuestOwnerLifetimeManifestUtf8 $stream | ConvertFrom-Json).files.Count -ne 0) { throw 'owner-lifetime-utf8-manifest-bom-at-byte-cap-refused' }; $manifestControls++ }
    finally { $stream.Dispose() }
    # Execute the real bootstrap manifest statements with a stale pre-open FileInfo.
    $currentBootstrap = [IO.File]::ReadAllText($bootstrapPath)
    $priorBootstrap = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'UnboundedManifestRead.ps1')) + '$inputBytes = @{}'
    $start = '$manifestFile = '; $end = '$inputBytes = @{}'
    $blocks = @()
    foreach ($source in @($currentBootstrap, $priorBootstrap)) {
        if ($source.Split(@($start), [StringSplitOptions]::None).Count -ne 2 -or $source.Split(@($end), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-bootstrap-manifest-seam-refused' }
        $blocks += $source.Substring($source.IndexOf($start), $source.IndexOf($end) - $source.IndexOf($start))
    }
    [IO.File]::WriteAllText($manifestPath, '{"files":[]}', $utf8)
    $staleManifest = Get-Item -LiteralPath $manifestPath -Force; $cachedLength = $staleManifest.Length
    [IO.File]::WriteAllText($manifestPath, '{"files":[]}' + (' ' * (64KB + 1 - 12)), $utf8)
    if ($staleManifest.Length -ne $cachedLength) { throw 'owner-lifetime-manifest-stale-metadata-fixture-refused' }
    foreach ($index in 0..1) {
        & {
            param($Stale, $Trusted, $Block, $Prior)
            function Get-Item { param($LiteralPath, [switch]$Force) return $Stale }
            $trusted = $Trusted; $held = [Collections.Generic.List[IO.FileStream]]::new()
            try {
                $refused = $false; try { . ([scriptblock]::Create($Block)) } catch { $refused = $_.Exception.Message -ceq 'owner-lifetime-refused' }
                if ($Prior) {
                    if ($refused -or $manifest.files.Count -ne 0 -or $held[0].Position -le 64KB) { throw 'owner-lifetime-r1-manifest-regression-not-reproduced' }
                } elseif (!$refused) { throw 'owner-lifetime-current-manifest-stale-metadata-accepted' }
            } finally { foreach ($stream in $held) { $stream.Dispose() } }
        } $staleManifest $fixture $blocks[$index] ($index -eq 1)
    }
    $manifestControls++; $mutantControls++
    [IO.File]::WriteAllBytes($manifestPath, [byte[]](0xc3, 0x28))
    $stream = [IO.File]::Open($manifestPath, 'Open', 'Read', 'Read')
    try { $refused = $false; try { Read-CloudGuestOwnerLifetimeManifestUtf8 $stream | Out-Null } catch { $refused = $true }; if (!$refused) { throw 'owner-lifetime-invalid-utf8-manifest-accepted' }; $manifestControls++ }
    finally { $stream.Dispose() }
    if (!$InboxChild) {
        . (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
        $inbox = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $out = Join-Path $fixture 'inbox-bounds.stdout'; $err = Join-Path $fixture 'inbox-bounds.stderr'
        $code = Invoke-CloudGuestNativeProcess $inbox @('-NoProfile', '-NonInteractive', '-File', ('"' + $PSCommandPath + '"'),
            '-ProjectRoot', ('"' + $ProjectRoot + '"'), '-WorkRoot', ('"' + $base + '"'), '-InboxChild') $out $err 10000
        if ($code -ne 0 -or (Get-Item -LiteralPath $err).Length -ne 0 -or [IO.File]::ReadAllText($out) -notmatch 'bounded-owner-lifetime-reader-controls:9') {
            Get-Content -LiteralPath $err -TotalCount 10; throw 'owner-lifetime-inbox-bounds-refused'
        }
    }
    $hashes = @{}
    foreach ($path in @($readerPath, $bootstrapPath, $PSCommandPath)) {
        $stream = [IO.File]::Open($path, 'Open', 'Read', 'Read'); $sha = [Security.Cryptography.SHA256]::Create()
        try { $hashes[$path] = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
        finally { $sha.Dispose(); $stream.Dispose() }
    }
    $leaf = if ($InboxChild) { 'bounds-inbox-evidence.json' } else { 'bounds-evidence.json' }
    @{ evidence = 'actual-disposable-held-stream-bounds-and-stale-metadata'; readerControls = $readerControls; manifestControls = $manifestControls;
        capRemovalAndPriorRegressionControls = $mutantControls; powershellVersion = $PSVersionTable.PSVersion.ToString(); sourceHashes = $hashes;
        retainedFixture = $fixture; observedAtUtc = [DateTime]::UtcNow.ToString('o'); launchAllowed = $false; fullE33Accepted = $false } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $WorkRoot $leaf) -Encoding utf8
    Write-Output ('bounded-owner-lifetime-reader-controls:' + $readerControls)
    Write-Output ('bounded-owner-lifetime-manifest-controls:' + $manifestControls)
    Write-Output ('bounded-owner-lifetime-mutant-and-r1-controls:' + $mutantControls)
} finally {
    $env:TEMP = $previousTemp; $env:TMP = $previousTmp
    $bytes = 0L; foreach ($item in Get-ChildItem -LiteralPath $fixture -File) { $bytes += $item.Length }
    if ($bytes -gt 16MB) { throw 'owner-lifetime-output-budget-exceeded' }
    Write-Output ('retained-owner-lifetime-bound-fixture-bytes:' + $bytes)
}
