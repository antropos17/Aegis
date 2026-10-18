# ETW recovery across a Windows restart

The restart-spanning qualification is prepared; a real Windows restart has not
yet been observed for this revision. Unit tests, same-boot rejection and a
packaged build cannot establish reboot recovery. Production ETW remains disabled.

The [protected durable reservation](etw-durable-recovery.md) already handles an
absent stale record from another logon or package scope. It requires independent
session absence and proof that all six original identities are gone. The new
qualification uses that runtime path without adding boot-based cleanup authority.
No runtime defect has been reproduced in that path yet.

The native read-only observer now reports SHA-256 digests of the entire canonical
current and previous protected reservation payloads, plus whether the previous
record matched the custodian's scope. These observations grant no control
authority. Resume requires the previous digest to match preparation and the
previous scope to differ. A generic "some journal was recovered" observation
alone could otherwise count a different record. This extends only the private
qualification notice; public telemetry remains `etw-file/9`.

## Two separately consented phases

`tools/development/etw-reboot.mjs` uses a marked, self-contained diagnostic
`win-unpacked` package. Build it using the diagnostic packaging procedure in the
[desktop milestone](../development/packaged-desktop-milestone.md). Record the
clean source commit and package/source binding before the first phase. The driver
checks the complete package manifest and requires the same clean source revision
for every phase. Its receipts are private, bounded to 256 KiB, and never overwritten.

```powershell
node tools/development/etw-reboot.mjs --phase prepare --source-sha <commit> --candidate <absolute-win-unpacked> --output <new-absolute-before-directory>
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
node tools/development/etw-reboot.mjs --phase resume --source-sha <same-commit> --candidate <same-absolute-win-unpacked> --prepared <before-directory>/receipt.json --output <new-absolute-after-directory>
```

Before any UAC or capture, the driver queries
[`Win32_OperatingSystem.LastBootUpTime`](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem).
It requires a boot timestamp later than completed preparation, with a consistent
fresh observation timestamp. Same-boot relaunch, unknown observation and a clock
anomaly fail qualification. This timestamp is a test witness; the runtime never
uses it to authorize ETW control. Resume refuses changed package bytes or source.

The session must independently be absent before the new main starts. A fresh
packaged capture pauses before its own `StartTrace`; its native observer must
report handling of the previous protected record. Another independent query must
still report absence. Old final totals remain unavailable and the observation gap
remains explicit. After that cohort closes, a second fresh capture must observe
160 synchronous and 160 asynchronous fixture reads with actual pending I/O and
full issuer/birth witnesses, then stop with acknowledged cleanup. Both cohorts
share one newly consented temporary launch host. The old host is never reused
across the restart.

If restart is postponed after preparation, cancel within the original boot:

```powershell
node tools/development/etw-reboot.mjs --phase cancel --source-sha <same-commit> --candidate <same-absolute-win-unpacked> --prepared <before-directory>/receipt.json --output <new-absolute-cancel-directory>
```

Cancellation explicitly launches the same fixed capture path to recover the old
reservation and close normally. It requires one manual UAC decision and finishes
as `CANCELLED`. It cannot supply reboot evidence. Preserve every failed attempt;
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

Keep TEMP/TMP and caches on the task data drive. Commands cap logs at 2 MiB;
each recovery profile has a 16 MiB per-file and 64 MiB total budget. Retain raw
private process references, timestamps, file paths and receipts outside Git.
Publish only a bounded projection after the actual restart passes. Review closed
disposable diagnostics after seven days; no automatic deletion is configured.
