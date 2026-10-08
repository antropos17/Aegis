param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ((Get-PSDrive C).Free -lt 256MB) { throw 'witness-controls-disk-stop' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'witness-controls-reparse' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-witness-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $dll = Join-Path $fixture 'witness.dll'; $qualification = Join-Path $ProjectRoot 'scripts/qualification'
    $arguments = @('/nologo', '/target:library', '/platform:x64', '/warnaserror+', ('/out:"' + $dll + '"'))
    foreach ($leaf in @('CloudGuestProcess.cs', 'CloudGuestTestWitness.cs', 'CloudGuestTestWitnessFixture.cs')) { $arguments += ('"' + (Join-Path $PSScriptRoot $leaf) + '"') }
    foreach ($leaf in @('CloudGuestDesktop.cs', 'CloudGuestNetwork.cs', 'CloudGuestClaudeReceiver.cs', 'CloudGuestRuntimeGate.cs')) { $arguments += ('"' + (Join-Path $qualification $leaf) + '"') }
    foreach ($leaf in @('CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative', 'GuestJobNative', 'GuestJobInventory')) {
        $arguments += ('"' + (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) + '"')
    }
    $exit = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.stderr') 10000
    if ($exit -ne 0 -or (Get-Item -LiteralPath $dll).Length -gt 1MB) { throw 'witness-controls-compile' }
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll)); $type = $assembly.GetType('CloudGuestTestWitnessFixture')
    $model = $type.GetMethod('Model'); $decide = $type.GetMethod('Decide'); $accept = $type.GetMethod('Accept')
    $sid = 'S-1-5-21-101-102-103-104'; $script:assertions = 0
    function Check($Value) { $script:assertions++; if (!$Value) { throw 'witness-controls-refused' } }
    function Valid() { return $decide.Invoke($null, @($model.Invoke($null, @()), [uint32]0, $true, $true)) }
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-guest-claude-phase.ps1'), [ref]$null, [ref]$null)
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-CloudGuestClaudeWitnessReceipt' }, $true)
    if ($null -eq $function) { throw 'witness-controls-phase-parser' }; . ([scriptblock]::Create($function.Extent.Text))
    $valid = Valid
    Check ($valid.passed -eq $true); Check ($accept.Invoke($null, @($valid, $sid)))
    $valid['trustedTestProcessObservation'] = 'observed-separate-post-claude-fixed-test'
    Check (Test-CloudGuestClaudeWitnessReceipt $valid $sid)
    foreach ($field in @('heldIdentityBeforeRelease', 'runtimeResumed', 'runtimeCallerAuthenticated', 'runtimeInitializedBeforeProject', 'taskReleased', 'privateDesktopCreated', 'privateDesktopParentRestored', 'privateDesktopHandlesClosedAfterJobClosure')) {
        $value = $model.Invoke($null, @()); $value.Remove($field) | Out-Null
        Check (!$decide.Invoke($null, @($value, [uint32]0, $true, $true)).passed)
    }
    foreach ($state in @(@([uint32]7, $true, $true), @([uint32]0, $false, $true), @([uint32]0, $true, $false))) {
        $value = $decide.Invoke($null, @($model.Invoke($null, @()), $state[0], $state[1], $state[2]))
        Check (!$value.passed); Check (!$accept.Invoke($null, @($value, $sid)))
    }
    foreach ($field in @('witnessInputPinsVerified', 'witnessEditedBytesVerified', 'witnessInputsHeldThroughConfirmedClosure', 'witnessInputHandlesClosed', 'witnessInputDisposalUnknown', 'originalClaudeToolProcessObserved', 'administratorGroupPresent', 'elevated')) {
        $value = Valid; $value[$field] = !$value[$field]; $value['trustedTestProcessObservation'] = 'observed-separate-post-claude-fixed-test'
        Check (!$accept.Invoke($null, @($value, $sid))); Check (!(Test-CloudGuestClaudeWitnessReceipt $value $sid))
    }
    foreach ($field in @('pid', 'birthFileTime', 'initialJobMembers', 'tokenRequestedAccess')) {
        $value = Valid; $value[$field] = 0; $value['trustedTestProcessObservation'] = 'observed-separate-post-claude-fixed-test'
        Check (!$accept.Invoke($null, @($value, $sid))); Check (!(Test-CloudGuestClaudeWitnessReceipt $value $sid))
    }
    Check (!$accept.Invoke($null, @($valid, 'S-1-5-21-201-202-203-204'))); Check (!(Test-CloudGuestClaudeWitnessReceipt $valid 'S-1-5-21-201-202-203-204'))
    $pins = $type.GetMethod('PinControls').Invoke($null, @([string]$fixture)); Check ($pins -eq 5)
    $node = Join-Path $env:ProgramFiles 'nodejs/node.exe'
    $js = Invoke-CloudGuestNativeProcess $node @(('"' + (Join-Path $PSScriptRoot 'test-cloud-guest-test-witness.cjs') + '"')) (Join-Path $fixture 'js.txt') (Join-Path $fixture 'js.stderr') 5000
    Check ($js -eq 0 -and (Get-Item -LiteralPath (Join-Path $fixture 'js.stderr')).Length -eq 0)
    $control = [IO.File]::ReadAllText((Join-Path $fixture 'js.txt')) | ConvertFrom-Json; Check ($control.passed -eq $true -and $control.pureCases -eq 9 -and !$control.actualGuestOrProcessObserved)
    @{passed=$true;modelAssertions=$script:assertions;actualFilePinControls=$pins;pureNodeCases=9;warningsAsErrors=$true;
        actualTestProcessObserved=$false;logonAclJobVmOrProviderEffects=$false;scope='synthetic-completer-and-owned-file-pins';launchAllowed=$false} | ConvertTo-Json
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 1MB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'witness-controls-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}
