Set-StrictMode -Version Latest

function Build-CloudGuestOwnerLifetime([string]$ProjectRoot, [string]$SourceRoot, [string]$OutputRoot) {
    $output = Join-Path $OutputRoot 'guest-owner-lifetime.exe'
    if (Test-Path -LiteralPath $output) { throw 'owner-lifetime-fresh-build-required' }
    $sources = @((Join-Path $SourceRoot 'CloudGuestOwnerLifetime.cs'),
        (Join-Path $ProjectRoot 'sidecar/session/GuestJobNative.cs'), (Join-Path $ProjectRoot 'sidecar/session/GuestJobInventory.cs'))
    $arguments = @('/nologo', '/target:exe', '/platform:x64', '/optimize+', '/warnaserror+',
        '/reference:System.Web.Extensions.dll', ('/out:"' + $output + '"'))
    $pins = @{}; $sizes = @{}
    foreach ($source in $sources) {
        $file = Get-Item -LiteralPath $source -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 64KB) { throw 'owner-lifetime-source-budget-refused' }
        $pins[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $sizes[$file.FullName] = $file.Length; $arguments += ('"' + $file.FullName + '"')
    }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments ($output + '.stdout') ($output + '.stderr') 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 64KB -or (Get-Item -LiteralPath ($output + '.stderr')).Length -ne 0) { throw 'owner-lifetime-native-build-refused' }
    foreach ($source in $sources) {
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pins[$source]) { throw 'owner-lifetime-build-input-changed' }
    }
    return @{ path = $output; sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant();
        bytes = (Get-Item -LiteralPath $output).Length; sourceHashes = $pins; sourceBytes = $sizes;
        compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() }
}
