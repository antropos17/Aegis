param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..')), [switch]$LifetimeOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'sealed-measurement-powershell51-required' }
$source = Join-Path $ProjectRoot 'scripts/qualification/test-cloud-sealed-copy.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'sealed-measurement-source-invalid' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
foreach ($name in @('Assert-SealedControlDirectory', 'Remove-SealedControlChildDirectory')) {
    $selected = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true))
    if ($selected.Count -ne 1) { throw 'sealed-measurement-source-binding-refused' }
    . ([scriptblock]::Create($selected[0].Extent.Text))
}
$parent = [IO.Path]::GetFullPath($env:TEMP); Assert-SealedControlDirectory $parent
$root = Join-Path $parent ('aegis-sealed-measurement-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$helper = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SealedControlVerifier' }, $true))
$helperText = if ($helper.Count -eq 1) { $helper[0].Extent.Text } else { $null }
$checks = 0
function Require([bool]$Condition) { if (!$Condition) { throw ('sealed-measurement-control-failed-' + $script:checks) }; $script:checks++ }
function RunVerifier([string]$Directory) {
    $native = Join-Path $Directory 'native'
    if ($null -eq $helperText) {
        # The original caller runs this exact verifier inline before measurement.
        $assignment = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$verifier' }, $true))
        Require ($assignment.Count -eq 1)
        $caseSupportRoot = $Directory
        . ([scriptblock]::Create($assignment[0].Extent.Text.Replace('$PSScriptRoot', '$caseSupportRoot')))
        return $verifier
    }
    $caseSupportRoot = $Directory
    . ([scriptblock]::Create($helperText.Replace('$PSScriptRoot', '$caseSupportRoot')))
    return Invoke-SealedControlVerifier $native $Directory
}
function NewCase([string]$Name, [string]$Body) {
    $directory = Join-Path $root $Name
    [IO.Directory]::CreateDirectory((Join-Path $directory 'native')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $directory 'test-cloud-sealed-copy-verifier.ps1'), $Body, [Text.UTF8Encoding]::new($false))
    return $directory
}
$valid = 'param([string]$NativeEvidence) [ordered]@{passed=$true; controls=133; membership=@(); policy=(Get-ExecutionPolicy).ToString()} | ConvertTo-Json -Compress'
$lifetime = @'
param([string]$NativeEvidence)
$ErrorActionPreference='Stop'
$directory=Join-Path (Split-Path -Parent $NativeEvidence) 'transient'
[IO.Directory]::CreateDirectory($directory)|Out-Null
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Threading;
public static class FixedDiagnosticLifetime {
 public static void Start(string path) {
  var thread=new Thread(delegate(){Thread.Sleep(500);Directory.Delete(path,false);});
  thread.IsBackground=false; thread.Start();
 }
}
"@
[FixedDiagnosticLifetime]::Start($directory)
@{passed=$true;controls=133;membership=@();diagnosticPid=$PID}|ConvertTo-Json -Compress
'@
$case = NewCase 'lifetime' $lifetime
$watch = [Diagnostics.Stopwatch]::StartNew()
$result = RunVerifier $case
Require ($result.passed -is [bool] -and $result.passed -and $result.controls -eq 133)
# Narrow native scheduling model: an in-process diagnostic worker can disappear
# after enumeration, whereas owned child exit settles that worker first.
$iterator = [IO.Directory]::EnumerateFileSystemEntries($case).GetEnumerator()
$missing = $false
try {
    while ($iterator.MoveNext()) {
        $selected = $iterator.Current
        if ([IO.Path]::GetFileName($selected) -ceq 'transient') { Start-Sleep -Milliseconds 650 }
        try { Get-Item -LiteralPath $selected -Force -ErrorAction Stop | Out-Null }
        catch [Management.Automation.ItemNotFoundException] { $missing = $true }
    }
} finally { $iterator.Dispose() }
if ($missing) { throw 'sealed-verifier-lifetime-not-settled-before-measurement' }
Require ($result.diagnosticPid -ne $PID)
$exited = $false
try { [Diagnostics.Process]::GetProcessById($result.diagnosticPid).Dispose() } catch [ArgumentException] { $exited = $true }
Require $exited
if (!$LifetimeOnly) {
    Require ($null -ne $helperText)
    $before = (Get-ExecutionPolicy).ToString()
    $result = RunVerifier (NewCase 'valid' $valid)
    Require ($result.passed -eq $true -and $result.controls -eq 133 -and $result.policy -ceq $before)
    foreach ($entry in @(
        @('nonzero', 'exit 7'),
        @('stderr', '[Console]::Error.WriteLine("fixed-error"); ' + $valid),
        @('oversized', '[Console]::WriteLine("x" * 17000)'),
        @('pipe-budget', '[Console]::WriteLine("x" * 70000)'),
        @('invalid-json', '[Console]::WriteLine("invalid")'),
        @('false-predicate', '@{passed=$false;controls=133}|ConvertTo-Json -Compress'),
        @('missing-evidence', 'param([string]$NativeEvidence) [IO.File]::ReadAllText((Join-Path $NativeEvidence "local-consumption.json"))')
    )) {
        $refused = $false
        try { RunVerifier (NewCase $entry[0] $entry[1]) | Out-Null } catch { $refused = $true }
        Require $refused
    }
    $directory = NewCase 'timeout' 'Start-Sleep -Seconds 40'
    # Lower only this test's literal deadline; the actual process owner is unchanged.
    $caseSupportRoot = $directory
    $short = $helperText.Replace('30000', '1000')
    Require ($short -cne $helperText)
    . ([scriptblock]::Create($short.Replace('$PSScriptRoot', '$caseSupportRoot')))
    $refused = $false
    try { Invoke-SealedControlVerifier (Join-Path $directory 'native') $directory | Out-Null } catch { $refused = $_.Exception.Message -ceq 'native-process-deadline' }
    Require $refused
    Require ((Get-ExecutionPolicy).ToString() -ceq $before)
    $measurement = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Measure-SealedControlDirectory' }, $true))
    Require ($measurement.Count -eq 1)
    . ([scriptblock]::Create($measurement[0].Extent.Text))
    foreach ($mode in @('required-missing', 'access-denied', 'entry-bound', 'byte-bound', 'depth-bound', 'reparse')) {
        $directory = Join-Path $root ('measure-' + $mode)
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        $budget = @{ entries = 0; bytes = 0 }
        $files = [Collections.Generic.List[string]]::new(); $directories = [Collections.Generic.List[string]]::new()
        if ($mode -ceq 'entry-bound') { $budget.entries = 256; [IO.File]::WriteAllText((Join-Path $directory 'extra.txt'), 'fixed') }
        if ($mode -ceq 'byte-bound') { $budget.bytes = 16MB; [IO.File]::WriteAllText((Join-Path $directory 'extra.txt'), 'fixed') }
        if ($mode -ceq 'required-missing') {
            $selected = Join-Path $directory 'required.json'
            [IO.File]::WriteAllText($selected, 'fixed-required-evidence')
            # Remove a caller-enumerated required file at the actual Get-Item tap.
            $bound = $measurement[0].Extent.Text.Replace('$entry = Get-Item', '[IO.File]::Delete($iterator.Current); $entry = Get-Item')
            . ([scriptblock]::Create($bound))
        }
        if ($mode -ceq 'access-denied') {
            [IO.File]::WriteAllText((Join-Path $directory 'required.json'), 'fixed-required-evidence')
            $bound = $measurement[0].Extent.Text.Replace('$entry = Get-Item -LiteralPath $iterator.Current -Force', 'throw [UnauthorizedAccessException]::new("fixed-denial")')
            . ([scriptblock]::Create($bound))
        }
        if ($mode -ceq 'reparse') {
            $target = Join-Path $root 'link-target'; [IO.Directory]::CreateDirectory($target) | Out-Null
            New-Item -ItemType Junction -Path (Join-Path $directory 'link') -Target $target | Out-Null
        }
        $refused = $false
        try { Measure-SealedControlDirectory $directory $(if ($mode -ceq 'depth-bound') { 9 } else { 0 }) } catch { $refused = $true }
        Require $refused
        # Never recurse through a test junction during retention cleanup.
        if ($mode -ceq 'reparse') { [IO.Directory]::Delete((Join-Path $directory 'link'), $false) }
        . ([scriptblock]::Create($measurement[0].Extent.Text))
    }
    $refused = $false
    try { Remove-SealedControlChildDirectory $root $root } catch { $refused = $_.Exception.Message -ceq 'sealed-copy-control-cleanup-scope-refused' }
    Require $refused
    $nonempty = Join-Path $root 'nonempty'; [IO.Directory]::CreateDirectory($nonempty) | Out-Null
    [IO.File]::WriteAllText((Join-Path $nonempty 'required.txt'), 'fixed-required-file')
    $refused = $false
    try { Remove-SealedControlChildDirectory $nonempty $root } catch [IO.IOException] { $refused = $true }
    Require ($refused -and [IO.File]::Exists((Join-Path $nonempty 'required.txt')))
    # Exercise the maintained verifier itself with its real caller-produced path
    # and absent required receipt; its expected-evidence guard must pass first.
    $directory = Join-Path $root ('aegis-sealed-copy-controls-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory((Join-Path $directory 'native')) | Out-Null
    $caseSupportRoot = Join-Path $ProjectRoot 'scripts/qualification'
    . ([scriptblock]::Create($helperText.Replace('$PSScriptRoot', '$caseSupportRoot')))
    $savedTemp = $env:TEMP; $savedTmp = $env:TMP; $refused = $false
    try {
        $env:TEMP = $directory; $env:TMP = $directory
        try { Invoke-SealedControlVerifier (Join-Path $directory 'native') $directory | Out-Null } catch { $refused = $_.Exception.Message -ceq 'sealed-copy-verifier-controls-refused' }
    } finally { $env:TEMP = $savedTemp; $env:TMP = $savedTmp }
    $diagnostic = [IO.File]::ReadAllText((Join-Path $directory 'verifier.error.txt'))
    Require ($refused -and $diagnostic -match 'local-consumption\.\s*json' -and $diagnostic.Contains('PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand'))
    $refused = $false
    try { Invoke-SealedControlVerifier (Join-Path $root 'foreign-native') $directory | Out-Null } catch { $refused = $_.Exception.Message -ceq 'sealed-copy-owned-evidence-required' }
    Require $refused
}
@{schemaVersion=1;scope='native-child-process-with-modeled-diagnostic-lifetime';passed=$true;checks=$checks;ownedFixtureRoot=$root;elapsedMilliseconds=$watch.ElapsedMilliseconds;actualGuestRun=$false;hostedCauseProven=$false}|ConvertTo-Json -Compress
