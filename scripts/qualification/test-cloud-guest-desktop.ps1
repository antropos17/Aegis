Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$temporary = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$parent = Get-Item -LiteralPath $temporary -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'desktop-fixture-reparse-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $temporary ('aegis-guest-desktop-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $exe = Join-Path $fixture 'desktop-controls.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $arguments = @('/nologo', '/target:exe', '/platform:x64', '/warnaserror+', ('/out:"' + $exe + '"'))
    foreach ($leaf in @('CloudGuestDesktop', 'CloudGuestDesktopFixture')) { $arguments += ('"' + (Join-Path $PSScriptRoot ($leaf + '.cs')) + '"') }
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) { throw 'desktop-fixture-compile-failed' }
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $output = Join-Path $fixture 'native.jsonl'; $errorFile = Join-Path $fixture 'native.error'
    $code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"')) $output $errorFile 15000
    if ($code -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 2048 -or (Get-Item -LiteralPath $errorFile).Length -ne 0) { throw 'desktop-native-control-failed' }
    $rows = @([IO.File]::ReadAllLines($output) | ForEach-Object { $_ | ConvertFrom-Json })
    if ($rows.Count -ne 2 -or $rows[0].baselineExit -ne 0 -or $rows[0].privateDesktopExit -ne 0 -or
        $rows[0].documentedPrivateDesktopExit -ne 0 -or $rows[0].negativeDesktopExitOrAccess -notin @(3221225794, 5) -or !$rows[1].parentRestored) { throw 'desktop-loader-negative-missing' }
    $names = @($rows[1].PSObject.Properties.Name)
    $qualified = if ($names -ccontains 'privateStationExit') { $rows[1].privateStationExit -eq 0 -and $rows[1].handlesClosed } else { $false }
    if (!$qualified -and ($names -cnotcontains 'privateStationAvailable' -or $rows[1].privateStationAvailable -ne $false -or $rows[1].win32Error -ne 5)) { throw 'desktop-station-unavailable-unclassified' }
    @{ scope = 'new-private-user-objects-only'; nativeLoaderControls = 4; documentedPrivateDesktopExit = $rows[0].documentedPrivateDesktopExit; negativeDesktopExitOrAccess = $rows[0].negativeDesktopExitOrAccess; privateStationQualified = [bool]$qualified; parentRestored = $true; crossPrincipalQualified = $false; launchAllowed = $false } | ConvertTo-Json -Compress
} finally {
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB -or !$file.FullName.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'desktop-fixture-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName -Force
    }
    Remove-Item -LiteralPath $fixture
}
