# ETW recovery across a Windows restart

Status: **protocol-10 tooling prepared; current-package owner execution pending**.
No UAC, elevated capture, owner recovery or restart was performed for this change.
The protocol-9 preflight and preparation/cancellation below are historical.
Unit tests and builds cannot establish current-package or restart acceptance.
Ordinary explicit scoped capture already exists; downstream file admission
remains behind the separate [recovery decision](windows-recovery-admission.md).

The [protected durable reservation](etw-durable-recovery.md) already handles an
absent stale record from another logon or package scope. It requires independent
session absence and proof that all six original identities are gone. The new
qualification uses that runtime path without adding boot-based cleanup authority.
No runtime defect has been reproduced in that path yet.

The native read-only observer now reports SHA-256 digests of the entire canonical
current and previous protected reservation payloads, plus whether the previous
record matched the custodian's scope. These observations grant no control
authority. Resume requires the previous digest to match preparation and records
the observed scope comparison. A generic "some journal was recovered" observation
alone could otherwise count a different record. This extends only the private
qualification notice; public telemetry remains `etw-file/10` and the durable
record format and cleanup authority are unchanged. Unknown private notice fields,
invalid digests and inconsistent previous-digest/scope pairings are rejected.

Before this adapter changed native inputs, selected native and ETW runtime
sources matched #986's qualified retained-handle renewal implementation. Preserve
that pre-change checkpoint and #985's historical intermittent failure. The unique
cause of that old failure remains unproven. The changed helper requires a fresh
source/package/build-bound owner qualification; no new native acceptance follows
from source equality or compiled fixtures.

The scope comparison is a branch observation, not a boot identity. Microsoft
documents [logon IDs as LUIDs](https://learn.microsoft.com/en-us/windows/win32/secauthn/lsa-logon-sessions)
and [LUID uniqueness only until restart](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-allocatelocallyuniqueid).
The qualification therefore permits either observed scope comparison while still
requiring an independently observed later OS boot and the exact previous record.
This does not claim that actual logon-SID reuse was forced.

## Historical protocol-9 pre-restart evidence

PR #974's [bounded preflight receipt](https://github.com/antropos17/Aegis/blob/0c7a6e8a939b79c1b57ef24c8c7b5d102038dd61/docs/recon/evidence/etw-packaged-reboot-preflight.json)
records one complete 32-scenario packaged sweep with no retry. Its temporary
launch host accounted for 39 children, including the two earlier cleanup workers,
and closed with zero live children. Both real read workloads passed with 160
synchronous reads and 160 asynchronous reads with actual pending I/O and full
issuer witnesses per capture.

The separate preparation reached `PREPARED` after all six original process
objects exited and an independent query still found the session. Attempting
resume in that same Windows boot returned the expected `FAIL` before starting
UAC or a new capture; the original session remained present. Cancellation then
matched the exact prepared record digest, recovered before its own StartTrace
and finished `CANCELLED`. Each live phase had one collector exit 70 and a closed
temporary launch host. Final independent status was 4201, with zero remaining
`EtwFile.exe` processes. The user deferred the actual restart, so a **fresh
preparation is required immediately before that restart**; the cancelled receipt
cannot establish restart recovery.

The frozen package and 32-scenario harness are revision
`3547b5195a695293549f4c35ce4d14744fcca3e1`. Preparation, refusal and cancellation
use harness `212fbe85ae7d12f0aff91ed63cf1aed643d16364`; its native and main/shared
sources match the frozen package inputs. That harness fixes two oracle errors:
accepting contradictory child exits and requiring the scope label to change
across every restart. Tests reproduced both before the correction. Current
focused ETW tests passed 408 cases and that helper passed 108 self-tests.
All 39 disposable profiles passed the content, audit-exclusion and size checks.
Raw receipts and private correlation values remain outside Git; their hashes are
in the projection. These controls leave actual restart acceptance pending.

## Two separately consented phases

`tools/development/etw-reboot.mjs` uses a marked, self-contained diagnostic
`win-unpacked` package. From the reviewed clean isolated worktree, use the supported
build producer below with qualified Node 24.16+ and .NET SDK 10. An ordinary
physical `npm ci` installation must already exist in this worktree. Use a new
absolute output directory on the spacious X: drive; retain it unchanged through
all owner phases. This command builds and runs only the helper's non-capture
self-tests; it returns before the desktop probe, GUI, UAC or capture:

```powershell
node tools/development/packaged-desktop.mjs --etw-build-only --source-sha <reviewed-commit> --output X:/tmp/aegis-reboot-build-<unique>
```

The producer creates `package/win-unpacked`, the exact builder input
`etw-builder.json`, `evidence/manifest.json`, the bounded build command logs,
`evidence/reboot-build.json` and `evidence/receipt.json` beneath that output.
The outer receipt must say `BUILD_PASS`; it makes no desktop or native capture
acceptance claim. It emits the reboot projection only after successful bounded
SDK observation, helper publish, published self-test and package commands, followed
by fresh source, archive, native, harness and config checks. SDK observation is
limited to 15 seconds/4 KiB of accepted version text; publish and Electron install
are each 240 seconds, the self-test is 30 seconds and package is 300 seconds.
Each child log is capped at 2 MiB. These are separate child budgets, not a total
shutdown deadline. Output, TEMP/TMP, .NET homes and caches stay under the selected
X: output; `DOTNET_GENERATE_ASPNET_CERTIFICATE=false` applies to SDK children.
No global configuration changes are required. Logs are private build-tool output;
keep credentials out of builder inputs. The projection emits only the hash of the
complete builder JSON and never its contents. It does not read application settings
or watched files. Fixture canaries cover projection, producer logs and closed
failure messages; external build tools are not claimed to redact arbitrary secrets.

Record the clean source commit and package/source binding before the first phase. The driver
checks the complete package manifest and requires the same clean source revision
for every phase. Source head/tree, lockfile, native/runtime source inventory,
native EXE/DLL, exact archived main/shared bytes, harness/scripts, actual successful
build receipt and exact builder configuration are bound independently. Input
changes require a new build/receipt chain. Hashes establish local correlation,
not signed release provenance. Receipts are private, capped at 256 KiB and never overwritten.

The generated private build projection requires schemaVersion=1, status=PASS,
the successful ordered bounded `etw-sdk-version`, `etw-publish`,
`etw-published-self-test` and `package` observations, sourceHead/sourceTree, lockSha256,
packageManifestSha256, nativeExeSha256/nativeDllSha256, runtimeSourcesSha256,
archiveSourceSha256, harnessSha256, configSha256, publicProtocol=`etw-file/10`,
observerContract=`full-record-sha256-v1`, exact electronVersion and dotnetSdk.
The SDK is observed in the same working directory used for publish; Electron's
installed distribution version must match its package metadata and any explicit
builder version. The producer supplies these values; do not hand-author or convert
an old receipt into this format.
Retain the builder JSON with extraMetadata.aegisEtwDiagnostic=true. A marked
diagnostic package differs from ordinary explicit-start capture; document that
difference before applying owner results to ordinary-package admission.

```powershell
node tools/development/etw-reboot.mjs --phase prepare --source-sha <reviewed-commit> --candidate X:/tmp/aegis-reboot-build-<unique>/package/win-unpacked --build-receipt X:/tmp/aegis-reboot-build-<unique>/evidence/reboot-build.json --config X:/tmp/aegis-reboot-build-<unique>/etw-builder.json --output X:/tmp/aegis-reboot-before-<unique>
```

Preparation starts a real capture with the existing `orphan-total-running`
diagnostic fault. The normal observer retains the original process objects and
records their actual self-exit codes: main 73, broker 0 or 75, collector 70, guard
71, fallback 74 and custodian 76. The protected record was flushed before the
original reserved acknowledgement. A normal-token write-open must actually be
denied. After all six originals exit, an independent query must still find the
owned session. The one-consent launch host must also close with zero live children.
Only then is preparation `PREPARED`; it cannot be `PASS`.

Preparation deliberately leaves one bounded diagnostic session and its protected
reservation. Its existing buffer limits apply; it writes no ETL file. Perform this
phase only when ready for a full Windows **Restart**, after saving user work. The
driver never invokes a restart, adds a service/task/autostart entry or stores
elevation. Restart and reopen the same worktree manually, then run:

```powershell
node tools/development/etw-reboot.mjs --phase resume --source-sha <same-reviewed-commit> --candidate X:/tmp/aegis-reboot-build-<unique>/package/win-unpacked --build-receipt X:/tmp/aegis-reboot-build-<unique>/evidence/reboot-build.json --config X:/tmp/aegis-reboot-build-<unique>/etw-builder.json --prepared X:/tmp/aegis-reboot-before-<unique>/receipt.json --output X:/tmp/aegis-reboot-after-<unique>
```

Before any UAC or capture, the driver queries
[`Win32_OperatingSystem.LastBootUpTime`](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem).
It requires a boot timestamp later than completed preparation, with a consistent
fresh observation timestamp. Same-boot relaunch, unknown observations and
nonincreasing or inconsistent timestamps fail qualification. Clock manipulation
remains outside this diagnostic. This timestamp is a test witness; the runtime never
uses it to authorize ETW control. Resume refuses changed package bytes or source.

The session must independently be absent before the new main starts. A fresh
packaged capture pauses before its own `StartTrace`; its native observer must
report handling of the previous protected record. Another independent query must
still report absence. Old final totals remain unavailable and the observation gap
remains explicit. After that cohort closes, a second fresh capture must observe
160 synchronous and 160 asynchronous fixture reads with actual pending I/O and
full issuer/birth witnesses, then stop with acknowledged cleanup. Both cohorts
require exact original-object child exits, including resumed collector exits
`[70, 0]`. Before each read workload, protocol-10 issuer preparation must
acknowledge the fixture's already observed PID/full OS birth; record its QPC
before the native read interval. Missing/mismatched/timed-out preparation prevents
the read command. Existing event-time proof remains mandatory; no PID lookup
after an event supplies authentication. Both cohorts
share one newly consented temporary launch host. The old host is never reused
across the restart.

If restart is postponed after preparation, cancel within the original boot:

```powershell
node tools/development/etw-reboot.mjs --phase cancel --source-sha <same-reviewed-commit> --candidate X:/tmp/aegis-reboot-build-<unique>/package/win-unpacked --build-receipt X:/tmp/aegis-reboot-build-<unique>/evidence/reboot-build.json --config X:/tmp/aegis-reboot-build-<unique>/etw-builder.json --prepared X:/tmp/aegis-reboot-before-<unique>/receipt.json --output X:/tmp/aegis-reboot-cancel-<unique>
```

Cancellation explicitly launches the same fixed capture path to recover the old
reservation and close normally. It requires one manual UAC decision and finishes
as `CANCELLED`. Its fresh initial query must still find the fixed session present,
matching the saved preparation's presence in the same boot; resume requires initial
absence after the restart. Both phases still require absence before the new trace
and after recovery, the exact previous full-record digest and complete host closure.
The fixed-name query grants no session identity or cleanup authority by itself.
Cancellation cannot supply reboot evidence. Preserve every failed attempt;
unknown cleanup needs investigation rather than PID/name-based termination.

## Scope and storage

This scenario covers a stale reservation left by controlled loss of all six
original processes, followed by a full Windows restart and explicit relaunch. It
does not test interruption during registry writes, hard power loss, hibernation,
Fast Startup, automatic capture at logon, protected installation, path confirmation
or complete event delivery. It adds no boot logger. Microsoft documents
[AutoLogger](https://learn.microsoft.com/en-us/windows/win32/etw/configuring-and-starting-an-autologger-session)
as a separate registry-configured boot mechanism; this diagnostic does not
configure it. Events across the gap are unavailable.

Keep TEMP/TMP and caches on the task data drive and require at least 3 GiB free
on system/output drives before owner phases. Commands cap logs at 2 MiB;
scenario children have five-minute deadlines; host consent/closure have separate
finite budgets. These impose no hard total native shutdown deadline. Each
recovery profile has a 16 MiB per-file and 64 MiB total budget. Retain raw
private process references, timestamps, file paths and receipts outside Git.
Publish only a bounded projection after the actual restart passes. Review closed
disposable diagnostics after seven days; no automatic deletion is configured.
