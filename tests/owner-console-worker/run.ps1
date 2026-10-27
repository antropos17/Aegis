param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$fixture = Join-Path $output 'owner-console-worker-fixture.exe'
& $compiler /nologo /platform:x64 /define:OWNER_CONSOLE_TEST ("/out:" + $fixture) (Join-Path $root 'sidecar/owner-console/ConsoleWorker.cs') (Join-Path $PSScriptRoot 'WorkerFixture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Worker fixture compilation failed.' }
foreach ($scenario in @('early', 'idle', 'valid', 'wrong', 'trailing', 'after', 'closed-output', 'closed-input', 'invalid-preview', 'invalid-cr', 'invalid-nul', 'invalid-esc', 'multiline', 'oversized', 'cancel-wait', 'overlong', 'max-preview', 'preview-too-large', 'probe-idle', 'probe-during', 'probe-interleaved', 'probe-after', 'probe-after-input', 'probe-invalid', 'probe-replay', 'probe-overlap', 'keyup-flood', 'blocked-write', 'blocked-read')) {
    & $fixture outer $scenario
    if ($LASTEXITCODE -ne 0) { throw "Worker fixture failed: $scenario" }
}
