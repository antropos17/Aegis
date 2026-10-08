Set-StrictMode -Version Latest
# Loaded from hash-checked retained bytes by the maintained trusted bootstrap.
function Test-CloudSealedCopyReceipt($Value, [string]$BundleHash, [string]$ManifestHash, [long]$PayloadBytes) {
    try {
        $fields = @($Value.PSObject.Properties.Name | Sort-Object) -join ','
        if ($fields -cne 'bundleSha256,e2Qualified,editedSha256,fileCount,guestEdited,guestReadVerified,initialTestExitCode,kind,launchAllowed,manifestSha256,passed,schemaVersion,sourceUnchanged,testExitCode,totalBytes') { return $false }
        foreach ($name in @('passed', 'sourceUnchanged', 'guestReadVerified', 'guestEdited')) {
            if ($Value.$name -isnot [bool] -or !$Value.$name) { return $false }
        }
        foreach ($name in @('e2Qualified', 'launchAllowed')) {
            if ($Value.$name -isnot [bool] -or $Value.$name) { return $false }
        }
        foreach ($name in @('schemaVersion', 'fileCount', 'totalBytes', 'initialTestExitCode', 'testExitCode')) {
            if ($Value.$name -isnot [int] -and $Value.$name -isnot [long]) { return $false }
        }
        foreach ($name in @('kind', 'bundleSha256', 'manifestSha256', 'editedSha256')) {
            if ($Value.$name -isnot [string]) { return $false }
        }
        return ($Value.schemaVersion -eq 1 -and $Value.kind -ceq 'fixed-sealed-copy' -and $Value.fileCount -eq 4 -and
            $Value.totalBytes -eq $PayloadBytes -and $Value.initialTestExitCode -eq 1 -and $Value.testExitCode -eq 0 -and
            $BundleHash -cmatch '^[a-f0-9]{64}$' -and $ManifestHash -cmatch '^[a-f0-9]{64}$' -and
            $Value.bundleSha256 -ceq $BundleHash -and $Value.manifestSha256 -ceq $ManifestHash -and
            $Value.editedSha256 -ceq (Get-CloudSealedCopyHash ([Text.Encoding]::UTF8.GetBytes("module.exports=(a,b)=>a+b;`n"))))
    } catch { return $false }
}
function ConvertTo-CloudSealedCopyReceipt($Value, [string]$BundleHash, [string]$ManifestHash, [long]$PayloadBytes) {
    if (!(Test-CloudSealedCopyReceipt $Value $BundleHash $ManifestHash $PayloadBytes)) { return $null }
    # Construct a new finite scalar receipt. Never forward the child PSObject.
    return [ordered]@{ schemaVersion = 1; kind = 'fixed-sealed-copy'; passed = $true;
        bundleSha256 = $BundleHash; manifestSha256 = $ManifestHash; fileCount = 4; totalBytes = $PayloadBytes;
        sourceUnchanged = $true; guestReadVerified = $true; guestEdited = $true; initialTestExitCode = 1;
        testExitCode = 0; editedSha256 = [string]$Value.editedSha256; e2Qualified = $false; launchAllowed = $false }
}
function Test-CloudSealedCopyMembership([Collections.IEnumerator]$Enumerator) {
    $names = [Collections.Generic.List[string]]::new()
    try {
        # Four entries plus one terminating/overflow observation. Never materialize the directory.
        for ($index = 0; $index -lt 5; $index++) {
            if (!$Enumerator.MoveNext()) {
                return ($names.Count -eq 4 -and (($names.ToArray() | Sort-Object) -join ',') -ceq 'numbers.json,readme.txt,sum.cjs,sum.test.cjs')
            }
            if ($index -eq 4) { return $false }
            $entry = $Enumerator.Current
            if ($entry -isnot [string]) { return $false }
            $names.Add([IO.Path]::GetFileName($entry))
        }
        return $false
    } catch { return $false }
    finally { if ($Enumerator -is [IDisposable]) { $Enumerator.Dispose() } }
}
function Get-CloudSealedCopyHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Read-CloudSealedCopyResult($Identity) {
    $failed = @{ schemaVersion = 1; kind = 'fixed-sealed-copy-verified'; passed = $false; e2Qualified = $false; launchAllowed = $false }
    $held = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        # Guest-controlled files are consumed only after the existing native owner settles.
        foreach ($field in @('passed', 'taskReleased', 'heldIdentityBeforeRelease', 'exitCodeObserved', 'jobClosureConfirmed')) {
            if (!$Identity.ContainsKey($field) -or $Identity[$field] -isnot [bool] -or !$Identity[$field]) { return $failed }
        }
        foreach ($field in @('elevated', 'administratorEnabled')) {
            if (!$Identity.ContainsKey($field) -or $Identity[$field] -isnot [bool] -or $Identity[$field]) { return $failed }
        }
        if (!$Identity.ContainsKey('exitCode') -or $Identity.exitCode -ne 0) { return $failed }
        function ReadFixed([string]$Path, [int]$Cap) {
            $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
            if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt $Cap) { throw 'sealed-copy-refused' }
            $cursor = $file.Directory
            while ($null -ne $cursor) { if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'sealed-copy-refused' }; $cursor = $cursor.Parent }
            $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read'); $held.Add($stream)
            if ($stream.Length -ne $file.Length) { throw 'sealed-copy-refused' }
            $bytes = New-Object byte[] ([int]$stream.Length); $offset = 0
            while ($offset -lt $bytes.Length) { $read = $stream.Read($bytes, $offset, $bytes.Length - $offset); if ($read -le 0) { throw 'sealed-copy-refused' }; $offset += $read }
            if ($stream.ReadByte() -ne -1) { throw 'sealed-copy-refused' }; return ,$bytes
        }
        $trusted = 'C:\ProgramData\AegisCloudLab\trusted'; $work = 'C:\AegisLab\work'
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $transfer = $encoding.GetString((ReadFixed "$trusted\manifest.json" 65536)) | ConvertFrom-Json
        $expected = @($transfer.files | Where-Object name -CEQ 'sealed-copy.aegis')
        if ($expected.Count -ne 1 -or $expected[0].sha256 -cnotmatch '^[a-f0-9]{64}$') { return $failed }
        $bundle = ReadFixed "$trusted\sealed-copy.aegis" (16 + 65536 + 1048576)
        if ($bundle.Length -lt 16 -or [Text.Encoding]::ASCII.GetString($bundle, 0, 8) -cne 'AEGSIM01' -or
            (Get-CloudSealedCopyHash $bundle) -cne $expected[0].sha256) { return $failed }
        $length = [BitConverter]::ToInt32($bundle, 8); $payload = [BitConverter]::ToInt32($bundle, 12)
        if ($length -lt 2 -or $length -gt 65536 -or $payload -lt 0 -or $payload -gt 1048576 -or $bundle.Length -ne 16 + $length + $payload) { return $failed }
        $manifestBytes = New-Object byte[] $length; [Array]::Copy($bundle, 16, $manifestBytes, 0, $length)
        $receipt = $encoding.GetString((ReadFixed "$work\sealed-copy-result.json" 4096)) | ConvertFrom-Json
        $safeReceipt = ConvertTo-CloudSealedCopyReceipt $receipt $expected[0].sha256 (Get-CloudSealedCopyHash $manifestBytes) $payload
        if ($null -eq $safeReceipt) { return $failed }
        # Independent bootstrap verifies the fixed final corpus; it never executes guest files.
        $corpus = [ordered]@{
            'numbers.json' = "{`"a`":2,`"b`":3}`n"
            'readme.txt' = "AEGIS fixed dummy sealed-copy guest qualification.`n"
            'sum.cjs' = "module.exports=(a,b)=>a+b;`n"
            'sum.test.cjs' = "const t=require('node:test'),a=require('node:assert/strict');t('sealed sum',()=>a.equal(require('./sum.cjs')(2,3),5));`n"
        }
        $directory = Get-Item -LiteralPath "$work\sealed-copy" -Force
        if (!$directory.PSIsContainer -or $directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $failed }
        $enumerator = [IO.Directory]::EnumerateFileSystemEntries($directory.FullName).GetEnumerator()
        if (!(Test-CloudSealedCopyMembership -Enumerator $enumerator)) { return $failed }
        foreach ($name in $corpus.Keys) {
            if ((Get-CloudSealedCopyHash (ReadFixed (Join-Path $directory.FullName $name) 65536)) -cne
                (Get-CloudSealedCopyHash ([Text.Encoding]::UTF8.GetBytes($corpus[$name])))) { return $failed }
        }
        return @{ schemaVersion = 1; kind = 'fixed-sealed-copy-verified'; passed = $true; nativeJobClosureObserved = $true;
            fixedGuestCorpusIndependentlyVerified = $true; receipt = $safeReceipt; e2Qualified = $false; launchAllowed = $false }
    } catch { return $failed }
    finally { foreach ($stream in $held) { $stream.Dispose() } }
}
