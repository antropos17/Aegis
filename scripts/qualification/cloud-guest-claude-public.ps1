function Save-CloudGuestClaudeBinary([string]$TransferRoot, [string]$ScratchRoot) {
    Assert-CloudGuestRunner
    $binary = Join-Path $TransferRoot 'claude.exe'
    [CloudGuestClaudeDownload]::Download($binary) | Out-Null
    $metadata = Join-Path $PSScriptRoot 'claude-public'
    $sourceFile = Get-Item -LiteralPath (Join-Path $metadata 'provenance.ps1') -Force
    if ($sourceFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $sourceFile.Length -gt 64KB) { throw 'claude-provenance-source-refused' }
    # Source is transferred unchanged from the frozen reviewed donor and indexed by lab sourceHashes.
    $bytes = [IO.File]::ReadAllBytes($sourceFile.FullName)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    if ($digest -cne 'c0d0ff835af23fe4f67862887b610f193809f479666c6a7166c3711a6ea8f7fe') { throw 'claude-provenance-source-refused' }
    $source = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    # The verifier uses the already installed Git-for-Windows/MSYS gpg path.
    $gpg = 'C:\Program Files\Git\usr\bin\gpg.exe'
    $selectedScratch = Join-Path $ScratchRoot 'claude-public'
    if (Test-Path -LiteralPath $selectedScratch) { throw 'claude-provenance-scratch-not-fresh' }
    New-Item -ItemType Directory -Path $selectedScratch | Out-Null
    # Dot-source captured ScriptBlock; file execution policy remains unchanged.
    . ([scriptblock]::Create($source)) -BinaryPath $binary -GpgPath $gpg -OwnedScratch $selectedScratch -MetadataRoot $metadata
    $proof = Test-CloudClaudeProvenance
    if ($proof.passed -isnot [bool] -or !$proof.passed -or $proof.manifestSignatureVerified -isnot [bool] -or !$proof.manifestSignatureVerified -or
        $proof.authenticodeValid -isnot [bool] -or !$proof.authenticodeValid -or $proof.bytes -ne 254858400 -or
        $proof.sha256 -cne 'eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23') { throw 'claude-provenance-refused' }
    return $proof
}
