Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$parent = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner-probe-temp-refused' }; $parent = $parent.Parent }
$fixture=Join-Path $env:TEMP ('aegis-owner-probe-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $exe=Join-Path $fixture 'owner-controls.exe'
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $arguments=@('/nologo','/warnaserror+','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll',('/out:"'+$exe+'"'))
    foreach($leaf in @('CloudGuestDesktop.cs','CloudGuestOwnerProbeFixture.cs')) { $arguments+=('"'+(Join-Path $PSScriptRoot $leaf)+'"') }
    $code=Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $fixture 'compile.txt') (Join-Path $fixture 'compile.error') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) { throw 'owner-probe-compile-refused' }
    foreach($mode in @('slow','timeout','stderr','good')) { Copy-Item -LiteralPath $exe -Destination (Join-Path $fixture ($mode+'-node.exe')) }
    $output=Join-Path $fixture 'native.jsonl'; $errorFile=Join-Path $fixture 'native.error'
    $code=Invoke-CloudGuestNativeProcess $exe @() $output $errorFile 15000
    if ($code -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 8192 -or (Get-Item -LiteralPath $errorFile).Length -ne 0) { throw 'owner-probe-native-refused' }
    $rows=@([IO.File]::ReadAllLines($output)|ForEach-Object { $_|ConvertFrom-Json })
    if ($rows.Count -ne 5 -or $rows[4].nativeControls -ne 4 -or $rows[4].guestNodeQualified -ne $false -or $rows[4].launchAllowed -ne $false) { throw 'owner-probe-receipt-refused' }
    foreach($row in $rows) { $row|ConvertTo-Json -Depth 5 -Compress }
} finally {
    foreach($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'owner-probe-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}
