# Internal observation helper. The Node CLI owns input, deadline and receipt policy.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$stream = $null
$hasher = $null
$answer = @{ schemaVersion = 1; code = 'HELPER_REFUSED' }
try {
    $inputBuffer = New-Object char[] 1025
    $inputCount = 0
    while ($inputCount -lt $inputBuffer.Length) {
        $readCount = [Console]::In.Read($inputBuffer, $inputCount, $inputBuffer.Length - $inputCount)
        if ($readCount -eq 0) { break }
        $inputCount += $readCount
    }
    if ($inputCount -eq 1025) { throw 'refused' }
    $request = ConvertFrom-Json (-join $inputBuffer[0..($inputCount - 1)])
    if ((($request.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'artifact,expectedSha256') { throw 'refused' }
    $artifact = $request.artifact
    if ($artifact -isnot [string] -or $artifact.Length -gt 240 -or $artifact -notmatch '^[a-zA-Z]:[\\/]') { throw 'refused' }
    if ($request.expectedSha256 -isnot [string] -or $request.expectedSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'refused' }
    $components = $artifact.Substring(3) -split '[/\\]'
    foreach ($component in $components) {
        if (!$component -or $component -eq '.' -or $component -eq '..' -or $component -match '[. ]$|[:*?"<>|\x00-\x1f\x7f]' -or $component -match '^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)') { throw 'refused' }
    }
    if ([IO.Path]::GetExtension($artifact) -ine '.exe') { throw 'refused' }
    $current = $artifact
    while ($current) {
        if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refused' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    # Deny ordinary concurrent writes/deletes while Windows observes this exact path.
    $stream = [IO.File]::Open($artifact, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $length = $stream.Length
    if ($length -lt 68 -or $length -gt 536870912) { throw 'refused' }
    $hasher = [Security.Cryptography.SHA256]::Create()
    $before = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    if ($before -cne $request.expectedSha256) { throw 'refused' }
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $artifact -ErrorAction Stop
    $status = [string]$signature.Status
    $signatureType = [string]$signature.SignatureType
    if ($status -cnotin @('Valid', 'UnknownError', 'NotSigned', 'HashMismatch', 'NotTrusted', 'NotSupportedFileFormat', 'Incompatible')) { throw 'refused' }
    if ($signatureType -cnotin @('None', 'Authenticode', 'Catalog')) { throw 'refused' }
    $signerHash = $null
    if ($null -ne $signature.SignerCertificate) {
        $signerHash = [BitConverter]::ToString($hasher.ComputeHash($signature.SignerCertificate.RawData)).Replace('-', '').ToLowerInvariant()
    }
    $stream.Position = 0
    $after = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    if ($before -cne $after -or $length -ne $stream.Length) { throw 'refused' }
    $answer = @{
        schemaVersion = 1; code = 'OBSERVED'; artifactSha256 = $before; bytes = $length
        status = $status; signatureType = $signatureType; signerCertificateSha256 = $signerHash
        timestampPresent = ($null -ne $signature.TimeStamperCertificate)
    }
} catch {
    # Keep provider errors, subjects, paths and certificate details out of all output.
    $answer = @{ schemaVersion = 1; code = 'HELPER_REFUSED' }
} finally {
    if ($null -ne $hasher) { $hasher.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}
[Console]::Out.WriteLine((ConvertTo-Json -Compress $answer))
