Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$base = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $base -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'shell-control-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $base ('aegis-shell-control-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    foreach ($case in @(@('native', 'test-cloud-guest-shell.cjs', 15000, 3), @('model', 'test-cloud-guest-task.cjs', 5000, 25))) {
        $stdout = Join-Path $fixture ($case[0] + '.json'); $stderr = Join-Path $fixture ($case[0] + '.stderr')
        $code = Invoke-CloudGuestNativeProcess $node @(('"' + (Join-Path $PSScriptRoot $case[1]) + '"')) $stdout $stderr $case[2]
        if ($code -ne 0 -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'shell-controls-refused' }
        $text = [IO.File]::ReadAllText($stdout); $value = $text | ConvertFrom-Json
        if ($case[0] -ceq 'native') { if ($value.passed -isnot [bool] -or !$value.passed -or $value.nativeCases -ne $case[3]) { throw 'shell-native-controls-refused' } }
        elseif ($value.cases -ne $case[3] -or $value.passed -ne $case[3]) { throw 'shell-model-controls-refused' }
        $text.Trim()
    }
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'shell-control-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
