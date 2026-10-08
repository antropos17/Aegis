param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
# Load only the two pure host receipt projectors; never execute VM operations.
$vmSource = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-vm.ps1'
$tokens = $null; $parseErrors = $null
$vmAst = [Management.Automation.Language.Parser]::ParseFile($vmSource, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'loader-projection-source-refused' }
foreach ($name in @('Get-CloudGuestResultField', 'Get-CloudGuestNativeResultFailure')) {
    $functions = @($vmAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true))
    if ($functions.Count -ne 1) { throw 'loader-projection-source-refused' }
    . ([scriptblock]::Create($functions[0].Extent.Text))
}
foreach ($stage in @('held-token-session', 'loader-probe-resume', 'loader-probe-deadline')) {
    $projected = Get-CloudGuestNativeResultFailure @{identity=@{passed=$false;failureStage=$stage;failureHResult=-2146233079}}
    if ($projected.nativeStage -cne $stage -or $projected.hResult -ne -2146233079) { throw 'loader-projection-refused' }
}
$unknown = Get-CloudGuestNativeResultFailure @{identity=@{passed=$false;failureStage='not-a-fixed-stage';failureHResult='unsafe'}}
if ($unknown.nativeStage -cne 'unknown' -or $null -ne $unknown.hResult) { throw 'loader-projection-refused' }

$base = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $base -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'loader-fixture-reparse' }; $parent = $parent.Parent }
$fixture = Join-Path $base ('aegis-loader-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'; $exe = Join-Path $fixture 'loader.exe'
    $arguments = @('/nologo', '/warnaserror+', '/target:exe', '/platform:x64', ('/out:"' + $exe + '"'))
    foreach ($leaf in @('CloudGuestProcess.cs', 'CloudGuestLoaderProbe.cs', 'CloudGuestLoaderProbeFixture.cs')) { $arguments += ('"' + (Join-Path $PSScriptRoot $leaf) + '"') }
    foreach ($leaf in @('CloudGuestDesktop.cs', 'CloudGuestNetwork.cs', 'CloudGuestClaudeReceiver.cs', 'CloudGuestRuntimeGate.cs')) { $arguments += ('"' + (Join-Path $ProjectRoot ('scripts/qualification/' + $leaf)) + '"') }
    foreach ($leaf in @('CallerAdmission', 'CallerRegistration', 'CallerIdentity', 'CallerNative', 'GuestJobNative', 'GuestJobInventory')) { $arguments += ('"' + (Join-Path $ProjectRoot ('sidecar/session/' + $leaf + '.cs')) + '"') }
    $compiled = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.stderr') 10000
    if ($compiled -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 1MB) { throw 'loader-fixture-compile-refused' }
    $code = Invoke-CloudGuestNativeProcess $exe @() (Join-Path $fixture 'output.json') (Join-Path $fixture 'output.stderr') 5000
    $text = [IO.File]::ReadAllText((Join-Path $fixture 'output.json')).Trim()
    if ($code -ne 0 -or $text -cne 'loader-pure-controls:20' -or (Get-Item -LiteralPath (Join-Path $fixture 'output.stderr')).Length -ne 0) { throw 'loader-fixture-refused' }
    @{passed=$true;modelCases=20;projectionCases=4;warningsAsErrors=$true;secondaryLogonOrGuestExecuted=$false;scope='pure-loader-receipt-predicates';launchAllowed=$false} | ConvertTo-Json
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 1MB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'loader-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}