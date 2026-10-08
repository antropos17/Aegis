Set-StrictMode -Version Latest

function Assert-CloudGuestGitArchive([string]$Path) {
    $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -ne 39806486 -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be') { throw 'fixed-git-archive-refused' }
}

# Fixed public source, bounded stream; no GitHub token, proxy credential or installer.
function Save-CloudGuestGitArchive([string]$Path) {
    Add-Type -AssemblyName System.Net.Http
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(60))
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.UseProxy = $false; $handler.MaxAutomaticRedirections = 3
    $client = [Net.Http.HttpClient]::new($handler); $response = $null; $source = $null; $output = $null
    try {
        $url = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip'
        $response = $client.GetAsync($url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult()
        $final = $response.RequestMessage.RequestUri
        if ($response.StatusCode -ne [Net.HttpStatusCode]::OK -or $response.Content.Headers.ContentLength -ne 39806486 -or
            $final.Scheme -cne 'https' -or $final.Host -cnotin @('github.com', 'release-assets.githubusercontent.com') -or $final.UserInfo) { throw 'fixed-git-http-refused' }
        $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536; [long]$written = 0
        while ($true) {
            $count = $source.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token).GetAwaiter().GetResult()
            if ($count -eq 0) { break }
            if ($written + $count -gt 39806486) { throw 'fixed-git-download-budget' }
            $output.Write($buffer, 0, $count); $written += $count
        }
        if ($written -ne 39806486) { throw 'fixed-git-download-incomplete' }
        $output.Flush(); $output.Dispose(); $output = $null
        Assert-CloudGuestGitArchive $Path
    } finally {
        if ($null -ne $output) { $output.Dispose() }; if ($null -ne $source) { $source.Dispose() }
        if ($null -ne $response) { $response.Dispose() }; $client.Dispose(); $handler.Dispose(); $cancel.Dispose()
    }
}

# Validate the entire archive before creating an extracted path. This helper is
# also exercised with disposable adversarial ZIPs; production requires the pin first.
function Read-CloudGuestGitTopology($Archive) {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $files = [Collections.Generic.List[object]]::new(); [long]$total = 0
    if ($Archive.Entries.Count -lt 1 -or $Archive.Entries.Count -gt 512) { throw 'fixed-git-entry-budget' }
    foreach ($entry in $Archive.Entries) {
        $name = $entry.FullName; $directory = $name.EndsWith('/'); $normalized = $name.TrimEnd('/')
        if (!$normalized -or $name.Length -gt 180 -or $name -cmatch '[^A-Za-z0-9_./+@ -]' -or $name.Contains('\') -or $name.StartsWith('/') -or
            $name -cmatch '[. ](/|$)' -or $name.Contains('//') -or $normalized.Split('/').Count -gt 8 -or
            @($normalized.Split('/') | Where-Object { $_ -cin @('.', '..') -or $_ -cmatch '^(?i:con|prn|aux|nul|com[0-9]|lpt[0-9])([.]|$)' }).Count -or
            !$names.Add($normalized) -or ($entry.ExternalAttributes -band 0x400) -or
            (([long]$entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'fixed-git-path-refused' }
        if ($directory) { if ($entry.Length -ne 0) { throw 'fixed-git-directory-content' }; continue }
        if ($entry.Length -lt 0 -or $entry.Length -gt 16MB -or ($total += $entry.Length) -gt 128MB) { throw 'fixed-git-expanded-budget' }
        $files.Add($entry)
    }
    foreach ($file in $files) {
        $prefix = $file.FullName + '/'
        foreach ($name in $names) { if ($name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'fixed-git-file-ancestor' } }
    }
    if (!@($files | Where-Object FullName -ceq 'cmd/git.exe').Count -or !@($files | Where-Object FullName -ceq 'ucrt64/bin/git.exe').Count) { throw 'fixed-git-executable-missing' }
    return @($files)
}

function Expand-CloudGuestGitArchive([string]$Path, [string]$Destination) {
    Assert-CloudGuestGitArchive $Path
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $Destination) { throw 'fixed-git-fresh-directory-required' }
    $parent = Get-Item -LiteralPath (Split-Path -Parent $Destination) -Force
    if (!$parent.PSIsContainer -or $parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'fixed-git-parent-refused' }
    for ($ancestor = $parent; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'fixed-git-parent-refused' }
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    $manifest = [Collections.Generic.List[object]]::new()
    try {
        $files = @(Read-CloudGuestGitTopology $archive)
        New-Item -ItemType Directory -Path $Destination -ErrorAction Stop | Out-Null
        foreach ($entry in $files) {
            $target = Join-Path $Destination $entry.FullName
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            $input = $entry.Open(); $output = $null
            try {
                $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $buffer = New-Object byte[] 65536; [long]$copied = 0
                while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    if (($copied += $count) -gt $entry.Length) { throw 'fixed-git-entry-length-refused' }
                    $output.Write($buffer, 0, $count)
                }
                if ($copied -ne $entry.Length) { throw 'fixed-git-entry-incomplete' }
            } finally { if ($null -ne $output) { $output.Dispose() }; $input.Dispose() }
            $manifest.Add(@{ name = $entry.FullName; bytes = [long]$entry.Length; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() })
        }
    } finally { $archive.Dispose() }
    return @{ schemaVersion = 1; version = '2.56.0.windows.2'; archiveSha256 = 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be'; files = @($manifest) }
}

function Test-CloudGuestGitManifest($Expected, $Actual) {
    if ($Expected.schemaVersion -ne 1 -or $Actual.schemaVersion -ne 1 -or $Expected.version -cne '2.56.0.windows.2' -or $Actual.version -cne $Expected.version -or
        $Expected.archiveSha256 -cne 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be' -or $Actual.archiveSha256 -cne $Expected.archiveSha256 -or
        $Expected.files.Count -ne 373 -or $Actual.files.Count -ne 373) { throw 'fixed-git-manifest-refused' }
    for ($index = 0; $index -lt 373; $index++) {
        $a = $Expected.files[$index]; $b = $Actual.files[$index]
        if ($a.name -cne $b.name -or $a.bytes -ne $b.bytes -or $a.sha256 -cne $b.sha256) { throw 'fixed-git-manifest-refused' }
    }
}

# Independent administrator parser; a child-written 'passed' alone never wins.
function Read-CloudGuestGitControls([string]$Path) {
    $refused = @{ passed = $false; scope = 'fixed-disposable-git'; launchAllowed = $false; e2Qualified = $false; e6Qualified = $false }
    try {
        $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -lt 2 -or $file.Length -gt 4096) { throw 'refused' }
        $value = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
        $fields = 'commands,diffObserved,e2Qualified,e6Qualified,elapsedMilliseconds,exitCode,finalClean,initialClean,launchAllowed,localCommitObserved,passed,remotesAbsent,schemaVersion,scope,stage,statusModified,version'
        if ((@($value.PSObject.Properties.Name | Sort-Object) -join ',') -cne $fields -or
            $value.schemaVersion -ne 1 -or $value.scope -cne 'fixed-disposable-git' -or $value.version -cne '2.56.0.windows.2' -or $value.stage -cne 'completed') { throw 'refused' }
        foreach ($field in @('passed','initialClean','statusModified','diffObserved','localCommitObserved','finalClean','remotesAbsent')) {
            if ($value.$field -isnot [bool] -or !$value.$field) { throw 'refused' }
        }
        foreach ($field in @('launchAllowed','e2Qualified','e6Qualified')) {
            if ($value.$field -isnot [bool] -or $value.$field) { throw 'refused' }
        }
        foreach ($field in @('schemaVersion','commands','elapsedMilliseconds','exitCode')) {
            if ($value.$field -isnot [int] -and $value.$field -isnot [long]) { throw 'refused' }
        }
        if ($value.commands -ne 13 -or $value.elapsedMilliseconds -lt 1 -or $value.elapsedMilliseconds -ge 3000 -or $value.exitCode -ne 0) { throw 'refused' }
        return $value
    } catch { return $refused }
}
