Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
function Get-CloudGuestShellModelDiagnostic([string]$Text) {
    try {
        $value = $Text | ConvertFrom-Json
        if ((@($value.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'cases,diagnostic,passed,scope' -or
            $value.cases -ne 27 -or $value.passed -isnot [int] -or $value.passed -lt 0 -or $value.passed -ge 27 -or
            $value.scope -cne 'synthetic-task-source-behavior-no-guest-or-VM-effects') { return $null }
        $detail = $value.diagnostic
        $cases = @('initialization', 'positive', 'git-partial', 'git-nonzero', 'git-deadline', 'git-malformed', 'git-stderr', 'git-admission-late',
            'wrong-path', 'wrong-work', 'protection-open', 'shell-control-fails', 'shell-marker-mismatch', 'unit-test-nonzero', 'input-private-error',
            'network-nonzero', 'network-deadline', 'network-malformed', 'network-partial', 'network-stderr',
            'route-partial', 'route-nonzero', 'route-deadline', 'route-malformed', 'route-stderr', 'route-permission',
            'sealed-copy-error', 'sealed-copy-refused')
        if ((@($detail.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'case,errorKind,phase' -or $detail.case -cnotin $cases -or
            $detail.phase -cnotin @('source-load', 'source-execution', 'assertions') -or $detail.errorKind -cnotin @('assertion', 'script-timeout', 'other')) { return $null }
        return @{ case = $detail.case; phase = $detail.phase; errorKind = $detail.errorKind; completedCases = $value.passed }
    } catch { return $null }
}
. (Join-Path $PSScriptRoot 'test-cloud-guest-shell-diagnostics.ps1')
$base = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $base -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'shell-control-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $base ('aegis-shell-control-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    foreach ($case in @(@('native', 'test-cloud-guest-shell.cjs', 15000, 3), @('model', 'test-cloud-guest-task.cjs', 5000, 27))) {
        $stdout = Join-Path $fixture ($case[0] + '.json'); $stderr = Join-Path $fixture ($case[0] + '.stderr')
        $code = $null; $reason = 'invoke-refused'; $text = $null
        try {
            $code = Invoke-CloudGuestNativeProcess $node @(('"' + (Join-Path $PSScriptRoot $case[1]) + '"')) $stdout $stderr $case[2]
            $reason = if ($code -ne 0) { 'child-nonzero' } else { 'child-stderr' }
            if ($code -ne 0 -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'shell-controls-refused' }
            $reason = 'result-malformed'; $text = [IO.File]::ReadAllText($stdout); $value = $text | ConvertFrom-Json
            $reason = 'result-refused'
            if ($case[0] -ceq 'native') { if ($value.passed -isnot [bool] -or !$value.passed -or $value.nativeCases -ne $case[3]) { throw 'shell-native-controls-refused' } }
            elseif ($value.cases -ne $case[3] -or $value.passed -ne $case[3]) { throw 'shell-model-controls-refused' }
            $text.Trim()
        } catch {
            $lengths = @(0, 0)
            for ($index = 0; $index -lt 2; $index++) {
                $selected = @($stdout, $stderr)[$index]
                if (Test-Path -LiteralPath $selected) { $lengths[$index] = (Get-Item -LiteralPath $selected).Length }
            }
            $model = $null
            if ($case[0] -ceq 'model' -and $lengths[0] -gt 0 -and $lengths[0] -le 64KB) {
                $model = Get-CloudGuestShellModelDiagnostic ([IO.File]::ReadAllText($stdout))
            }
            # Publish only fixed labels and numeric observations before disposable logs close.
            [ordered]@{ schemaVersion = 1; scope = 'shell-control-failure'; case = $case[0]; reason = $reason;
                exitCode = $code; stdoutBytes = $lengths[0]; stderrBytes = $lengths[1]; budgetMilliseconds = $case[2];
                model = $model } | ConvertTo-Json -Compress -Depth 4 | Write-Host
            throw
        }
    }
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'shell-control-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
