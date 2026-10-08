# Historical negative fixture: intentional R1 metadata-only manifest bound.
$manifestFile = Get-Item -LiteralPath "$trusted\manifest.json" -Force
    if ($manifestFile.PSIsContainer -or ($manifestFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $manifestFile.Length -gt 64KB) { throw 'owner-lifetime-refused' }
    $manifestStream = [IO.File]::Open($manifestFile.FullName, 'Open', 'Read', 'Read'); $held.Add($manifestStream)
    $manifestReader = [IO.StreamReader]::new($manifestStream, [Text.UTF8Encoding]::new($false, $true), $false, 1024, $true)
    try { $manifest = $manifestReader.ReadToEnd() | ConvertFrom-Json } finally { $manifestReader.Dispose() }
