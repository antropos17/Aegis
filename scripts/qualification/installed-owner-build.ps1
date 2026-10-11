Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Build-InstalledOwnerPayload([string]$Project, [string]$PayloadRoot, [string]$NativeOutput, [string]$ExpectedSourceSha) {
    $Project = [IO.Path]::GetFullPath($Project).TrimEnd('\')
    if (Test-Path -LiteralPath $PayloadRoot) { throw 'installed-payload-fresh-root-required' }
    New-Item -ItemType Directory -Path $PayloadRoot | Out-Null
    foreach ($leaf in @('binaries', 'baseline', 'native', 'scripts/installation', 'scripts/qualification')) { New-Item -ItemType Directory -Path (Join-Path $PayloadRoot $leaf) -Force | Out-Null }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $sources = @((Get-ChildItem -LiteralPath (Join-Path $Project 'sidecar/session') -Filter *.cs -File | Sort-Object Name) +
        (Get-ChildItem -LiteralPath (Join-Path $Project 'sidecar/owner') -Filter *.cs -File | Sort-Object Name) +
        (Get-Item -LiteralPath (Join-Path $Project 'sidecar/mcpjob/AppContainerExecutable.cs')))
    if ($sources.Count -lt 10 -or $sources.Count -gt 100) { throw 'installed-native-source-count-refused' }
    $sourceHashes = [ordered]@{}
    foreach ($file in $sources) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 64KB) { throw 'installed-native-source-refused' }
        $sourceHashes[$file.FullName.Substring($Project.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $baseline = Join-Path $Project 'tests/fixtures/protected-installation/BaselineProgram.cs'
    $actor = Join-Path $Project 'tests/fixtures/protected-installation/InstalledOwnerMutationActor.cs'
    foreach ($file in @($baseline, $actor)) { $sourceHashes[$file.Substring($Project.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
    # This exact preserved maintained Program contains no installed-owner path.
    # It is an executable behavioral baseline, without native/model test defines.
    $baselineExpected = 'bb319c230c9c06fd2053200fd875c22ee555260e008251dfa1f267d33a9669b2'
    $canonical = [Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($baseline).Replace("`r`n", "`n"))
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $baselineActual = [BitConverter]::ToString($hash.ComputeHash($canonical)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    if ($baselineActual -cne $baselineExpected) { throw 'installed-original-program-source-refused' }
    $builds = @(
        @{ leaf = 'binaries/aegis-session.exe'; main = 'Aegis.ProtectedSession.Program'; sources = @($sources.FullName) },
        @{ leaf = 'binaries/aegis-owner.exe'; main = 'Aegis.InstalledOwner.OwnerProgram'; sources = @($sources.FullName) },
        @{ leaf = 'binaries/aegis-main.exe'; main = 'Aegis.InstalledOwner.InstalledOwnerMain'; sources = @($sources.FullName) },
        @{ leaf = 'baseline/aegis-session.exe'; main = 'Aegis.ProtectedSession.Program'; sources = @($sources | Where-Object { $_.FullName -cne [IO.Path]::GetFullPath((Join-Path $Project 'sidecar/session/Program.cs')) } | ForEach-Object FullName) + @($baseline) },
        @{ leaf = 'native/installed-owner-actor.exe'; main = 'InstalledOwnerMutationActor'; sources = @($actor) }
    )
    $commands = @()
    foreach ($build in $builds) {
        $output = Join-Path $PayloadRoot $build.leaf
        $args = @('/nologo', '/target:exe', '/platform:x64', '/optimize+', '/warnaserror+', '/reference:System.Management.dll', '/reference:System.Security.dll', ('/main:' + $build.main), ('/out:"' + $output + '"'))
        foreach ($source in $build.sources) { $args += '"' + $source + '"' }
        $label = $build.leaf.Replace('/', '-'); $stdout = Join-Path $NativeOutput ($label + '.out'); $stderr = $stdout + '.error'
        $code = Invoke-CloudGuestNativeProcess $compiler $args $stdout $stderr 30000
        if ($code -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 4MB -or (Get-Item -LiteralPath $stdout).Length -gt 64KB -or (Get-Item -LiteralPath $stderr).Length -gt 64KB) { throw 'installed-native-build-refused' }
        $commands += @{ command = @($compiler) + $args; exitCode = $code; output = $build.leaf; sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $paths = @('binaries/aegis-owner.exe', 'binaries/aegis-session.exe', 'binaries/aegis-main.exe', 'baseline/aegis-session.exe', 'native/installed-owner-actor.exe')
    foreach ($name in @('ProtectedInstallFiles.cs', 'ProtectedInstallService.cs', 'protected-install-files.ps1', 'protected-install-transaction.ps1', 'protected-installation.ps1')) {
        $path = 'scripts/installation/' + $name; Copy-Item -LiteralPath (Join-Path $Project $path) -Destination (Join-Path $PayloadRoot $path); $paths += $path
    }
    $phase = 'scripts/qualification/installed-owner-phase.ps1'; Copy-Item -LiteralPath (Join-Path $Project $phase) -Destination (Join-Path $PayloadRoot $phase); $paths += $phase
    $bootstrap = 'scripts/qualification/installed-owner-guest-bootstrap.ps1'; Copy-Item -LiteralPath (Join-Path $Project $bootstrap) -Destination (Join-Path $PayloadRoot $bootstrap); $paths += $bootstrap
    $rows = @($paths | ForEach-Object { $file = Get-Item -LiteralPath (Join-Path $PayloadRoot $_); @{ path = $_; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
    $manifest = @{ schemaVersion = 1; sourceSha = $ExpectedSourceSha; files = $rows }
    [IO.File]::WriteAllText((Join-Path $PayloadRoot 'payload-manifest.json'), ($manifest | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
    return @{ compilerSha256 = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant(); sourceHashes = $sourceHashes; commands = $commands; payload = $manifest }
}
