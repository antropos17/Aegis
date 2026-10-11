param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Exercise the actual admission and cleanup conditions without token or VM effects.
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'scripts/qualification/test-cloud-guest-token.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'token-source-syntax-failed' }
$try = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })[0]
$compileIf = @($try.Body.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] })[0]
$compileRefused = [scriptblock]::Create($compileIf.Clauses[0].Item1.Extent.Text)
$loop = $try.Finally.Statements[0]
$cleanupIf = @($loop.Body.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] })[0]
$cleanupRefused = [scriptblock]::Create($cleanupIf.Clauses[0].Item1.Extent.Text)
$boundStatement = @($loop.Body.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] })[0]
$chooseBound = [scriptblock]::Create($boundStatement.Extent.Text)
$capAssignment = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$nativeBound' })
$nativeBound = if ($capAssignment.Count) { . ([scriptblock]::Create($capAssignment[0].Right.Extent.Text)) } else { 80KB }
if ($nativeBound -gt 84KB) { throw 'token-native-bound-too-wide' }
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'bounds-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-token-bounds-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$dll = Join-Path $fixture 'token-controls.dll'
$exit = 0; $checks = 0
try {
    # This is the measured fixed-source compiler output that previously exceeded 80KiB.
    [IO.File]::WriteAllBytes($dll, (New-Object byte[] 82432))
    if (. $compileRefused) { throw 'current-token-dll-admission-refused' }; $checks++
    $file = Get-Item -LiteralPath $dll
    . $chooseBound
    if (. $cleanupRefused) { throw 'current-token-dll-cleanup-refused' }; $checks++
    foreach ($length in @($nativeBound, ($nativeBound + 1))) {
        [IO.File]::WriteAllBytes($dll, (New-Object byte[] $length))
        $expected = $length -gt $nativeBound
        if ([bool](. $compileRefused) -ne $expected) { throw 'token-admission-bound-failed' }; $checks++
        $file = Get-Item -LiteralPath $dll
        . $chooseBound
        if ([bool](. $cleanupRefused) -ne $expected) { throw 'token-cleanup-bound-failed' }; $checks++
    }
    $exit = 1
    if (!(. $compileRefused)) { throw 'token-compiler-failure-accepted' }; $checks++
    $exit = 0
    foreach ($case in @(
        @{ FullName = (Join-Path $fixture 'compile.txt'); Length = 64KB; Attributes = [IO.FileAttributes]::Archive; Refused = $false },
        @{ FullName = (Join-Path $fixture 'compile.txt'); Length = (64KB + 1); Attributes = [IO.FileAttributes]::Archive; Refused = $true },
        @{ FullName = ($fixture + '-sibling\token-controls.dll'); Length = 1; Attributes = [IO.FileAttributes]::Archive; Refused = $true },
        @{ FullName = $dll; Length = 1; Attributes = [IO.FileAttributes]::ReparsePoint; Refused = $true }
    )) {
        $file = [pscustomobject]$case
        . $chooseBound
        if ([bool](. $cleanupRefused) -ne $case.Refused) { throw 'token-cleanup-scope-control-failed' }; $checks++
    }
    # Execute the complete production finally block: an oversized DLL remains untouched.
    $finallyText = $try.Finally.Extent.Text
    $cleanup = [scriptblock]::Create($finallyText.Substring(1, $finallyText.Length - 2))
    [IO.File]::WriteAllBytes($dll, (New-Object byte[] ($nativeBound + 1)))
    $refusal = $null
    try { . $cleanup } catch { $refusal = $_.Exception.Message }
    if ($refusal -cne 'token-fixture-cleanup-refused' -or !(Test-Path -LiteralPath $dll) -or
        (Get-Item -LiteralPath $dll).Length -ne ($nativeBound + 1)) { throw 'token-oversized-fixture-not-preserved' }; $checks++
    # A normal DLL and bounded diagnostics remove the whole owned fixture.
    [IO.File]::WriteAllBytes($dll, (New-Object byte[] 82432))
    [IO.File]::WriteAllText((Join-Path $fixture 'compile.txt'), '')
    . $cleanup
    if (Test-Path -LiteralPath $fixture) { throw 'token-owned-fixture-not-removed' }; $checks++
    [ordered]@{ passed = $true; checks = $checks; measuredDllBytes = 82432; nativeBound = $nativeBound;
        scope = 'actual-source-admission-and-cleanup-with-disposable-files-and-synthetic-refusals';
        tokenAccountAclOrVmEffects = $false; launchAllowed = $false } | ConvertTo-Json -Compress
} finally {
    # Only exact files created by this control may be removed, after bounding them.
    foreach ($path in @($dll, (Join-Path $fixture 'compile.txt'))) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint -or $item.Length -gt (84KB + 1)) { throw 'bounds-fixture-cleanup-refused' }
            Remove-Item -LiteralPath $item.FullName
        }
    }
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture }
}
