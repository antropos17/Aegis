Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop' -or [IntPtr]::Size -ne 8) { throw 'sealed-copy-controls-powershell51-x64-required' }
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
function Assert-SealedControlDirectory([string]$Path) {
    $selected = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    while ($null -ne $selected) {
        if ($selected -isnot [IO.DirectoryInfo] -or $selected.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'sealed-copy-control-path-refused' }
        $selected = $selected.Parent
    }
}
if ([string]::IsNullOrWhiteSpace($env:TEMP)) { throw 'sealed-copy-control-temp-required' }
$parent = [IO.Path]::GetFullPath($env:TEMP); Assert-SealedControlDirectory $parent
if ($parent -cnotmatch '^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$') { throw 'sealed-copy-controls-native-path-profile-refused' }
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($parent))
if ($drive.AvailableFreeSpace -lt 16MB) { throw 'sealed-copy-control-space-refused' }
$owned = Join-Path $parent ('aegis-sealed-copy-controls-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $owned) { throw 'sealed-copy-control-root-exists' }
New-Item -ItemType Directory -Path $owned -ErrorAction Stop | Out-Null
Assert-SealedControlDirectory $owned
$savedTemp = $env:TEMP; $savedTmp = $env:TMP; $complete = $false
$files = [Collections.Generic.List[string]]::new(); $directories = [Collections.Generic.List[string]]::new()
try {
    $env:TEMP = $owned; $env:TMP = $owned
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $nodeItem = Get-Item -LiteralPath $node -Force
    if ($nodeItem.PSIsContainer -or $nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'sealed-copy-control-node-refused' }
    $native = Join-Path $owned 'native'; $stdout = Join-Path $owned 'native.txt'; $stderr = Join-Path $owned 'native.error.txt'
    $arguments = @(('"' + (Join-Path $PSScriptRoot 'test-cloud-sealed-copy.cjs') + '"'), ('"' + $native + '"'))
    $code = Invoke-CloudGuestNativeProcess $node $arguments $stdout $stderr 30000
    if ($code -ne 0 -or (Get-Item -LiteralPath $stdout).Length -gt 16KB -or (Get-Item -LiteralPath $stderr).Length -ne 0) { throw 'sealed-copy-native-controls-refused' }
    $nativeResult = [IO.File]::ReadAllText((Join-Path $native 'control-summary.json')) | ConvertFrom-Json
    if ($nativeResult.tests -ne 2 -or !$nativeResult.artifactObserved -or $nativeResult.bytes -gt 16MB) { throw 'sealed-copy-native-controls-refused' }
    $verifier = & (Join-Path $PSScriptRoot 'test-cloud-sealed-copy-verifier.ps1') -NativeEvidence $native | ConvertFrom-Json
    if ($verifier.passed -isnot [bool] -or !$verifier.passed -or $verifier.controls -ne 133) { throw 'sealed-copy-verifier-controls-refused' }
    # Collect only this exact fresh root, reject links and enforce a finite output budget before deletion.
    $budget = @{ entries = 0; bytes = 0 }
    function Measure-SealedControlDirectory([string]$Directory, [int]$Depth) {
        if ($Depth -gt 8) { throw 'sealed-copy-control-output-refused' }
        $iterator = [IO.Directory]::EnumerateFileSystemEntries($Directory).GetEnumerator()
        try {
            while ($iterator.MoveNext()) {
                if (++$budget.entries -gt 256) { throw 'sealed-copy-control-output-refused' }
                $entry = Get-Item -LiteralPath $iterator.Current -Force
                if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'sealed-copy-control-output-refused' }
                if ($entry.PSIsContainer) { Measure-SealedControlDirectory $entry.FullName ($Depth + 1); $directories.Add($entry.FullName) }
                else { $budget.bytes += $entry.Length; if ($budget.bytes -gt 16MB) { throw 'sealed-copy-control-output-refused' }; $files.Add($entry.FullName) }
            }
        } finally { $iterator.Dispose() }
    }
    Measure-SealedControlDirectory $owned 0
    $build = [IO.File]::ReadAllText((Join-Path $native 'build-provenance.json')) | ConvertFrom-Json
    $receipt = [IO.File]::ReadAllText((Join-Path $native 'local-consumption.json')) | ConvertFrom-Json
    $summary = [ordered]@{ schemaVersion = 1; kind = 'fixed-sealed-copy-maintained-controls'; passed = $true;
        nativeTests = 2; verifierControls = 133; nativeBuild = $build; localConsumption = $receipt;
        membership = $verifier.membership; outputBytes = $budget.bytes; actualGuestRun = $false;
        commands = @('node test-cloud-sealed-copy.cjs <owned-temp>/native', 'test-cloud-sealed-copy-verifier.ps1 -NativeEvidence <owned-temp>/native');
        retention = 'delete-exact-closed-owned-root-after-success'; e2Qualified = $false; launchAllowed = $false }
    $json = $summary | ConvertTo-Json -Compress -Depth 8
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 16KB) { throw 'sealed-copy-control-output-refused' }
    $complete = $true
} finally {
    $env:TEMP = $savedTemp; $env:TMP = $savedTmp
    if ($complete) {
        # Every child has exited and verifier streams are disposed. Delete the prevalidated finite set only.
        Assert-SealedControlDirectory $owned
        foreach ($file in $files) { [IO.File]::Delete($file) }
        foreach ($directory in $directories) { [IO.Directory]::Delete($directory, $false) }
        [IO.Directory]::Delete($owned, $false)
    }
}
Write-Output $json
