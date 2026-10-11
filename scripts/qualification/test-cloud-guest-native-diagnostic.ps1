Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$root = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('aegis-native-diagnostic-' + [guid]::NewGuid().ToString('N'))
$parent = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'diagnostic-test-parent-refused' }; $parent = $parent.Parent }
New-Item -ItemType Directory -Path $root | Out-Null
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$originalError = [Console]::Error
$capture = [IO.StringWriter]::new()
$passed = 0
function Require([bool]$Value) { if (!$Value) { throw 'native-diagnostic-control-failed' } }
try {
    [Console]::SetError($capture)
    $out = Join-Path $root 'positive.stdout'; $err = Join-Path $root 'positive.stderr'
    $code = Invoke-CloudGuestNativeProcess $powershell @('-NoProfile', '-Command', '"[Console]::Out.Write(''PRIVATE_OUT''); [Console]::Error.Write(''PRIVATE_ERR''); exit 7"') $out $err 5000 -DiagnosticPhase diagnostics-compile
    Require ($code -eq 7 -and [IO.File]::ReadAllText($out) -ceq 'PRIVATE_OUT' -and [IO.File]::ReadAllText($err) -ceq 'PRIVATE_ERR' -and $capture.ToString().Length -eq 0); $passed++
    $out = Join-Path $root 'deadline.stdout'; $err = Join-Path $root 'deadline.stderr'
    $failure = $null
    try { Invoke-CloudGuestNativeProcess $powershell @('-NoProfile', '-Command', '"[Console]::Out.WriteLine($PID); [Console]::Error.Write(''PRIVATE_ERR''); Start-Sleep -Seconds 10"') $out $err 1500 -DiagnosticPhase diagnostics-compile | Out-Null }
    catch { $failure = $_.Exception.Message }
    Require ($failure -ceq 'native-process-deadline')
    $line = $capture.ToString().Trim()
    Require ($line.Length -lt 512 -and !$line.Contains('PRIVATE') -and !$line.Contains($root) -and !$line.Contains($powershell) -and $line.Split([char]10).Count -eq 1)
    $diagnostic = $line | ConvertFrom-Json
    Require ((@($diagnostic.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'budgetMilliseconds,childExited,code,elapsedMilliseconds,phase,schemaVersion,stderrBytes,stderrEof,stdoutBytes,stdoutEof')
    Require ($diagnostic.schemaVersion -eq 1 -and $diagnostic.phase -ceq 'diagnostics-compile' -and $diagnostic.code -ceq 'native-process-deadline' -and $diagnostic.budgetMilliseconds -eq 1500)
    Require ($diagnostic.elapsedMilliseconds -ge 1500 -and $diagnostic.childExited -is [bool] -and !$diagnostic.childExited -and $diagnostic.stdoutEof -is [bool] -and $diagnostic.stderrEof -is [bool])
    Require ($diagnostic.stdoutBytes -gt 0 -and $diagnostic.stdoutBytes -le 65536 -and $diagnostic.stderrBytes -eq 11)
    $childId = [int]([IO.File]::ReadAllText($out).Trim())
    Require ($null -eq (Get-Process -Id $childId -ErrorAction SilentlyContinue))
    foreach ($file in @($out, $err)) { $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); $stream.Dispose() }; $passed++
    $capture.GetStringBuilder().Clear() | Out-Null
    $failure = $null
    try { Invoke-CloudGuestNativeProcess $powershell @('-NoProfile', '-Command', '"Start-Sleep -Seconds 10"') (Join-Path $root 'quiet.stdout') (Join-Path $root 'quiet.stderr') 1000 | Out-Null }
    catch { $failure = $_.Exception.Message }
    Require ($failure -ceq 'native-process-deadline' -and $capture.ToString().Length -eq 0); $passed++
    $code = Invoke-CloudGuestNativeProcess $powershell @('-NoProfile', '-Command', '"Start-Sleep -Seconds 11; exit 0"') (Join-Path $root 'slow.stdout') (Join-Path $root 'slow.stderr') 30000 -DiagnosticPhase diagnostics-compile
    Require ($code -eq 0 -and $capture.ToString().Length -eq 0); $passed++
} finally {
    [Console]::SetError($originalError); $capture.Dispose()
    foreach ($file in @(Get-ChildItem -LiteralPath $root -Force)) {
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 64KB) { throw 'diagnostic-test-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $root
}
@{ passed = $passed; cases = 4; scope = 'bounded-native-diagnostic-disposable-processes'; observedDeadline = $diagnostic; launchAllowed = $false } | ConvertTo-Json -Compress
