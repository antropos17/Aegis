param([string]$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')), [switch]$MutationControls)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'stdio-windows-powershell-required' }
. (Join-Path $ProjectRoot 'scripts/qualification/cloud-guest-media.ps1')
function Test-StdioClosedDiagnostic([string[]]$Lines) {
    if ($Lines.Count -lt 7 -or $Lines.Count -gt 8 -or ($Lines -join "`n").Length -gt 1024) { return $false }
    if ($Lines[0] -cnotmatch '\Astdio-fixture-case:(Initialize|node|echo|burst|cap|error-cap|hold|deadline|wrong-peer)\z' -or
        $Lines[1] -cnotmatch '\Astdio-fixture-environment:case=(Absent|[1-5]|Other);nodeOptions=(True|False)\z' -or
        $Lines[2] -cnotmatch '\Astdio-fixture-operation:(None|Identity|Connect|PeerIdentity|InputWrite|OutputPeek|ErrorPeek|OutputRead|ErrorRead);nativeError=[0-9]{1,10}\z' -or
        $Lines[3] -cnotmatch '\Astdio-fixture-state:elapsed=[0-9]{1,10};connectedMask=[0-7];peerExited=(True|False);peerExitObserved=(True|False);peerExitCode=[0-9]{1,10}\z' -or
        $Lines[4] -cnotmatch '\Astdio-fixture-exception:(Identity|Invariant|Other);hresult=-?[0-9]{1,10}\z' -or
        $Lines[-2] -cnotmatch '\Astdio-fixture-phase:(Initialize|Create|Assign|Inventory|Attach|Exchange|Verify|Exit|Cancel|Closure)\z' -or
        $Lines[-1] -cne 'stdio-fixture-refused') { return $false }
    if ($Lines.Count -eq 8) {
        if ($Lines[5] -cnotmatch '\Astdio-fixture-result:(Complete|OutputLimit|Cancelled|Deadline);input=([0-9]{1,5});output=([0-9]{1,5});error=([0-9]{1,5});inputEof=(True|False);outputEof=(True|False);errorEof=(True|False)\z') { return $false }
        foreach ($at in 2..4) { if ([int]$Matches[$at] -gt 65536) { return $false } }
    }
    return $true
}
$sample = @('stdio-fixture-case:node','stdio-fixture-environment:case=Other;nodeOptions=True',
    'stdio-fixture-operation:InputWrite;nativeError=232','stdio-fixture-state:elapsed=20;connectedMask=7;peerExited=False;peerExitObserved=False;peerExitCode=0','stdio-fixture-exception:Invariant;hresult=-2146233079',
    'stdio-fixture-result:Deadline;input=8192;output=0;error=0;inputEof=True;outputEof=False;errorEof=False',
    'stdio-fixture-phase:Exchange','stdio-fixture-refused')
if (!(Test-StdioClosedDiagnostic $sample) -or !(Test-StdioClosedDiagnostic @($sample[0..4] + $sample[6..7]))) { throw 'stdio-diagnostic-positive-refused' }
foreach ($entry in @(@(0,'stdio-fixture-case:untrusted-value'),@(2,'stdio-fixture-operation:InputWrite;nativeError=232 extra'),
    @(5,'stdio-fixture-result:Deadline;input=8192;output=99999;error=0;inputEof=True;outputEof=False;errorEof=False'))) {
    $changed = @($sample); $changed[$entry[0]] = $entry[1]
    if (Test-StdioClosedDiagnostic $changed) { throw 'stdio-diagnostic-negative-admitted' }
}
$base = [IO.Path]::GetFullPath($env:TEMP)
$cursor = Get-Item -LiteralPath $base -Force
while ($null -ne $cursor) { if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'stdio-fixture-root-refused' }; $cursor = $cursor.Parent }
$owned = Join-Path $base ('aegis-stdio-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $owned | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$task = Join-Path $ProjectRoot 'scripts/qualification/stdio-fixed-task.cjs'
$sources = @('scripts/qualification/CloudGuestStdio.cs', 'scripts/qualification/CloudGuestStdioLauncher.cs',
    'tests/fixtures/native-cloud-guest-stdio/StdioFixture.cs', 'sidecar/session/GuestJobNative.cs', 'sidecar/session/GuestJobInventory.cs')
$hashes = @{}
foreach ($relative in $sources + @('scripts/qualification/CloudGuestStdioTask.cs', 'scripts/qualification/stdio-fixed-task.cjs')) {
    $file = Get-Item -LiteralPath (Join-Path $ProjectRoot $relative) -Force
    if ($file.PSIsContainer -or $file.Length -gt 64KB -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'stdio-source-refused' }
    $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Compile-Stdio([string]$Label, [string[]]$Selected, [string]$Entry) {
    $exe = Join-Path $owned ($Label + '.exe')
    $args = @('/nologo', '/target:exe', '/platform:x64', ('/main:' + $Entry), ('/out:"' + $exe + '"'))
    foreach ($path in $Selected) { $args += '"' + $path.Replace('/', '\') + '"' }
    $code = Invoke-CloudGuestNativeProcess $compiler $args (Join-Path $owned ($Label + '-compile.txt')) (Join-Path $owned ($Label + '-compile.error')) 10000
    if ($code -ne 0 -or (Get-Item -LiteralPath $exe).Length -gt 64KB) { throw 'stdio-compile-refused' }
    return $exe
}
$selected = @($sources | ForEach-Object { Join-Path $ProjectRoot $_ })
$exe = Compile-Stdio 'stdio' $selected 'StdioFixture'
$guest = Compile-Stdio 'guest-stdio' @((Join-Path $ProjectRoot 'scripts/qualification/CloudGuestStdioLauncher.cs'),
    (Join-Path $ProjectRoot 'scripts/qualification/CloudGuestStdioTask.cs'), (Join-Path $ProjectRoot 'sidecar/session/GuestJobNative.cs')) 'CloudGuestStdioTask'
$out = Join-Path $owned 'native.txt'; $err = Join-Path $owned 'native.error'
$code = Invoke-CloudGuestNativeProcess $exe @(('"' + $node + '"'), ('"' + $task + '"')) $out $err 10000
$expected = @('native-stdio-node:passed', 'native-stdio-echo:passed', 'native-stdio-burst:passed', 'native-stdio-cap:passed',
    'native-stdio-error-cap:passed', 'native-stdio-hold:passed', 'native-stdio-deadline:passed', 'native-stdio-wrong-peer:passed')
$lines = [IO.File]::ReadAllLines($out)
$census = @($lines | Where-Object { $_ -cmatch '\Anative-stdio-held-census:members=[2-4];payload=1;exactSystemConhost=[0-2]\z' })
if ($code -ne 0 -or (Get-Item -LiteralPath $err).Length -ne 0 -or $lines.Count -ne 9 -or $census.Count -ne 1 -or
    (($lines | Where-Object { $_ -cnotlike 'native-stdio-held-census:*' }) -join ',') -cne ($expected -join ',')) {
    Write-Output ('stdio-native-observation:exit=' + $code + ';stdoutBytes=' + (Get-Item -LiteralPath $out).Length + ';stderrBytes=' + (Get-Item -LiteralPath $err).Length)
    $diagnostic = [IO.File]::ReadAllLines($err)
    if (Test-StdioClosedDiagnostic $diagnostic) { foreach ($line in $diagnostic) { Write-Output $line } }
    else { Write-Output 'stdio-native-diagnostic:unavailable' }
    throw 'stdio-native-controls-refused'
}
$parts = $census[0] -split '[=;]'
if ([int]$parts[1] -ne 2 + [int]$parts[5]) { throw 'stdio-held-census-refused' }
# A disposable schedule drains the authenticated channels after stdin EOF, then lets
# the retained helper exit naturally between the live snapshot and identity recheck.
$transportText = [IO.File]::ReadAllText($selected[0]); $seam = 'live = CheckExchangeLive(result.InputEof, clock, milliseconds, cancellation);'
if ($transportText.Split(@($seam), [StringSplitOptions]::None).Count -ne 2) { throw 'stdio-natural-exit-seam-refused' }
$schedule = 'if (result.InputEof) { var schedule = Stopwatch.StartNew(); while (!result.OutputEof || !result.ErrorEof) { Need(schedule.ElapsedMilliseconds < 2000); Need(Drain(pipes[1], output, outputLimit, ref result.OutputEof) && Drain(pipes[2], error, errorLimit, ref result.ErrorEof)); Thread.Sleep(1); } Need(GuestJobNative.WaitForSingleObject(process, 2000) == 0); } live = CheckExchangeLive(result.InputEof, clock, milliseconds, cancellation);'
$scheduled = $transportText.Replace($seam, $schedule)
foreach ($label in @('natural-exit-fixed', 'natural-exit-original', 'natural-exit-wrong-birth', 'native-wait-failed',
    'inner-first-wait-failed', 'inner-final-wait-failed', 'inner-first-guard-bypassed', 'inner-final-guard-bypassed')) {
    $text = $scheduled
    if ($label -ceq 'natural-exit-original') {
        $recovery = 'CheckExitedIdentity(clock, milliseconds, cancellation); return false;'
        if ($text.Split(@($recovery), [StringSplitOptions]::None).Count -ne 2) { throw 'stdio-natural-exit-seam-refused' }
        $text = $text.Replace($recovery, 'throw new InvalidDataException("guest-job-inventory-unavailable");')
    }
    if ($label -ceq 'natural-exit-wrong-birth') { $text = $text.Replace('CheckExitedIdentity(clock, milliseconds, cancellation); return false;', 'birth++; CheckExitedIdentity(clock, milliseconds, cancellation); return false;') }
    if ($label -ceq 'native-wait-failed') { $text = $text.Replace('uint wait = GuestJobNative.WaitForSingleObject(process, 0);', 'uint wait = 0xffffffff;') }
    # Fail the exact exchange wait after EOF on a real retained, naturally exited process.
    # Bypassed guards are positive controls: the independent fixture must admit them.
    if ($label -clike 'inner-first-*') {
        $text = $text.Replace('uint firstWait = GuestJobNative.WaitForSingleObject(process, 0);',
            'uint firstWait = inputEof ? 0xffffffff : GuestJobNative.WaitForSingleObject(process, 0);')
    }
    if ($label -clike 'inner-final-*') {
        $text = $text.Replace('uint firstWait = GuestJobNative.WaitForSingleObject(process, 0);',
            'uint firstWait = inputEof ? 0x102 : GuestJobNative.WaitForSingleObject(process, 0);')
        $text = $text.Replace('uint finalWait = GuestJobNative.WaitForSingleObject(process, 0);',
            'uint finalWait = inputEof ? 0xffffffff : GuestJobNative.WaitForSingleObject(process, 0);')
    }
    if ($label -ceq 'inner-first-guard-bypassed') { $text = $text.Replace('Need(firstWait == 0 || firstWait == 0x102);', 'Need(true);') }
    if ($label -ceq 'inner-final-guard-bypassed') { $text = $text.Replace('Need(finalWait == 0 || finalWait == 0x102);', 'Need(true);') }
    $source = Join-Path $owned ($label + '.cs'); [IO.File]::WriteAllText($source,$text,[Text.UTF8Encoding]::new($false))
    $binary = Compile-Stdio $label @($selected | ForEach-Object { if ($_ -ceq $selected[0]) { $source } else { $_ } }) 'StdioFixture'
    $raceOut = Join-Path $owned ($label + '.txt'); $raceErr = $raceOut + '.error'
    $raceCode = Invoke-CloudGuestNativeProcess $binary @(('"' + $node + '"'), ('"' + $task + '"'), '--single-node') $raceOut $raceErr 10000
    if ($label -ceq 'natural-exit-fixed' -or $label -clike '*-guard-bypassed') {
        if ($raceCode -ne 0 -or [IO.File]::ReadAllText($raceOut).Trim() -cne 'native-stdio-node:passed' -or (Get-Item -LiteralPath $raceErr).Length -ne 0) { throw 'stdio-natural-exit-positive-refused' }
    } elseif ($label -ceq 'natural-exit-original') {
        $failure = [IO.File]::ReadAllLines($raceErr)
        if ($raceCode -ne 1 -or !(Test-StdioClosedDiagnostic $failure) -or $failure[2] -cne 'stdio-fixture-operation:Identity;nativeError=0' -or
            $failure[3] -cnotmatch ';connectedMask=7;peerExited=True;peerExitObserved=True;peerExitCode=0\z' -or $failure[4] -cne 'stdio-fixture-exception:Identity;hresult=-2146233087') { throw 'stdio-natural-exit-negative-admitted' }
    } else {
        $failure = [IO.File]::ReadAllLines($raceErr)
        if ($raceCode -ne 1 -or !(Test-StdioClosedDiagnostic $failure) -or $failure[4] -cne 'stdio-fixture-exception:Invariant;hresult=-2146233079' -or
            $failure[-2] -cne 'stdio-fixture-phase:Exchange') { throw 'stdio-exit-identity-negative-admitted' }
    }
}
$mutations = 0
if ($MutationControls) {
    foreach ($label in @('stdin-eof', 'stderr-drain', 'handle-list')) {
        $path = if ($label -ceq 'handle-list') { $selected[1] } else { $selected[0] }
        $source = [IO.File]::ReadAllText($path)
        $before = switch ($label) {
            'stdin-eof' { 'pipes[0].Dispose(); result.InputEof = true;' }
            'stderr-drain' { '!Drain(pipes[2], error, errorLimit, ref result.ErrorEof)' }
            'handle-list' { 'Need(UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));' }
        }
        $after = switch ($label) { 'stdin-eof' { 'result.InputEof = true;' }; 'stderr-drain' { 'false' }; 'handle-list' { 'Need(true);' } }
        if ($source.Split(@($before), [StringSplitOptions]::None).Count -ne 2) { throw 'stdio-mutation-seam-refused' }
        $mutant = Join-Path $owned ($label + '.cs')
        [IO.File]::WriteAllText($mutant, $source.Replace($before, $after), [Text.UTF8Encoding]::new($false))
        $mutantSources = @($selected | ForEach-Object { if ($_ -ceq $path) { $mutant } else { $_ } })
        $binary = Compile-Stdio $label $mutantSources 'StdioFixture'
        $failureOut = Join-Path $owned ($label + '.txt'); $failureErr = Join-Path $owned ($label + '.error')
        $failed = Invoke-CloudGuestNativeProcess $binary @(('"' + $node + '"'), ('"' + $task + '"')) $failureOut $failureErr 10000
        if ($failed -ne 1 -or !(Test-StdioClosedDiagnostic ([IO.File]::ReadAllLines($failureErr)))) { throw 'stdio-mutant-not-refused' }
        $mutations++
    }
}
& (Join-Path $PSScriptRoot 'test-cloud-guest-stdio-readiness.ps1') -ProjectRoot $ProjectRoot
& (Join-Path $PSScriptRoot 'test-cloud-guest-stdio-retained-exit.ps1') -ProjectRoot $ProjectRoot
# Retain a finite reviewed fixture set; no raw data or secret-bearing process output is logged.
[ordered]@{ schemaVersion = 1; scope = 'actual-same-principal-Job-owned-standard-handles'; nativeCases = 8;
    closedDiagnosticControls = 5; localNodeCaseSelected = 1;
    naturalExitScheduleControls = 8; innerWaitFailureControls = 2; innerWaitGuardMutationControls = 2;
    regressionMutationsRefused = $mutations; stdinBytes = 8192; stdoutBurstBytes = 56192; stderrBurstBytes = 48000;
    retainedLiveCensusMembers = [int]$parts[1]; exactSystemConhostMembers = [int]$parts[5];
    fixtureBinaryBytes = (Get-Item -LiteralPath $exe).Length; guestBinaryBytes = (Get-Item -LiteralPath $guest).Length;
    crossAccountTested = $false; existingGuestRuntimeWired = $false; productionEnabled = $false;
    launchAllowed = $false; e2Qualified = $false; sourceHashes = $hashes; ownedFixtureRoot = $owned; passed = $true } | ConvertTo-Json -Depth 4
