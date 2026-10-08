param([string]$WrapperPath = (Join-Path $PSScriptRoot 'test-cloud-guest-shell.ps1'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$wrapperText = [IO.File]::ReadAllText($WrapperPath)
$wrapperText = $wrapperText.Replace(". (Join-Path `$PSScriptRoot 'test-cloud-guest-shell-diagnostics.ps1')", '')
$script:diagnosticSourceRoot = $PSScriptRoot
$completed = 0
foreach ($mode in @('nonzero', 'stderr', 'malformed', 'extra-field', 'unknown-case', 'result-refused', 'invoke', 'native')) {
    $messages = [Collections.Generic.List[string]]::new()
    $script:diagnosticMode = $mode; $script:diagnosticCalls = 0; $script:diagnosticFixture = $null
    $stub = @'
function Invoke-CloudGuestNativeProcess($Exe, $Args, $Out, $Err, $Budget) {
    $script:diagnosticCalls++
    $script:diagnosticFixture = [IO.Path]::GetDirectoryName($Out)
    if ($script:diagnosticCalls -eq 1) {
        [IO.File]::WriteAllText($Out, '{"passed":true,"nativeCases":3}')
        [IO.File]::WriteAllText($Err, '')
        if ($script:diagnosticMode -eq 'native') { return 9 }
        return 0
    }
    $detail = @{ cases = 27; passed = 0; scope = 'synthetic-task-source-behavior-no-guest-or-VM-effects';
        diagnostic = @{ case = 'positive'; phase = 'source-execution'; errorKind = 'script-timeout' } }
    if ($script:diagnosticMode -eq 'extra-field') { $detail.diagnostic.private = 'PRIVATE_SENTINEL' }
    if ($script:diagnosticMode -eq 'unknown-case') { $detail.diagnostic.case = 'PRIVATE_SENTINEL' }
    if ($script:diagnosticMode -eq 'result-refused') { $detail = @{ cases = 27; passed = 26 } }
    $text = if ($script:diagnosticMode -eq 'malformed') { 'PRIVATE_SENTINEL' } else { $detail | ConvertTo-Json -Compress -Depth 4 }
    [IO.File]::WriteAllText($Out, $text)
    [IO.File]::WriteAllText($Err, $(if ($script:diagnosticMode -eq 'stderr') { 'PRIVATE_SENTINEL' } else { '' }))
    if ($script:diagnosticMode -eq 'invoke') { throw 'native-process-deadline' }
    if ($script:diagnosticMode -cin @('stderr', 'result-refused')) { return 0 }
    return 1
}
'@
    $entryText = $wrapperText.Replace(". (Join-Path `$PSScriptRoot 'cloud-guest-media.ps1')", $stub).Replace('$PSScriptRoot', '$script:diagnosticSourceRoot')
    $entry = [scriptblock]::Create($entryText)
    $refused = $false
    try { & $entry 6>&1 | ForEach-Object { $messages.Add($_.ToString()) } } catch { $refused = $true }
    if (!$refused -or $null -eq $script:diagnosticFixture -or (Test-Path -LiteralPath $script:diagnosticFixture) -or ($messages -join '').Contains('PRIVATE_SENTINEL')) { throw 'shell-diagnostic-control-refused' }
    $failures = @($messages | Where-Object { $_.Contains('"scope":"shell-control-failure"') })
    if ($failures.Count -ne 1) { throw 'shell-diagnostic-control-refused' }
    $value = $failures[0] | ConvertFrom-Json
    $expectedCase = if ($mode -ceq 'native') { 'native' } else { 'model' }
    $expectedReason = if ($mode -ceq 'invoke') { 'invoke-refused' } elseif ($mode -ceq 'stderr') { 'child-stderr' }
        elseif ($mode -ceq 'result-refused') { 'result-refused' } else { 'child-nonzero' }
    if ($value.case -cne $expectedCase -or $value.reason -cne $expectedReason -or $value.stdoutBytes -lt 1 -or
        $value.stderrBytes -ne $(if ($mode -ceq 'stderr') { 16 } else { 0 }) -or
        $value.budgetMilliseconds -ne $(if ($mode -ceq 'native') { 15000 } else { 5000 })) { throw 'shell-diagnostic-control-refused' }
    if ($mode -cin @('nonzero', 'invoke', 'stderr')) {
        if ($value.model.case -cne 'positive' -or $value.model.phase -cne 'source-execution' -or
            $value.model.errorKind -cne 'script-timeout' -or $value.model.completedCases -ne 0) { throw 'shell-diagnostic-control-refused' }
    } elseif ($null -ne $value.model) { throw 'shell-diagnostic-control-refused' }
    if ($mode -ceq 'invoke') { if ($null -ne $value.exitCode) { throw 'shell-diagnostic-control-refused' } }
    elseif ($value.exitCode -ne $(if ($mode -ceq 'native') { 9 } elseif ($mode -cin @('stderr', 'result-refused')) { 0 } else { 1 })) { throw 'shell-diagnostic-control-refused' }
    $completed++
}
Remove-Variable diagnosticMode, diagnosticCalls, diagnosticFixture, diagnosticSourceRoot -Scope Script
Write-Host ('shell-wrapper-diagnostic-controls:' + $completed)

# Real Node executions of altered disposable copies test the model failure emitter.
# The VM timeout and native invocation budget match the existing model limits.
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$modelRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-shell-model-diagnostic-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $modelRoot | Out-Null
try {
    foreach ($leaf in @('test-cloud-guest-task.cjs', 'cloud-guest-task.cjs', 'protocol.cjs', 'route-protocol.cjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $leaf) -Destination (Join-Path $modelRoot $leaf)
    }
    $modelPath = Join-Path $modelRoot 'test-cloud-guest-task.cjs'; $taskPath = Join-Path $modelRoot 'cloud-guest-task.cjs'
    $originalModel = [IO.File]::ReadAllText($modelPath); $originalTask = [IO.File]::ReadAllText($taskPath)
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    foreach ($mode in @('script-timeout', 'assertion', 'late-assertion', 'other')) {
        $modelText = $originalModel; $taskText = $originalTask
        $pattern = if ($mode -ceq 'script-timeout') { 'const\s+taskBegin\s*=\s*performance\.now\(\)\s*;' }
            elseif ($mode -ceq 'assertion') { 'assert\.equal\(positive\.process\.exitCode,\s*0\)\s*;' }
            elseif ($mode -ceq 'late-assertion') { 'assert\.equal\(refused\.result\.passed,\s*false\)\s*;\s*assert\.equal\(refused\.process\.exitCode,\s*1\)\s*;\s*assert\.equal\(refused\.result\.stage,\s*["'']direct-routes["'']\)\s*;' }
            else { 'const\s+positive\s*=\s*run\(["'']positive["'']\)\s*;' }
        $mutationSource = if ($mode -ceq 'script-timeout') { $taskText } else { $modelText }
        if ([regex]::Matches($mutationSource, $pattern).Count -ne 1) { throw 'shell-model-mutation-target-refused' }
        $replacement = if ($mode -ceq 'script-timeout') { 'const taskBegin = performance.now(); while (true) {}' }
            elseif ($mode -ceq 'assertion') { 'assert.equal(positive.process.exitCode, "PRIVATE_SENTINEL");' }
            elseif ($mode -ceq 'late-assertion') { 'assert.equal(refused.result.passed, "PRIVATE_SENTINEL"); assert.equal(refused.process.exitCode, 1); assert.equal(refused.result.stage, "direct-routes");' }
            else { 'throw new Error("PRIVATE_SENTINEL"); const positive = run("positive");' }
        $mutated = [regex]::Replace($mutationSource, $pattern, $replacement)
        if ($mutated -ceq $mutationSource) { throw 'shell-model-mutation-target-refused' }
        if ($mode -ceq 'script-timeout') { $taskText = $mutated } else { $modelText = $mutated }
        [IO.File]::WriteAllText($modelPath, $modelText, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($taskPath, $taskText, [Text.UTF8Encoding]::new($false))
        $stdout = Join-Path $modelRoot ($mode + '.json'); $stderr = Join-Path $modelRoot ($mode + '.stderr')
        $code = Invoke-CloudGuestNativeProcess $node @(('"' + $modelPath + '"')) $stdout $stderr 5000
        $text = [IO.File]::ReadAllText($stdout); $value = $text | ConvertFrom-Json
        $expectedCase = if ($mode -ceq 'late-assertion') { 'route-partial' } elseif ($mode -ceq 'other') { 'initialization' } else { 'positive' }
        $expectedPhase = if ($mode -ceq 'script-timeout') { 'source-execution' } elseif ($mode -ceq 'other') { 'source-load' } else { 'assertions' }
        $expectedKind = if ($mode -ceq 'late-assertion') { 'assertion' } else { $mode }
        if ($code -ne 1 -or (Get-Item -LiteralPath $stderr).Length -ne 0 -or $text.Contains('PRIVATE_SENTINEL') -or
            $value.cases -ne 27 -or $value.passed -ne $(if ($mode -ceq 'late-assertion') { 19 } else { 0 }) -or
            $value.diagnostic.case -cne $expectedCase -or $value.diagnostic.phase -cne $expectedPhase -or $value.diagnostic.errorKind -cne $expectedKind) { throw 'shell-model-diagnostic-control-refused' }
        Write-Host ('shell-model-diagnostic-' + $mode + ':passed')
    }
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $modelRoot -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($modelRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'shell-model-diagnostic-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $modelRoot
}
