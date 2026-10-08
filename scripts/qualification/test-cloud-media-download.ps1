param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')), [switch]$MutationControls)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'media-fixture-windows-powershell-required' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
$cursor = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -Force
while ($null -ne $cursor) { if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'media-fixture-root-refused' }; $cursor = $cursor.Parent }
$owned = Join-Path $env:TEMP ('aegis-media-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$original = Join-Path $ProjectRoot 'scripts/qualification/CloudGuestMetadata.cs'
$fixture = Join-Path $ProjectRoot 'tests/fixtures/native-cloud-media-download/MediaDownloadFixture.cs'
$lab = Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-lab.ps1'
foreach ($path in @($original, $fixture, $lab)) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or $item.Length -gt 64KB -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'media-fixture-source-refused' }
}
function Compile-Media([string]$Name, [string]$Source, [bool]$Executable) {
    $output = Join-Path $owned ($Name + $(if ($Executable) { '.exe' } else { '.dll' }))
    $arguments = @('/nologo', '/platform:x64', '/optimize+', '/warnaserror+', '/reference:System.Net.Http.dll', ('/out:"' + $output + '"'))
    if ($Executable) { $arguments += @('/target:exe', ('"' + $fixture + '"')) } else { $arguments += '/target:library' }
    $arguments += '"' + $Source + '"'
    $code = Invoke-CloudGuestNativeProcess $compiler $arguments (Join-Path $owned ($Name + '-compile.txt')) (Join-Path $owned ($Name + '-compile.error')) 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 1MB) { throw 'media-fixture-compile-refused' }
    return $output
}
$production = Compile-Media 'production' $original $false
$admission = Join-Path $owned 'admission.ps1'
[IO.File]::WriteAllText($admission, @'
param([string]$Dll, [string]$Root)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path $Dll
$file = Join-Path $Root 'production-admission.public'
$observed = [CloudGuestMetadata+DownloadObservation]::new(); $refused = $false
try { [CloudGuestMetadata]::Download('http://127.0.0.1:1/', $file, 131072, $observed) | Out-Null } catch { $refused = $true }
if (!$refused -or $observed.Phase.ToString() -cne 'NotStarted' -or $observed.ReadCalls -ne 0 -or (Test-Path -LiteralPath $file)) { throw 'media-production-admission-refused' }
$refused = $false
try { [CloudGuestMetadata]::Download('https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso', $file, 0) | Out-Null } catch { $refused = $true }
if (!$refused -or (Test-Path -LiteralPath $file)) { throw 'media-production-admission-refused' }
Write-Output 'media-fixture-production-admission:refused'
'@)
$admissionOut = Join-Path $owned 'admission.txt'; $admissionError = Join-Path $owned 'admission.error'
$powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$code = Invoke-CloudGuestNativeProcess $powershell @('-NoProfile', '-File', ('"' + $admission + '"'), ('"' + $production + '"'), ('"' + $owned + '"')) $admissionOut $admissionError 10000
if ($code -ne 0 -or (Get-Item -LiteralPath $admissionError).Length -ne 0 -or [IO.File]::ReadAllText($admissionOut).Trim() -cne 'media-fixture-production-admission:refused') { throw 'media-fixture-admission-controls-refused' }
Write-Output 'media-fixture-production-admission:refused'
$text = [IO.File]::ReadAllText($original)
$pin = 'expectedBytes == 8225329152L && url == "https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso"'
$deadline = 'TimeSpan.FromMinutes(20)'
if (($text.Split(@($pin), [StringSplitOptions]::None)).Count -ne 2 -or ($text.Split(@($deadline), [StringSplitOptions]::None)).Count -ne 2) { throw 'media-fixture-fixed-input-refused' }
# These two substitutions affect only generated disposable compilation inputs.
# No fixture source, alternate URL or shorter deadline enters the lab assembly.
$generated = $text.Replace($pin, 'expectedBytes == 131072L && url.StartsWith("http://127.0.0.1:", StringComparison.Ordinal)').Replace($deadline, 'TimeSpan.FromMilliseconds(750)')
$source = Join-Path $owned 'loopback.cs'; [IO.File]::WriteAllText($source, $generated)
$exe = Compile-Media 'loopback' $source $true
$stdout = Join-Path $owned 'loopback.txt'; $stderr = Join-Path $owned 'loopback.error'
$code = Invoke-CloudGuestNativeProcess $exe @(('"' + $owned + '"')) $stdout $stderr 15000
$lines = [IO.File]::ReadAllLines($stdout)
if ($code -ne 0 -or (Get-Item -LiteralPath $stderr).Length -ne 0 -or $lines.Count -ne 5) { throw 'media-fixture-controls-refused' }
foreach ($line in $lines) {
    if ($line -cnotmatch '\Amedia-fixture:(success|wrong-length|short-eof|request-cancel|body-cancel);phase=(Complete|Response|Read|Finalize|Request);read=(0|65536|131072);written=(0|65536|131072);deadline=(True|False)\z') { throw 'media-fixture-output-refused' }
    Write-Output $line
}
if ($MutationControls) {
    $changed = $generated.Replace('observation.BytesWritten = written;', 'observation.BytesWritten = 0;')
    if ($changed -ceq $generated) { throw 'media-fixture-mutation-missing' }
    $mutantSource = Join-Path $owned 'mutant.cs'; [IO.File]::WriteAllText($mutantSource, $changed)
    $mutant = Compile-Media 'mutant' $mutantSource $true
    $mutantRoot = Join-Path $owned 'mutant'; New-Item -ItemType Directory -Path $mutantRoot | Out-Null
    $code = Invoke-CloudGuestNativeProcess $mutant @(('"' + $mutantRoot + '"')) (Join-Path $owned 'mutant.txt') (Join-Path $owned 'mutant.error') 15000
    if ($code -eq 0 -or [IO.File]::ReadAllText((Join-Path $owned 'mutant.error')).Trim() -cne 'media-fixture-refused') { throw 'media-fixture-mutant-survived' }
    Write-Output 'media-fixture-counter-mutant:refused'
}
# Execute the actual lab try/finally block against the loopback assembly. Only
# its URL/expected-byte literals are substituted, as in the downloader copy.
[Reflection.Assembly]::LoadFrom($exe) | Out-Null
$labText = [IO.File]::ReadAllText($lab)
$begin = $labText.IndexOf('    $mediaObservation = [CloudGuestMetadata+DownloadObservation]::new()', [StringComparison]::Ordinal)
$end = $labText.IndexOf("    `$metadata = Stage 'read-only-exact-wim-metadata'", [StringComparison]::Ordinal)
if ($begin -lt 0 -or $end -le $begin) { throw 'media-lab-fixture-boundary-refused' }
$fixtureUrl = [MediaDownloadFixture]::PrepareCallerCancellation()
$fixedUrl = 'https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
$block = $labText.Substring($begin, $end - $begin).Replace($fixedUrl, $fixtureUrl).Replace('8225329152', '131072')
$report = [ordered]@{ media = $null }; $windowsIso = Join-Path $owned 'caller.public'; $failed = $false
function Stage([string]$Name, [scriptblock]$Operation) { & $Operation }
try { & ([scriptblock]::Create($block)) } catch { $failed = $true }
finally { [MediaDownloadFixture]::CompleteCallerCancellation() }
if (!$failed -or $null -ne $report.media -or !$report.Contains('mediaDownload') -or $report.mediaDownload.Count -ne 12 -or
    $report.mediaDownload.phase -cne 'Read' -or !$report.mediaDownload.deadlineExpired -or $report.mediaDownload.expectedBytes -ne 131072 -or
    $report.mediaDownload.declaredBytes -ne 131072 -or $report.mediaDownload.responseStatusCode -ne 200 -or
    $report.mediaDownload.bytesRead -ne 65536 -or $report.mediaDownload.bytesWritten -ne 65536) { throw 'media-lab-failure-receipt-refused' }
$held = [IO.FileStream]::new($windowsIso, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
try { if ($held.Length -ne 65536) { throw 'media-lab-fixture-length-refused' } } finally { $held.Dispose() }
if (Test-Path -LiteralPath $windowsIso) { throw 'media-lab-fixture-cleanup-refused' }
Write-Output 'media-fixture-lab-failure-receipt:closed-progress-retained'
$tokens = $null; $errors = $null
[Management.Automation.Language.Parser]::ParseFile($lab, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw 'media-lab-parse-refused' }
Write-Output ('media-fixture-production:bytes=' + (Get-Item -LiteralPath $production).Length + ';sourceSha256=' + (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant())
