param([string]$BinaryPath, [string]$GpgPath, [string]$OwnedScratch, [string]$MetadataRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

# Host-only verifier for fixed public bytes. No installer, agent, private key or global keyring.
function Read-CloudClaudePinnedMetadata([string]$Name, [int]$Limit, [string]$ExpectedHash) {
    $selected = Get-Item -LiteralPath (Join-Path $MetadataRoot $Name) -Force
    if ($selected.PSIsContainer -or $selected.Attributes -band [IO.FileAttributes]::ReparsePoint -or $selected.Length -gt $Limit) { throw 'metadata-refused' }
    $held = [IO.File]::Open($selected.FullName, 'Open', 'Read', 'Read')
    try {
        $data = [byte[]]::new([int]$held.Length); $offset = 0
        while ($offset -lt $data.Length) { $count = $held.Read($data, $offset, $data.Length - $offset); if ($count -eq 0) { throw 'metadata-refused' }; $offset += $count }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($data)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($digest -cne $ExpectedHash) { throw 'metadata-hash-refused' }
        return ,$data
    } finally { $held.Dispose() }
}
function Invoke-CloudClaudePublicGpg([string[]]$Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $GpgPath; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.WorkingDirectory = $OwnedScratch
    $info.EnvironmentVariables.Clear()
    $info.EnvironmentVariables['SystemRoot'] = $env:SystemRoot; $info.EnvironmentVariables['WINDIR'] = $env:SystemRoot
    $info.EnvironmentVariables['HOME'] = $OwnedScratch
    $info.EnvironmentVariables['TEMP'] = $OwnedScratch; $info.EnvironmentVariables['TMP'] = $OwnedScratch
    $info.EnvironmentVariables['GNUPGHOME'] = $script:GpgHome
    # All arguments are locally fixed or quoted retained paths; no shell is involved.
    $info.Arguments = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $child = [Diagnostics.Process]::new(); $child.StartInfo = $info; $started = $false
    try {
        $started = $child.Start(); if (!$started) { throw 'signature-process-refused' }
        $out = [Text.StringBuilder]::new(); $err = [Text.StringBuilder]::new()
        $errBuffer = [char[]]::new(256); $outBuffer = [char[]]::new(256)
        # One bounded block pending on each stream, avoiding unbounded ReadToEnd.
        $outRead = $child.StandardOutput.ReadAsync($outBuffer, 0, 256)
        $errRead = $child.StandardError.ReadAsync($errBuffer, 0, 256)
        $watch = [Diagnostics.Stopwatch]::StartNew(); $outClosed = $false; $errClosed = $false
        while (!$outClosed -or !$errClosed -or !$child.HasExited) {
            if ($watch.ElapsedMilliseconds -ge 5000) { throw 'signature-process-deadline' }
            foreach ($which in @('out', 'err')) {
                $read = if ($which -ceq 'out') { $outRead } else { $errRead }
                $done = if ($which -ceq 'out') { $outClosed } else { $errClosed }
                if (!$done -and $read.IsCompleted) {
                    $count = $read.GetAwaiter().GetResult()
                    if ($count -eq 0) { if ($which -ceq 'out') { $outClosed = $true } else { $errClosed = $true } }
                    elseif ($which -ceq 'out') { [void]$out.Append($outBuffer, 0, $count); if ($out.Length -gt 8192) { throw 'signature-output-limit' }; $outRead = $child.StandardOutput.ReadAsync($outBuffer, 0, 256) }
                    else { [void]$err.Append($errBuffer, 0, $count); if ($err.Length -gt 8192) { throw 'signature-output-limit' }; $errRead = $child.StandardError.ReadAsync($errBuffer, 0, 256) }
                }
            }
            [Threading.Thread]::Sleep(1)
        }
        if ($child.ExitCode -ne 0) { throw 'signature-process-failed' }
        return $out.ToString()
    } finally {
        if ($started -and !$child.HasExited) { $child.Kill(); [void]$child.WaitForExit(1000) }
        $child.Dispose()
    }
}
function Test-CloudClaudeProvenance {
    if (![IO.Path]::IsPathRooted($BinaryPath) -or [IO.Path]::GetFileName($BinaryPath) -cne 'claude.exe' -or
        ![IO.Path]::IsPathRooted($GpgPath) -or [IO.Path]::GetFileName($GpgPath) -cne 'gpg.exe' -or
        ![IO.Path]::IsPathRooted($OwnedScratch) -or !(Test-Path -LiteralPath $OwnedScratch -PathType Container) -or
        ![IO.Path]::IsPathRooted($MetadataRoot) -or !(Test-Path -LiteralPath $MetadataRoot -PathType Container)) { throw 'provenance-input-refused' }
    foreach ($selected in @($BinaryPath, $GpgPath, $OwnedScratch, $MetadataRoot)) {
        $entry = Get-Item -LiteralPath $selected -Force
        while ($entry) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'provenance-reparse-refused' }; $entry = if ($entry -is [IO.DirectoryInfo]) { $entry.Parent } elseif ($entry -is [IO.FileInfo]) { $entry.Directory } else { throw 'provenance-input-refused' } }
    }
    $manifestBytes = Read-CloudClaudePinnedMetadata 'official-manifest.json' 32768 '64f5abe05a43151810acf8c25169872e41293c96d3ae73d6508733a8b336e2b1'
    $sig = Read-CloudClaudePinnedMetadata 'official-manifest.json.sig' 8192 '537e1a8bcca1646fd5e52d3dc8d16509395a88f6f18b13765b2c085d057567ea'
    $key = Read-CloudClaudePinnedMetadata 'official-release-key.asc' 16384 'bd70a5e4a268002704024ceba7f8446024114e94f3f0bdd11c23a9e592be81c6'
    $utf8 = [Text.UTF8Encoding]::new($false, $true); $manifest = $utf8.GetString($manifestBytes) | ConvertFrom-Json
    $pin = $manifest.platforms.'win32-x64'
    if ($manifest.version -cne '2.1.292' -or $pin.binary -cne 'claude.exe' -or $pin.size -ne 254858400 -or
        $pin.checksum -cne 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23') { throw 'manifest-pin-refused' }
    $directory = Join-Path $OwnedScratch 'claude-public-verification'
    if (Test-Path -LiteralPath $directory) { throw 'signature-scratch-not-fresh' }
    [void][IO.Directory]::CreateDirectory($directory)
    [IO.File]::WriteAllBytes((Join-Path $directory 'manifest.json'), $manifestBytes)
    [IO.File]::WriteAllBytes((Join-Path $directory 'manifest.json.sig'), $sig)
    [IO.File]::WriteAllBytes((Join-Path $directory 'key.asc'), $key)
    # Git-for-Windows gpg expects MSYS paths; this helper requires that existing tool.
    $unix = '/' + $directory.Substring(0, 1).ToLowerInvariant() + $directory.Substring(2).Replace('\', '/')
    $keyringDirectory = Join-Path $OwnedScratch 'pgp'
    $script:GpgHome = '/' + $keyringDirectory.Substring(0, 1).ToLowerInvariant() + $keyringDirectory.Substring(2).Replace('\', '/')
    # Git gpg's Unix socket name must fit its native path bound, even with no agent started.
    if ($script:GpgHome.Length -gt 85 -or (Test-Path -LiteralPath $keyringDirectory)) { throw 'signature-scratch-not-fresh' }
    [void][IO.Directory]::CreateDirectory($keyringDirectory)
    $common = @('--no-options', '--homedir', $script:GpgHome, '--batch', '--no-auto-key-retrieve', '--no-autostart', '--status-fd', '1')
    [void](Invoke-CloudClaudePublicGpg ($common + @('--import-options', 'import-minimal', '--import', ($unix + '/key.asc'))))
    $status = Invoke-CloudClaudePublicGpg ($common + @('--verify', ($unix + '/manifest.json.sig'), ($unix + '/manifest.json')))
    $valid = @($status -split "`r?`n" | Where-Object { $_ -cmatch '^\[GNUPG:\] VALIDSIG 31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE ' })
    if ($valid.Count -ne 1 -or $status -cmatch '\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG) ') { throw 'manifest-signature-refused' }
    $file = Get-Item -LiteralPath $BinaryPath -Force
    if ($file.PSIsContainer -or $file.Length -ne 254858400 -or $file.Length -gt 384MB) { throw 'binary-size-refused' }
    $held = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read')
    try {
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($held)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ($digest -cne $pin.checksum) { throw 'binary-hash-refused' }
        $auth = Get-AuthenticodeSignature -LiteralPath $file.FullName
        if (!$auth.SignerCertificate) { throw 'binary-authenticode-refused' }
        $publisher = $auth.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
        if ($auth.Status.ToString() -cne 'Valid' -or $publisher -cne 'Anthropic, PBC') { throw 'binary-authenticode-refused' }
    } finally { $held.Dispose() }
    return [ordered]@{ schemaVersion = 1; version = '2.1.292'; platform = 'win32-x64'; bytes = 254858400; sha256 = $digest;
        maximumBinaryBytes = 402653184; manifestSignatureVerified = $true; manifestSigner = '31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE';
        authenticodeValid = $true; publisher = $publisher; supplierUrl = 'https://downloads.claude.ai/claude-code-releases/2.1.292/win32-x64/claude.exe';
        manifestUrl = 'https://downloads.claude.ai/claude-code-releases/2.1.292/manifest.json'; passed = $true; scope = 'fixed-public-artifact-provenance-no-provider-launch' }
}
if ($MyInvocation.InvocationName -ne '.') {
    try { Test-CloudClaudeProvenance | ConvertTo-Json -Depth 4 }
    catch {
        $knownFailures = @('metadata-refused', 'metadata-hash-refused', 'signature-process-refused', 'signature-process-deadline',
            'signature-output-limit', 'signature-process-failed', 'provenance-input-refused', 'provenance-reparse-refused',
            'manifest-pin-refused', 'signature-scratch-not-fresh', 'manifest-signature-refused', 'binary-size-refused',
            'binary-hash-refused', 'binary-authenticode-refused')
        $failure = if ($_.Exception.Message -cin $knownFailures) { $_.Exception.Message } else { 'provenance-refused' }
        [ordered]@{ schemaVersion = 1; passed = $false; failure = $failure; scope = 'fixed-public-artifact-provenance-no-provider-launch' } | ConvertTo-Json; exit 1
    }
}
