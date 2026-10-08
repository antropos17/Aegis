param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $ProjectRoot 'scripts/qualification/claude-public/provenance.ps1'
$wrapperPath = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-claude-public.ps1'
$repaired = [IO.File]::ReadAllText($sourcePath)
$fixedLoop = '$entry = if ($entry -is [IO.DirectoryInfo]) { $entry.Parent } elseif ($entry -is [IO.FileInfo]) { $entry.Directory } else { throw ''provenance-input-refused'' }'
$oldLoop = '$entry = if ($entry.PSIsContainer) { $entry.Parent } else { $entry.Directory }'
if (!$repaired.Contains($fixedLoop)) { throw 'provenance-control-source-unavailable' }
$oldSource = $repaired.Replace($fixedLoop, $oldLoop)
$base = [IO.Path]::GetFullPath($env:TEMP)
$owned = Join-Path $base ('aegis-public-strict-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'provenance-control-parse-failed' }
$save = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Save-CloudGuestClaudeBinary' }, $true)
if ($null -eq $save) { throw 'provenance-control-source-unavailable' }
$newHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
function Assert-CloudGuestRunner { }
function Invoke-TestNoDownload([string]$Path) { $script:downloadStubCalls++; if ($Path -cne $script:expectedBinary) { throw 'provenance-control-parameters' } }
function Get-Item {
    param([string]$LiteralPath, [switch]$Force)
    if ([IO.Path]::GetFileName($LiteralPath) -ceq 'official-manifest.json') { $script:metadataReached = $true; throw 'test-metadata-boundary' }
    if ($script:reparseControl -and $LiteralPath -ceq $script:expectedMetadata) { return [pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint } }
    if ($LiteralPath -ceq $script:expectedBinary) { $script:binaryObserved = $true }
    if ($LiteralPath -ceq $script:expectedMetadata) { $script:metadataObserved = $true }
    return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
}
$checks = [Collections.Generic.List[string]]::new()
foreach ($mode in @('original', 'repaired', 'reparse', 'wrong-pin')) {
    $caseRoot = Join-Path $owned $mode
    $metadata = Join-Path $caseRoot 'claude-public'; $transfer = Join-Path $caseRoot 'transfer'; $scratch = Join-Path $caseRoot 'scratch'
    foreach ($path in @($metadata, $transfer, $scratch)) { New-Item -ItemType Directory -Path $path | Out-Null }
    $selectedSource = if ($mode -ceq 'original') { $oldSource } else { $repaired }
    $selectedPath = Join-Path $metadata 'provenance.ps1'
    [IO.File]::WriteAllText($selectedPath, $selectedSource, [Text.UTF8Encoding]::new($false))
    $caseHash = (Get-FileHash -LiteralPath $selectedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($mode -ceq 'original' -and $caseHash -cne 'c0d0ff835af23fe4f67862887b610f193809f479666c6a7166c3711a6ea8f7fe') { throw 'provenance-control-original-not-exact' }
    $script:expectedBinary = Join-Path $transfer 'claude.exe'; $script:expectedMetadata = $metadata
    [IO.File]::WriteAllBytes($script:expectedBinary, [byte[]]@(1))
    $gpg = Join-Path $caseRoot 'gpg.exe'; [IO.File]::WriteAllBytes($gpg, [byte[]]@(1))
    # Actual Save function, retained-source dot invocation and parameter binding.
    # Only test-owned paths/download side effects are substituted; verifier source is exact.
    $wrapper = $save.Extent.Text.Replace('[CloudGuestClaudeDownload]::Download($binary)', 'Invoke-TestNoDownload $binary')
    $wrapper = $wrapper.Replace("Join-Path `$PSScriptRoot 'claude-public'", "'$($metadata.Replace("'", "''"))'")
    $wrapper = $wrapper.Replace("'C:\Program Files\Git\usr\bin\gpg.exe'", "'$($gpg.Replace("'", "''"))'")
    $wrapper = $wrapper.Replace($newHash, $(if ($mode -ceq 'wrong-pin') { '0' * 64 } else { $caseHash }))
    . ([scriptblock]::Create($wrapper))
    $script:metadataReached = $false; $script:binaryObserved = $false; $script:metadataObserved = $false
    $script:downloadStubCalls = 0; $script:reparseControl = $mode -ceq 'reparse'
    $kind = $null; $message = $null
    try { $null = Save-CloudGuestClaudeBinary $transfer $scratch; throw 'provenance-control-expected-boundary' }
    catch { $kind = $_.Exception.GetType().Name; $message = $_.Exception.Message }
    if ($mode -ceq 'original') {
        if ($kind -cne 'PropertyNotFoundException' -or $script:metadataReached) { throw 'provenance-control-original-not-reproduced' }
        $checks.Add('exact-original-captured-source-StrictMode-PropertyNotFoundException')
    } elseif ($mode -ceq 'repaired') {
        if ($message -cne 'test-metadata-boundary' -or !$script:metadataReached -or !$script:binaryObserved -or !$script:metadataObserved) { throw 'provenance-control-repaired-did-not-traverse' }
        $checks.Add('typed-ancestry-reaches-metadata-boundary-with-actual-parameters')
    } elseif ($mode -ceq 'reparse') {
        if ($message -cne 'provenance-reparse-refused' -or $script:metadataReached) { throw 'provenance-control-reparse-not-refused' }
        $checks.Add('reparse-ancestor-refused-before-metadata')
    } else {
        if ($message -cne 'claude-provenance-source-refused' -or $script:metadataReached) { throw 'provenance-control-pin-not-refused' }
        $checks.Add('captured-source-pin-mismatch-refused-before-verifier')
    }
    if ($script:downloadStubCalls -ne 1) { throw 'provenance-control-download-seam-not-traversed' }
}
$rawParent = (Microsoft.PowerShell.Management\Get-Item -LiteralPath $owned).Parent
$denied = $false; try { $null = $rawParent.PSIsContainer } catch { $denied = $_.Exception.GetType().Name -ceq 'PropertyNotFoundException' }
if (!$denied -or $rawParent -isnot [IO.DirectoryInfo]) { throw 'provenance-control-provider-decoration-not-reproduced' }
$checks.Add('raw-DirectoryInfo-parent-lacks-provider-decoration')
$report = @{ schemaVersion = 1; scope = 'pure-actual-Save-captured-verifier-StrictMode-controls'; checks = @($checks); passed = $checks.Count;
    shellVersion = $PSVersionTable.PSVersion.ToString(); nativeClientExecuted = $false; gpgExecuted = $false; downloads = 0;
    verifierSha256 = $newHash; ownedFixtureRoot = $owned; policyChanged = $false; globalKeyringChanged = $false }
[IO.File]::WriteAllText((Join-Path $owned 'result.json'), ($report | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Compress -Depth 4
# Exact finite closed files retained for review; no deletion retry/global cleanup.
