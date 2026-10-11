# Opt-in packaged token-accounting qualification

Issue #637 needs two hours of packaged runtime evidence. This separately invoked
harness provides a bounded **packaged-module fixture qualification**. It has not
established native scanner attribution, renderer/IPC delivery, provider billing,
real Claude process behavior, or the complete acceptance criteria of #637.

The executable must be an existing trusted Windows package. No build, install,
production-code edit, network provider request, or dependency installation is
performed by the harness. The packaged application's own `app.isPackaged`,
`userData`, and home paths are checked. A development Electron launch is rejected.
Source modules are read from that package's `app.getAppPath()/src/main`, through a
separate CommonJS cache. Existing adapter test seams isolate the synthetic home
and SQLite ledger; they do not mutate the live application's module cache.
The normal packaged application also starts, with an empty disposable profile
and HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP on X:. It can observe the host's
process population; this run qualifies synthetic accounting only.
Its launch environment allows only Windows system paths (SystemRoot/WINDIR,
COMSPEC, a system-only PATH and PATHEXT) plus those six disposable paths.
Parent credentials, custom executable search paths, Electron/Node flags and
unrecognised environment variables are omitted.
The system root is pinned to `C:\Windows`, matching the validated taskkill path.
Every launch search directory is checked as an existing ordinary directory with
an unchanged realpath; incompatible installations fail closed. PATH also includes
`C:\Windows\System32\WindowsPowerShell\v1.0` for packaged monitor commands.

Run from an AEGIS checkout with its normal dependencies available:

```powershell
$env:AEGIS_TOKEN_SOAK_OPT_IN = '1'
$env:AEGIS_TOKEN_SOAK_EXECUTABLE = 'X:\path\to\packaged\AEGIS.exe'
$env:AEGIS_TOKEN_SOAK_SMOKE = '1'
node scripts/qualification/token-accounting-soak.mjs
```

The smoke lasts 15 seconds and cannot claim two-hour acceptance. After reviewing
its receipt, remove `AEGIS_TOKEN_SOAK_SMOKE` for the separately authorised
two-hour run. Elapsed time uses the parent process's monotonic clock and includes
launch and restart time. Unique, numeric-only messages are alternated between
two synthetic identities every five seconds (one second for smoke), with each
message duplicated in its transcript. The independent oracle uses 100 input
tokens, 20 output tokens, and $0.0006 per unique message for the package's
`claude-sonnet-4-6` table. No production parser or pricing function computes the
oracle; a changed local pricing table causes a failure requiring review.

Every sample compares exact aggregate token totals and cost within 1e-8. It also
requires exactly the two numeric identity slots, each once, and checks each slot's
input/output totals against the parent's independent transcript append counts.
Swapping unequal identity totals fails even when their aggregate remains correct.
The parent copies both lifetime counts after each successful launch; per-identity
expectations subtract that launch baseline. Historical ledger totals restore
without PID attribution, so replay samples require zero tokens for both slots,
while aggregate totals retain all committed messages. Only new appends contribute
to those identity slots after restart. Missing, duplicate or extra slots and
invalid numeric identity totals fail with stable `identity-*` receipt codes.
A midpoint restart and a final restart replay the durable ledger without appending
a new message.
Storage pauses fail the run. Package version and executable SHA-256 identify the
tested artifact; this does not establish its Git commit or authenticity.
Smoke and soak both require at least four unique messages, at least two messages
for each synthetic identity, observations of nonzero accounting for both identities,
and exactly two restarts. A startup-dominated smoke fails these requirements.

Runs use fresh `X:\tmp\aegis-token-soaks\run-*` directories. A 2 GiB free-space
preflight, 1 GiB runtime floor, 256 MiB disposable-tree ceiling, 1 MiB sampled
receipt ceiling, and at most 1450 samples bound disk use. The retained receipts
contain no stdout/stderr stream, transcript content, real process data, raw error
text, or screenshots. Normal application diagnostics may exist inside the
disposable profile during the run and are included in its measured byte ceiling.
Each sample has numeric accounting, RSS, package version and disposable byte size.
RSS is observed; this harness does not assert a memory-growth acceptance threshold.
Samples include content-free collection reason/retryAt, explicit ledger bytes and
a 128 MiB ledger ceiling. Paused collection samples are written before failure.
Samples have a 20-second timeout, launch a 30-second timeout, close a 10-second
timeout, and a handled deadline rejection cancels guarded work two minutes after
the requested duration. Cancellation flows into awaited process cleanup; late
launch completion observes cancellation and closes its returned app. Failed
close uses the validated `C:\Windows\System32\taskkill.exe` with
`/PID <owned PID> /T /F` for that app instance and confirms
process exit before releasing ownership. Failed launch without a returned process
handle preserves the profile because exit cannot be independently confirmed.
All owned fixture setup is guarded by the final cleanup path. Existing ancestors,
including `X:\tmp`, are checked for junctions and realpath changes before creating
the run. Recursive cleanup also verifies realpath containment. Finally, the
validated disposable directory is removed; cleanup failure preserves it and fails
the receipt. Cleanup rejects symlinks/junctions. The bounded receipt and samples
remain for review. Keep at most five completed run receipts for 14 days; remove
older exact completed directories manually after review. Failed cleanup requires
investigation before another run; the script does not delete earlier runs.

Focused Node tests validate refusal of development mode, aggregate and per-identity
oracle divergence, both SQLite restart/replay epochs and new appends after restart,
storage-pause refusal, failed process-stop ownership, ancestor-junction refusal,
and scoped cleanup. They provide no packaged evidence:

```powershell
npx vitest run tests/main/token-accounting-soak.test.js --project main
```
