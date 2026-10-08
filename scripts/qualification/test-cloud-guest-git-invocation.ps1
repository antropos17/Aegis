Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud-guest-media.ps1')
$parent = Get-Item -LiteralPath ([IO.Path]::GetFullPath($env:TEMP)) -Force
while ($null -ne $parent) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'git-invocation-temp-refused' }; $parent = $parent.Parent }
$fixture = Join-Path $env:TEMP ('aegis-git-invocation-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cloud-guest-bootstrap.ps1'))
    $begin = '$gitSourceFile ='; $end = '. ([scriptblock]::Create($gitSourceEncoding.GetString($sealedBytes)))'
    $from = $source.IndexOf($begin, [StringComparison]::Ordinal); $to = $source.IndexOf($end, [StringComparison]::Ordinal)
    if ($from -lt 0 -or $to -le $from -or $source.IndexOf($begin, $from + $begin.Length, [StringComparison]::Ordinal) -ge 0) { throw 'fixed-git-intake-missing' }
    [IO.File]::WriteAllText((Join-Path $fixture 'intake.txt'), $source.Substring($from, $to + $end.Length - $from), [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cloud-guest-git.ps1') -Destination (Join-Path $fixture 'original.txt')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cloud-sealed-copy-verify.ps1') -Destination (Join-Path $fixture 'sealed-original.txt')
    $fixtureEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fixture))
    $worker = @'
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$trusted=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('FIXTURE_BASE64'))
$before=Get-ExecutionPolicy
if ($before -ne 'Restricted') { throw 'restricted-worker-required' }
$intake=[IO.File]::ReadAllText((Join-Path $trusted 'intake.txt'))
$original=[IO.File]::ReadAllBytes((Join-Path $trusted 'original.txt'))
$sealedOriginal=[IO.File]::ReadAllBytes((Join-Path $trusted 'sealed-original.txt'))
$sealedPath=Join-Path $trusted 'cloud-sealed-copy-verify.ps1'
$path=Join-Path $trusted 'cloud-guest-git.ps1'; $manifestPath=Join-Path $trusted 'manifest.json'
$cases=0
function Require([bool]$value) { if (!$value) { throw 'git-invocation-control-refused' }; $script:cases++ }
function Reset {
    [IO.File]::WriteAllBytes($path,$original)
    [IO.File]::WriteAllBytes($sealedPath,$sealedOriginal)
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $sealedHash=(Get-FileHash -LiteralPath $sealedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($manifestPath,(@{files=@(@{name='cloud-guest-git.ps1';sha256=$hash},@{name='cloud-sealed-copy-verify.ps1';sha256=$sealedHash})}|ConvertTo-Json -Depth 4 -Compress))
}
function Refuses {
    $refused=$false
    try { . ([scriptblock]::Create($intake)) } catch { $refused=$true }
    Require $refused
}
Reset
$baseline=$null
try { . $path } catch { $baseline=$_.Exception.GetType().Name }
Require ($baseline -ceq 'PSSecurityException')
. ([scriptblock]::Create($intake))
Require ($null -ne (Get-Command Read-CloudGuestGitControls -ErrorAction SilentlyContinue))
Require ($null -ne (Get-Command Expand-CloudGuestGitArchive -ErrorAction SilentlyContinue))
Require ($null -ne (Get-Command Read-CloudSealedCopyResult -ErrorAction SilentlyContinue))
Reset; $value=[IO.File]::ReadAllText($manifestPath)|ConvertFrom-Json; $value.files[1].sha256='0'*64
[IO.File]::WriteAllText($manifestPath,($value|ConvertTo-Json -Depth 4 -Compress)); Refuses
Reset; Remove-Item -LiteralPath $sealedPath; Refuses
Reset; $value=[IO.File]::ReadAllText($manifestPath)|ConvertFrom-Json; $value.files[0].sha256='0'*64
[IO.File]::WriteAllText($manifestPath,($value|ConvertTo-Json -Compress)); Refuses
Reset; $value=[IO.File]::ReadAllText($manifestPath)|ConvertFrom-Json; $value.files=@($value.files[0],$value.files[0])
[IO.File]::WriteAllText($manifestPath,($value|ConvertTo-Json -Depth 4 -Compress)); Refuses
Reset; [IO.File]::WriteAllText($manifestPath,'{"files":[]}'); Refuses
Reset; Remove-Item -LiteralPath $path; Refuses
Reset; [IO.File]::WriteAllText($path,('x'*65537)); Refuses
Reset; [IO.File]::WriteAllText($manifestPath,('x'*65537)); Refuses
Reset; [IO.File]::WriteAllBytes($path,[byte[]]@(255,255)); $value=[IO.File]::ReadAllText($manifestPath)|ConvertFrom-Json
$value.files[0].sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($manifestPath,($value|ConvertTo-Json -Compress)); Refuses
Reset; [IO.File]::WriteAllBytes($manifestPath,[byte[]]@(255,255)); Refuses
Require ((Get-ExecutionPolicy) -ceq $before)
if ($cases -ne 15) { throw 'git-invocation-case-count-refused' }
@{passed=$true;cases=$cases;policyBefore=$before.ToString();policyAfter=(Get-ExecutionPolicy).ToString();baselineFileException=$baseline;scope='fixed-retained-byte-hash-bound-helper';guestAccountAclVmEffects=$false;launchAllowed=$false}|ConvertTo-Json -Compress
'@
    $worker = $worker.Replace('FIXTURE_BASE64', $fixtureEncoded)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
    $output=Join-Path $fixture 'worker.json'; $errorFile=Join-Path $fixture 'worker.error'
    # This restriction applies only to the disposable test child. No host/guest
    # policy is changed; the production intake has no policy-setting operation.
    $arguments=@('-NoProfile','-ExecutionPolicy','Restricted','-EncodedCommand',$encoded)
    $exit=Invoke-CloudGuestNativeProcess (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe') $arguments $output $errorFile 10000
    if ($exit -ne 0 -or (Get-Item -LiteralPath $output).Length -gt 2048 -or (Get-Item -LiteralPath $errorFile).Length -ne 0) { throw 'restricted-git-invocation-refused' }
    $result=[IO.File]::ReadAllText($output)|ConvertFrom-Json
    if (!$result.passed -or $result.cases -ne 15 -or $result.policyBefore -cne 'Restricted' -or $result.policyAfter -cne 'Restricted') { throw 'restricted-git-receipt-refused' }
    $result|ConvertTo-Json -Compress
} finally {
    foreach($file in @(Get-ChildItem -LiteralPath $fixture -File -Force)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -gt 128KB) { throw 'git-invocation-cleanup-refused' }
        Remove-Item -LiteralPath $file.FullName
    }
    Remove-Item -LiteralPath $fixture
}
