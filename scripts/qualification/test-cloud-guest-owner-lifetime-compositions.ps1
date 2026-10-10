param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetFullPath($env:TEMP)) 'aegis-owner-lifetime'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $WorkRoot)) { New-Item -ItemType Directory -Path $WorkRoot | Out-Null }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$fixture = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('owner-lifetime-compositions-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$oldTemp = $env:TEMP; $oldTmp = $env:TMP; $env:TEMP = $fixture; $env:TMP = $fixture
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$baseInputs = @((Join-Path $PSScriptRoot 'CloudGuestProcess.cs'))
foreach ($leaf in @('CloudGuestDesktop', 'CloudGuestNetwork', 'CloudGuestClaudeReceiver', 'CloudGuestRuntimeGate')) { $baseInputs += (Join-Path $ProjectRoot ('scripts/qualification/' + $leaf + '.cs')) }
foreach ($leaf in @('CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative', 'GuestJobNative', 'GuestJobInventory')) { $baseInputs += (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) }
$results = @(); $pins = @{}
function Compile-Composition([string]$Leaf, [string[]]$Inputs, [string[]]$Options) {
    $output = Join-Path $fixture $Leaf
    $arguments = @('/nologo', '/warnaserror+', ('/out:"' + $output + '"')) + $Options
    foreach ($path in $Inputs) { $arguments += ('"' + $path + '"'); $pins[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments ($output + '.stdout') ($output + '.stderr') 10000
    if ($code -ne 0) { Get-Content -LiteralPath ($output + '.stdout') -TotalCount 20; throw 'owner-lifetime-composition-compile-refused' }
    return @{ leaf = $Leaf; path = $output; bytes = (Get-Item -LiteralPath $output).Length;
        sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash; options = $Options }
}
try {
    $guestInputs = $baseInputs + @((Join-Path $ProjectRoot 'scripts/qualification/CloudGuestLoaderProbe.cs'), (Join-Path $ProjectRoot 'scripts/qualification/CloudGuestTestWitness.cs'))
    $dll = Compile-Composition 'guest-process.dll' $guestInputs @('/target:library', '/platform:x64', '/optimize+')
    $dll.capBytes = 81920; $dll.withinCap = $dll.bytes -le 81920; $results += $dll
    $runtimeInputs = $baseInputs + @((Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-runtime/RuntimeGateFixture.cs'),
        (Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-runtime/RuntimeStartupFixture.cs'))
    $runtime = Compile-Composition 'RuntimeGateFixture-default.exe' $runtimeInputs @('/target:exe')
    $runtime.capBytes = 81920; $runtime.withinCap = $runtime.bytes -le 81920; $results += $runtime
    $optimized = Compile-Composition 'RuntimeGateFixture-optimized.exe' $runtimeInputs @('/target:exe', '/optimize+')
    # Only the two exact compiler-produced runtime executables get finite 256KiB fixture caps.
    $optimized.capBytes = 256KB; $optimized.withinCap = $optimized.bytes -le 256KB; $results += $optimized
    $baselineInputs = @($runtimeInputs | ForEach-Object {
        if ($_ -ceq (Join-Path $PSScriptRoot 'CloudGuestProcess.cs')) { Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-owner-lifetime/BaselineGuestProcess.cs' } else { $_ }
    })
    $baseline = Compile-Composition 'RuntimeGateFixture-baseline-optimized.exe' $baselineInputs @('/target:exe', '/optimize+')
    $baseline.capBytes = 256KB; $baseline.withinCap = $baseline.bytes -le 256KB; $results += $baseline
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'tests/fixtures/native-cloud-guest-runtime/client-control.cjs') -Destination $fixture
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-runtime.cjs') -Destination $fixture
    $code = Invoke-CloudGuestNativeProcess $optimized.path @(('"' + $node + '"'), ('"' + $fixture + '"')) (Join-Path $fixture 'runtime.txt') (Join-Path $fixture 'runtime.error') 18000
    $native = [IO.File]::ReadAllText((Join-Path $fixture 'runtime.txt'))
    if ($code -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'runtime.error')).Length -ne 0 -or !$native.Contains('native-controls:14')) { throw 'owner-lifetime-composed-runtime-native-refused' }
    $code = Invoke-CloudGuestNativeProcess $baseline.path @(('"' + $node + '"'), ('"' + $fixture + '"')) (Join-Path $fixture 'baseline-runtime.txt') (Join-Path $fixture 'baseline-runtime.error') 18000
    $baselineNative = [IO.File]::ReadAllText((Join-Path $fixture 'baseline-runtime.txt'))
    if ($code -ne 0 -or (Get-Item -LiteralPath (Join-Path $fixture 'baseline-runtime.error')).Length -ne 0 -or !$baselineNative.Contains('native-controls:14')) { throw 'owner-lifetime-baseline-runtime-native-refused' }
    $witnessInputs = $baseInputs + @((Join-Path $ProjectRoot 'scripts/qualification/CloudGuestTestWitness.cs'),
        (Join-Path $ProjectRoot 'scripts/qualification/CloudGuestTestWitnessFixture.cs'))
    $witness = Compile-Composition 'TestWitnessFixture.dll' $witnessInputs @('/target:library', '/platform:x64')
    $witness.capBytes = 1048576; $witness.withinCap = $witness.bytes -le 1048576; $results += $witness
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($witness.path)); $type = $assembly.GetType('CloudGuestTestWitnessFixture')
    $model = $type.GetMethod('Model'); $decide = $type.GetMethod('Decide'); $accept = $type.GetMethod('Accept')
    $positive = $decide.Invoke($null, @($model.Invoke($null, @()), [uint32]0, $true, $true))
    if (!$positive.passed -or !$accept.Invoke($null, @($positive, 'S-1-5-21-101-102-103-104'))) { throw 'owner-lifetime-composed-witness-positive-refused' }
    $witnessControls = 1
    foreach ($field in @('heldIdentityBeforeRelease', 'runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject',
        'taskReleased', 'privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure')) {
        $value = $model.Invoke($null, @()); [void]$value.Remove($field)
        if ($decide.Invoke($null, @($value, [uint32]0, $true, $true)).passed) { throw 'owner-lifetime-witness-regression-accepted' }; $witnessControls++
    }
    $owner = $model.Invoke($null, @()); $owner['ownerLifetimePhase'] = $true
    $ownerReceipt = $decide.Invoke($null, @($owner, [uint32]0, $true, $true))
    if (!$ownerReceipt.passed -or $ownerReceipt.verificationKind -cne 'fixed-owner-lifetime-runtime') { throw 'owner-lifetime-receipt-label-refused' }; $witnessControls++
    foreach ($path in $pins.Keys) { if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $pins[$path]) { throw 'owner-lifetime-composition-input-changed' } }
    if (!$dll.withinCap -or !$optimized.withinCap -or !$baseline.withinCap -or !$witness.withinCap) { throw 'owner-lifetime-maintained-composition-cap-refused' }
    $receipt = @{ actualHead = (& git -C $ProjectRoot rev-parse HEAD).Trim(); observedAtUtc = [DateTime]::UtcNow.ToString('o');
        sourceHashes = $pins; compositions = $results; runtimeNativeOutput = $native; baselineRuntimeNativeOutput = $baselineNative;
        compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash; witnessSyntheticCompleterControls = $witnessControls;
        retainedFixture = $fixture; intermediateUnoptimizedRuntimeWithinCap = $runtime.withinCap;
        maintainedFinalCompositionsWithinCap = $dll.withinCap -and $optimized.withinCap -and $baseline.withinCap -and $witness.withinCap;
        sourceBytes = @{} }
    foreach ($path in $pins.Keys) { $receipt.sourceBytes[$path] = (Get-Item -LiteralPath $path).Length }
    $receipt | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $WorkRoot 'composition-evidence.json') -Encoding utf8
    foreach ($entry in $results) { Write-Output ($entry.leaf + '-bytes:' + $entry.bytes + ';within-existing-cap:' + $entry.withinCap) }
    Write-Output 'composed-runtime-native-controls:14'
    Write-Output 'same-flags-baseline-runtime-native-controls:14'
    Write-Output ('composed-witness-synthetic-completer-controls:' + $witnessControls)
} finally {
    $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    if ((Get-ChildItem -LiteralPath $fixture -File | Measure-Object Length -Sum).Sum -gt 16MB) { throw 'owner-lifetime-composition-budget-exceeded' }
    Write-Output 'owner-lifetime-compositions-retained-for-review'
}
