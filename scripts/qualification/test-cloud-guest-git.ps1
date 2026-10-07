param([Parameter(Mandatory = $true)][string]$OwnedFixtureRoot,
    [Parameter(Mandatory = $true)][string]$PinnedArchivePath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-git.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($OwnedFixtureRoot).TrimEnd('\')
$directory = Get-Item -LiteralPath $root -Force
if (!$directory.PSIsContainer -or $directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'git-test-root-refused' }
$fixture = Join-Path $root ('git-parser-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$checks = 0
function Check([bool]$Value) { if (!$Value) { throw 'git-control-failed' }; $script:checks++ }
function Refuses($Block) { try { & $Block; throw 'unexpected-acceptance' } catch { Check ($_.Exception.Message -notlike '*unexpected-acceptance*') } }
try {
    foreach ($leaf in @('cloud-guest-git.ps1','cloud-guest-lab.ps1','cloud-guest-vm.ps1','cloud-guest-bootstrap.ps1')) {
        $tokens=$null; $errors=$null
        [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $leaf),[ref]$tokens,[ref]$errors)
        Check ($errors.Count -eq 0)
    }
    $archivePath = $PinnedArchivePath
    Assert-CloudGuestGitArchive $archivePath; $checks++
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try { $entries = @(Read-CloudGuestGitTopology $zip); Check ($entries.Count -eq 373) } finally { $zip.Dispose() }
    $expected = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'git-runtime-manifest.json')) | ConvertFrom-Json
    Test-CloudGuestGitManifest $expected $expected; $checks++
    $changed = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'git-runtime-manifest.json')) | ConvertFrom-Json
    $changed.files[0].sha256 = '0' * 64
    Refuses { Test-CloudGuestGitManifest $expected $changed }
    $valid = @([pscustomobject]@{FullName='cmd/git.exe';Length=1;ExternalAttributes=0},[pscustomobject]@{FullName='ucrt64/bin/git.exe';Length=1;ExternalAttributes=0})
    Check (@(Read-CloudGuestGitTopology ([pscustomobject]@{Entries=$valid})).Count -eq 2)
    foreach ($name in @('../escape','/absolute','x\escape','a//b','a/../b','AUX.txt','a./b','a/b ')) {
        $bad = [pscustomobject]@{FullName=$name;Length=1;ExternalAttributes=0}
        Refuses { Read-CloudGuestGitTopology ([pscustomobject]@{Entries=@($valid)+@($bad)}) | Out-Null }
    }
    foreach ($extra in @(
        @([pscustomobject]@{FullName='CMD/git.exe';Length=1;ExternalAttributes=0}),
        @([pscustomobject]@{FullName='a';Length=1;ExternalAttributes=0},[pscustomobject]@{FullName='a/b';Length=1;ExternalAttributes=0}),
        @([pscustomobject]@{FullName='link';Length=1;ExternalAttributes=0x400}),
        @([pscustomobject]@{FullName='large';Length=16777217;ExternalAttributes=0})
    )) { Refuses { Read-CloudGuestGitTopology ([pscustomobject]@{Entries=@($valid)+@($extra)}) | Out-Null } }
    $badArchive=Join-Path $fixture 'bad.zip'; [IO.File]::WriteAllText($badArchive,'fixture')
    Refuses { Assert-CloudGuestGitArchive $badArchive }
    $resultPath=Join-Path $fixture 'result.json'
    $good=@{schemaVersion=1;scope='fixed-disposable-git';passed=$true;version='2.56.0.windows.2';initialClean=$true;statusModified=$true;diffObserved=$true;localCommitObserved=$true;finalClean=$true;remotesAbsent=$true;commands=13;elapsedMilliseconds=1000;stage='completed';exitCode=0;e2Qualified=$false;e6Qualified=$false;launchAllowed=$false}
    [IO.File]::WriteAllText($resultPath,($good|ConvertTo-Json -Compress)); Check (Read-CloudGuestGitControls $resultPath).passed
    foreach ($field in @('passed','initialClean','statusModified','diffObserved','localCommitObserved','finalClean','remotesAbsent')) {
        $bad=$good.Clone(); $bad[$field]=$false
        [IO.File]::WriteAllText($resultPath,($bad|ConvertTo-Json -Compress)); Check (!(Read-CloudGuestGitControls $resultPath).passed)
    }
    foreach ($pair in @(@('elapsedMilliseconds',3000),@('elapsedMilliseconds',-1),@('elapsedMilliseconds','1'),@('commands',12),@('exitCode',7),@('launchAllowed',$true),@('e2Qualified',$true),@('version','other'),@('localCommitObserved','true'))) {
        $bad=$good.Clone(); $bad[$pair[0]]=$pair[1]
        [IO.File]::WriteAllText($resultPath,($bad|ConvertTo-Json -Compress)); Check (!(Read-CloudGuestGitControls $resultPath).passed)
    }
    [IO.File]::WriteAllText($resultPath,'PRIVATE_SENTINEL'); Check (!(Read-CloudGuestGitControls $resultPath).passed)
    [IO.File]::WriteAllText($resultPath,('x'*4097)); Check (!(Read-CloudGuestGitControls $resultPath).passed)
    Check (!(Read-CloudGuestGitControls (Join-Path $fixture 'missing.json')).passed)
    @{passed=$true;checks=$checks;scope='actual-pinned-archive-and-pure-parser-controls';accountAclVmGuestEffects=$false;launchAllowed=$false}|ConvertTo-Json -Compress
} finally {
    foreach($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 8KB) { throw 'git-test-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}
