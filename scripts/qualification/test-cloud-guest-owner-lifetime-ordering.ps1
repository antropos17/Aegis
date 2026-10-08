param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetFullPath($env:TEMP)) 'aegis-owner-lifetime'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $WorkRoot)) { New-Item -ItemType Directory -Path $WorkRoot | Out-Null }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-claude-phase.ps1')
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-cancellation.ps1')
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-stdio.ps1')
. (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime.ps1')
# Evaluate the actual invocation guard without invoking a guest or changing its environment.
$invocation = Get-CloudGuestOwnerLifetimeInvocation
$sidGuards = @($invocation.Ast.FindAll({ param($node) $node -is [Management.Automation.Language.BinaryExpressionAst] -and
    $node.Left.Extent.Text -ceq '$ExpectedSid' -and $node.Operator -eq 'Cnotmatch' }, $true))
if ($sidGuards.Count -ne 1) { throw 'owner-lifetime-sid-guard-seam-refused' }
$ExpectedSid = 'S-1-5-21-1-2-3-1001'
if (& ([scriptblock]::Create($sidGuards[0].Extent.Text))) { throw 'owner-lifetime-valid-standard-sid-refused' }
$sidControls = 1
foreach ($ExpectedSid in @('S-1-5-18', 'S-1-5-21-1-2-3', 'S-1-5-21-1-2-3-4-5', 'S-1-5-21-1-2-3-1001x')) {
    if (!(& ([scriptblock]::Create($sidGuards[0].Extent.Text)))) { throw 'owner-lifetime-invalid-standard-sid-accepted' }; $sidControls++
}
# Reuse only maintained synthetic fixture declarations before their first check.
$cancellationSource = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-cancellation.ps1'))
$marker = '$claudeNative = @'; $end = '$positive = Assert-CloudGuestCancellationPreviousClosures $first $claude'
if ($cancellationSource.Split(@($marker), [StringSplitOptions]::None).Count -ne 2 -or
    $cancellationSource.Split(@($end), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-ordering-fixture-refused' }
$firstSource = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-claude-first-phase.ps1'))
$firstEnd = '$positive = Assert-CloudGuestClaudeFirstPhase $first'
if ($firstSource.Split(@($firstEnd), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-ordering-fixture-refused' }
$firstSetup = $firstSource.Substring(0, $firstSource.IndexOf($firstEnd)).Replace(". (Join-Path `$PSScriptRoot 'cloud-guest-claude-phase.ps1')", '')
. ([scriptblock]::Create($firstSetup))
. ([scriptblock]::Create($cancellationSource.Substring($cancellationSource.IndexOf($marker), $cancellationSource.IndexOf($end) - $cancellationSource.IndexOf($marker))))
$start = '$before = @{'; $end = 'if (!(Test-CloudGuestCancellationResult $value $native.sid))'
if ($cancellationSource.Split(@($start), [StringSplitOptions]::None).Count -ne 2 -or
    $cancellationSource.Split(@($end), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-ordering-fixture-refused' }
. ([scriptblock]::Create($cancellationSource.Substring($cancellationSource.IndexOf($start), $cancellationSource.IndexOf($end) - $cancellationSource.IndexOf($start))))
$cancellation = @{ passed = $true; controls = $value }
$stdioSource = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-stdio-cloud.ps1'))
$start = '$sid = '; $end = 'if (!(Test-CloudGuestStdioResult $value $sid))'
if ($stdioSource.Split(@($end), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-ordering-fixture-refused' }
. ([scriptblock]::Create($stdioSource.Substring($stdioSource.IndexOf($start), $stdioSource.IndexOf($end) - $stdioSource.IndexOf($start))))
$stdio = @{ passed = $true; controls = $value }
$gate = Assert-CloudGuestOwnerLifetimePreviousClosures $first $claude $cancellation $stdio
if ($gate.sid -cne $sid) { throw 'owner-lifetime-prior-sid-lost' }; $orderingControls = 1
foreach ($pair in @(@($native, 'jobClosureConfirmed', $false), @($claudeNative, 'claudeReceiverExitObserved', $false),
    @($witness, 'jobClosureConfirmed', $false), @($cancellation.controls.after, 'descendantExitObserved', $false),
    @($cancellation.controls.after, 'jobClosureConfirmed', 'true'), @($stdio.controls.cases[4], 'jobClosureConfirmed', $false),
    @($stdio.controls.cases[0], 'sid', 'S-1-5-18'), @($stdio, 'passed', $false), @($stdio.controls, 'newReceiversStarted', $true))) {
    $old = $pair[0][$pair[1]]; $pair[0][$pair[1]] = $pair[2]
    try {
        $refused = $false; try { Assert-CloudGuestOwnerLifetimePreviousClosures $first $claude $cancellation $stdio | Out-Null } catch { $refused = $true }
        if (!$refused) { throw 'owner-lifetime-prior-closure-mutation-accepted' }; $orderingControls++
    } finally { $pair[0][$pair[1]] = $old }
}
# Execute the actual proposed final controller expression with explicitly synthetic closed facts.
$lab = Join-Path $PSScriptRoot 'cloud-guest-lab.ps1'; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($lab, [ref]$null, [ref]$errors)
if ($errors.Count) { throw 'owner-lifetime-lab-syntax-refused' }
$assignments = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$report.passed' }, $true))
if ($assignments.Count -ne 1) { throw 'owner-lifetime-controller-seam-refused' }
$report = @{ ownerLifetimeControlsComplete = $true; hostCanariesUnchangedAfterOwnerLifetime = $true;
    stdioControlsComplete = $true; hostCanariesUnchangedAfterStdio = $true; cancellationControlsComplete = $true;
    hostCanariesUnchangedAfterCancellation = $true; failure = $null; cleanupFailure = $null; offObserved = $true;
    removedObserved = $true; hostCanariesUnchangedAfterTask = $true; hostCanariesUnchangedAfterRemoval = $true }
$expression = [scriptblock]::Create($assignments[0].Right.Extent.Text)
if (!(& $expression)) { throw 'owner-lifetime-controller-positive-refused' }; $controllerControls = 1
foreach ($field in @('ownerLifetimeControlsComplete', 'hostCanariesUnchangedAfterOwnerLifetime', 'stdioControlsComplete',
    'hostCanariesUnchangedAfterStdio', 'cancellationControlsComplete', 'hostCanariesUnchangedAfterCancellation')) {
    $report[$field] = $false
    try { if (& $expression) { throw 'owner-lifetime-controller-mutation-accepted' }; $controllerControls++ }
    finally { $report[$field] = $true }
}
# Execute only the actual held-byte pin loop in our disposable directory; never the guest account/loader section.
$fixture = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('owner-lifetime-pins-' + [guid]::NewGuid().ToString('N'))
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($fixture))
if ($drive.AvailableFreeSpace -lt 512MB) { throw 'owner-lifetime-disk-headroom-refused' }
New-Item -ItemType Directory -Path $fixture | Out-Null
$trusted = $fixture
$bootstrap = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-bootstrap.ps1'))
$bootstrapAst = [Management.Automation.Language.Parser]::ParseInput($bootstrap, [ref]$null, [ref]$null)
$manifestFunctions = @($bootstrapAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Read-CloudGuestOwnerLifetimeManifestUtf8' }, $true))
if ($manifestFunctions.Count -ne 1) { throw 'owner-lifetime-manifest-bound-seam-refused' }
. ([scriptblock]::Create($manifestFunctions[0].Extent.Text))
$start = '$manifestFile = '; $end = '. ([scriptblock]::Create($readerSource))'
if ($bootstrap.Split(@($start), [StringSplitOptions]::None).Count -ne 2 -or $bootstrap.Split(@($end), [StringSplitOptions]::None).Count -ne 2) { throw 'owner-lifetime-pinning-seam-refused' }
$pinBlock = [scriptblock]::Create($bootstrap.Substring($bootstrap.IndexOf($start), $bootstrap.IndexOf($end) - $bootstrap.IndexOf($start)))
$manifest = @{ files = @() }
foreach ($leaf in @('node.exe', 'guest-process.dll', 'guest-owner-lifetime.exe', 'cloud-owner-lifetime-runtime.cjs',
    'cloud-owner-lifetime-task.cjs', 'owner-lifetime-fixed-task.cjs', 'cloud-guest-owner-lifetime-reader.ps1')) {
    $path = Join-Path $trusted $leaf
    if ($leaf -ceq 'cloud-guest-owner-lifetime-reader.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination $path }
    else { [IO.File]::WriteAllText($path, 'fixed-disposable-input', [Text.UTF8Encoding]::new($false)) }
    $manifest.files += @{ name = $leaf; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
try {
    # Exercise the proposed maintained transfer statements using the separately compiled native helper.
    $OutputRoot = $fixture; $transfer = Join-Path $fixture 'transfer'
    New-Item -ItemType Directory -Path $transfer | Out-Null
    $ownerLifetimeBuild = (Get-Content -LiteralPath (Join-Path $WorkRoot 'integration-evidence.json') -Raw | ConvertFrom-Json).build
    if ((Get-FileHash -LiteralPath $ownerLifetimeBuild.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ownerLifetimeBuild.sha256) { throw 'owner-lifetime-transfer-build-binding-refused' }
    $copies = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -ceq 'Copy-Item' -and $node.Extent.Text.Contains('$ownerLifetimeBuild.path') }, $true))
    $loops = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and
        $node.Condition.Extent.Text.Contains("'cloud-guest-owner-lifetime-bootstrap.ps1'") -and
        $node.Condition.Extent.Text.Contains("'cloud-guest-owner-lifetime-reader.ps1'") -and
        $node.Body.Extent.Text.Contains('Copy-Item') }, $true))
    if ($copies.Count -ne 1 -or $loops.Count -ne 1) { throw 'owner-lifetime-transfer-seam-refused' }
    & ([scriptblock]::Create($copies[0].Extent.Text))
    # A created ScriptBlock has no script file root; bind that sole path input explicitly.
    $SourceRoot = $PSScriptRoot
    & ([scriptblock]::Create($loops[0].Extent.Text.Replace('$PSScriptRoot', '$SourceRoot')))
    $transferHashes = @{}
    foreach ($item in Get-ChildItem -LiteralPath $transfer -File) {
        $source = if ($item.Name -ceq 'guest-owner-lifetime.exe') { $ownerLifetimeBuild.path } else { Join-Path $PSScriptRoot $item.Name }
        $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
        if ($item.Length -gt 64KB -or $hash -cne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) { throw 'owner-lifetime-transferred-input-refused' }
        $transferHashes[$item.Name] = $hash
    }
    if ($transferHashes.Count -ne 6) { throw 'owner-lifetime-transfer-leaf-count-refused' }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $trusted 'manifest.json') -Encoding utf8
    $held = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        . $pinBlock
        if ($held.Count -ne 8 -or $inputBytes.Count -ne 7 -or $readerSource -cne [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-reader.ps1'))) { throw 'owner-lifetime-input-pin-positive-refused' }
        $pinControls = 1
        foreach ($stream in $held) {
            $refused = $false
            try { $writer = [IO.File]::Open($stream.Name, 'Open', 'Write', 'ReadWrite'); $writer.Dispose() } catch [IO.IOException] { $refused = $true }
            if (!$refused) { throw 'owner-lifetime-held-input-write-admitted' }; $pinControls++
        }
    } finally { foreach ($stream in $held) { $stream.Dispose() } }
    $manifest.files[2].sha256 = '0' * 64
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $trusted 'manifest.json') -Encoding utf8
    $held = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        $refused = $false; try { . $pinBlock } catch { $refused = $_.Exception.Message -ceq 'owner-lifetime-refused' }
        if (!$refused) { throw 'owner-lifetime-mismatched-helper-pin-admitted' }; $pinControls++
    } finally { foreach ($stream in $held) { $stream.Dispose() } }
    $hashes = @{}
    foreach ($source in @($lab, (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime.ps1'), (Join-Path $PSScriptRoot 'cloud-guest-owner-lifetime-bootstrap.ps1'), $PSCommandPath)) { $hashes[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash }
    @{ evidence = 'pure-ordering-and-actual-held-file-sharing'; sidGuardControls = $sidControls; syntheticOrderingControls = $orderingControls;
        syntheticControllerControls = $controllerControls; actualFilePinControls = $pinControls; sourceHashes = $hashes;
        actualTransferredLeaves = $transferHashes.Count; transferHashes = $transferHashes;
        retainedFixture = $fixture; observedAtUtc = [DateTime]::UtcNow.ToString('o'); launchAllowed = $false; fullE33Accepted = $false } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $WorkRoot 'ordering-evidence.json') -Encoding utf8
    Write-Output ('pure-owner-lifetime-sid-guard-controls:' + $sidControls)
    Write-Output ('pure-owner-lifetime-prior-ordering-controls:' + $orderingControls)
    Write-Output ('pure-owner-lifetime-final-controller-controls:' + $controllerControls)
    Write-Output ('actual-owner-lifetime-held-file-pin-controls:' + $pinControls)
    Write-Output ('actual-owner-lifetime-transferred-leaves:' + $transferHashes.Count)
} finally {
    $bytes = (Get-ChildItem -LiteralPath $fixture -File -Recurse | Measure-Object Length -Sum).Sum
    if ($bytes -gt 16MB) { throw 'owner-lifetime-output-budget-exceeded' }
    Write-Output ('retained-owner-lifetime-pins-bytes:' + $bytes)
}
