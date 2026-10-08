param([Parameter(Mandatory = $true)][string]$NativeEvidence)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'cloud-sealed-copy-verify.ps1')
$expectedEvidence = Join-Path $env:TEMP 'native'
if ([IO.Path]::GetFullPath($NativeEvidence) -cne [IO.Path]::GetFullPath($expectedEvidence) -or
    (Split-Path -Leaf $env:TEMP) -cnotmatch '^aegis-sealed-copy-controls-[a-f0-9]{32}$') { throw 'sealed-copy-owned-evidence-required' }
$original = (Get-Content -LiteralPath (Join-Path $NativeEvidence 'local-consumption.json') -Raw | ConvertFrom-Json).receipt
$count = 0
$membershipMetrics = @()
function Expect([bool]$Condition) { if (!$Condition) { throw ('sealed-copy-verifier-control-failed-line-' + (Get-PSCallStack)[1].ScriptLineNumber + '-after-' + $script:count) }; $script:count++ }
Expect (Test-CloudSealedCopyReceipt $original $original.bundleSha256 $original.manifestSha256 $original.totalBytes)
foreach ($field in @('kind', 'bundleSha256', 'manifestSha256', 'editedSha256')) {
    $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json
    $value.$field = @($original.$field, 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED')
    Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
    foreach ($bad in @(@($original.$field), [pscustomobject]@{ value = $original.$field }, 1, $true, $null)) {
        $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value.$field = $bad
        Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
        Expect ($null -eq (ConvertTo-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
    }
}
foreach ($field in $original.PSObject.Properties.Name) {
    $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json
    $value.$field = @($original.$field, 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED')
    Expect ($null -eq (ConvertTo-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
    $value.$field = [pscustomobject]@{ value = $original.$field; text = 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED' }
    Expect ($null -eq (ConvertTo-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
}
$safe = ConvertTo-CloudSealedCopyReceipt $original $original.bundleSha256 $original.manifestSha256 $original.totalBytes
Expect ($null -ne $safe -and $safe -is [Collections.IDictionary])
foreach ($field in $safe.Keys) { Expect ($safe[$field] -is [string] -or $safe[$field] -is [bool] -or $safe[$field] -is [int] -or $safe[$field] -is [long]) }
$sourceCopy = $original | ConvertTo-Json -Compress | ConvertFrom-Json
$detached = ConvertTo-CloudSealedCopyReceipt $sourceCopy $original.bundleSha256 $original.manifestSha256 $original.totalBytes
$sourceCopy.kind = @('fixed-sealed-copy', 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED')
$sourceCopy | Add-Member extra 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED'
Expect (($detached | ConvertTo-Json -Compress) -cnotmatch 'UNTRUSTED_TEXT_MUST_NOT_BE_RETURNED')
Expect ($null -eq (ConvertTo-CloudSealedCopyReceipt $sourceCopy $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
foreach ($field in @('passed', 'guestReadVerified', 'guestEdited', 'sourceUnchanged')) {
    $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value.$field = 'true'
    Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
    $value.$field = $false
    Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
}
foreach ($field in @('e2Qualified', 'launchAllowed')) {
    $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value.$field = $true
    Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
}
foreach ($field in @('bundleSha256', 'manifestSha256', 'editedSha256')) {
    $value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value.$field = '0' * 64
    Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
}
$value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value.initialTestExitCode = 0
Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
$value = $original | ConvertTo-Json -Compress | ConvertFrom-Json; $value | Add-Member extra $true
Expect (!(Test-CloudSealedCopyReceipt $value $original.bundleSha256 $original.manifestSha256 $original.totalBytes))
$refusal = Read-CloudSealedCopyResult @{}
Expect ($refusal.passed -is [bool] -and !$refusal.passed)
$tokens = $null; $errors = $null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'cloud-sealed-copy-verify.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
Expect ($errors.Count -eq 0)
Add-Type -TypeDefinition @'
using System;
using System.Collections;
public sealed class SealedCopyCountingEnumerator : IEnumerator, IDisposable {
    private readonly IEnumerator inner;
    private readonly long total;
    private long index = -1;
    private readonly string[] names = { "numbers.json", "readme.txt", "sum.cjs", "sum.test.cjs" };
    public int Moves, Reads;
    public int ThrowOnMove;
    public bool Disposed;
    public SealedCopyCountingEnumerator(long count) { total = count; }
    public SealedCopyCountingEnumerator(IEnumerator actual) { inner = actual; }
    public bool MoveNext() { Moves++; if (ThrowOnMove == Moves) throw new InvalidOperationException("fixed-test-error");
        if (inner != null) return inner.MoveNext(); index++; return index < total; }
    public object Current { get { Reads++; return inner == null ? names[index % 4] : inner.Current; } }
    public void Reset() { throw new NotSupportedException(); }
    public void Dispose() { Disposed = true; var disposable = inner as IDisposable; if (disposable != null) disposable.Dispose(); }
}
'@
foreach ($amount in @(0, 3, 4, 5, 1000000)) {
    $enumerator = [SealedCopyCountingEnumerator]::new([long]$amount)
    $observed = Test-CloudSealedCopyMembership -Enumerator $enumerator
    Expect ($observed -eq ($amount -eq 4))
    Expect ($enumerator.Moves -le 5 -and $enumerator.Reads -le 4 -and $enumerator.Disposed)
    if ($amount -ge 4) { Expect ($enumerator.Moves -eq 5 -and $enumerator.Reads -eq 4) }
    $membershipMetrics += @{ corpus = 'synthetic-count'; declaredEntries = $amount; moves = $enumerator.Moves; reads = $enumerator.Reads; disposed = $enumerator.Disposed; accepted = $observed }
}
foreach ($names in @(@('numbers.json', 'readme.txt', 'sum.cjs', 'wrong.txt'), @('numbers.json', 'readme.txt', 'sum.cjs', 'sum.cjs'))) {
    $enumerator = [SealedCopyCountingEnumerator]::new($names.GetEnumerator())
    Expect (!(Test-CloudSealedCopyMembership -Enumerator $enumerator))
    Expect ($enumerator.Moves -eq 5 -and $enumerator.Reads -eq 4 -and $enumerator.Disposed)
}
$enumerator = [SealedCopyCountingEnumerator]::new([long]4); $enumerator.ThrowOnMove = 3
Expect (!(Test-CloudSealedCopyMembership -Enumerator $enumerator))
Expect ($enumerator.Moves -eq 3 -and $enumerator.Disposed)
$directory = Join-Path $NativeEvidence ('filesystem-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
foreach ($leaf in @('numbers.json', 'readme.txt', 'sum.cjs', 'sum.test.cjs')) { [IO.File]::WriteAllText((Join-Path $directory $leaf), 'fixed-disposable-membership-control') }
$enumerator = [SealedCopyCountingEnumerator]::new([IO.Directory]::EnumerateFileSystemEntries($directory).GetEnumerator())
Expect (Test-CloudSealedCopyMembership -Enumerator $enumerator)
Expect ($enumerator.Moves -eq 5 -and $enumerator.Reads -eq 4 -and $enumerator.Disposed)
$membershipMetrics += @{ corpus = 'native-owned-directory'; declaredEntries = 4; moves = $enumerator.Moves; reads = $enumerator.Reads; disposed = $enumerator.Disposed; accepted = $true }
[IO.File]::WriteAllText((Join-Path $directory 'fifth.txt'), 'fixed-disposable-membership-overflow')
$enumerator = [SealedCopyCountingEnumerator]::new([IO.Directory]::EnumerateFileSystemEntries($directory).GetEnumerator())
Expect (!(Test-CloudSealedCopyMembership -Enumerator $enumerator))
Expect ($enumerator.Moves -eq 5 -and $enumerator.Reads -eq 4 -and $enumerator.Disposed)
$membershipMetrics += @{ corpus = 'native-owned-directory'; declaredEntries = 5; moves = $enumerator.Moves; reads = $enumerator.Reads; disposed = $enumerator.Disposed; accepted = $false }
[IO.File]::Move((Join-Path $directory 'fifth.txt'), (Join-Path $directory 'fifth.closed.txt'))
[ordered]@{ schemaVersion = 1; passed = $true; controls = $count; evidence = 'Windows-PowerShell51-native-parser-native-membership-and-synthetic-receipt-controls'; membership = $membershipMetrics; actualGuestRun = $false } | ConvertTo-Json -Compress -Depth 5
