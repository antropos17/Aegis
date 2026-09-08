# Isolated ETW lifecycle harness (B4)

This Windows x64/.NET 10 experiment checks process/pipe ownership and explicit
empty-session UAC cleanup. It has no third-party packages, file provider,
file-event decoder, Electron import, installer integration or production defaults.
Its `etw-lifecycle/2` wire is deliberately separate from B3's `etw-file/1`.
Version 2 adds an independent authenticated cleanup pipe and report schema 2;
historical version 1 evidence remains unchanged.

## Run

From a **normal PowerShell**, in the repository:

```powershell
dotnet build sidecar/etw-lifecycle/EtwLifecycle.csproj -c Release
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' self-test
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' check 'X:/tmp/aegis-etw-lifecycle-check-new'
```

Use a new output directory for each run; existing directories are rejected.
The `check` command launches normal-token processes and never calls StartTrace.
Its eight scenarios take about nine seconds in the recorded local run; this is
not a performance budget. All coordinator modes reject an already elevated token.
Run the apphost `.exe`, not `dotnet EtwLifecycle.dll`, so peer image checks have
one fixed executable. The executable/managed assembly hashes are saved in the report.

The explicit UAC check was **executed successfully on the local Home host on
2026-09-08**. This command is the procedure for a future targeted run; the recorded
successful stop does not need repeating without a new question:

```powershell
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' uac 'X:/tmp/aegis-etw-lifecycle-uac-new'
```

It requests one UAC prompt for a hidden helper. If accepted with the same account,
that helper creates one empty real-time session named `AEGIS-EtwLifecycle`, queries
its initial statistics, stops it, retains the stop statistics and queries absence.
No provider is enabled and no file contents, paths, reads or process command lines
are collected. Requested session buffers are 256 × 64 KiB for this explicit
experiment; actual counts are reported. The measurement probe's budget is unchanged.

`uac-failures` runs four sequential fresh broker/collector pairs: stop, parent stdin
EOF, lease expiry and blocked primary output. Each launch can request UAC. The
batch stops at the first failed case and retains its report. These cases passed on
the local Home host on 2026-09-08; use a new directory for any justified rerun:

```powershell
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' uac-failures 'X:/tmp/aegis-etw-cleanup-uac-new'
```

Elevated abrupt-kill scenarios remain rejected by the broker. Actual
UAC refusal/cancellation, alternate credentials, elevated crash cleanup, suspend
and hostile remote/other-logon clients remain live gates. Same-account cross-integrity
pipe/process access succeeded on the recorded host. The development source
and build directory are trusted inputs; this is not a signed privileged service.

## Boundaries and authentication

The coordinator starts a normal-token broker. The broker creates two random local
pipes, each with `FILE_FLAG_FIRST_PIPE_INSTANCE`, `PIPE_REJECT_REMOTE_CLIENTS` and a
protected DACL. Each DACL permits the current logon SID to read/write data, read attributes
and synchronize, plus LocalSystem access. It omits create-instance rights from the
client grant. Default Everyone/Anonymous access is not used. The client specifies
identification-level SQOS so a server cannot impersonate the elevated client.

The broker holds the process returned by its fixed apphost launch. After connection
it compares the OS pipe client PID with that held process, exact creation FILETIME,
image path, user SID, logon SID and expected elevation. The collector independently
checks each pipe server against a held broker process and the launch creation witness.
Both pipe connections must pass authentication before the broker sends authorization.
The random launch ID binds messages; it is not sufficient proof of identity.
No user-specified executable, shell command, output path or provider configuration
is passed to the elevated process.

`WindowsIdentity.Groups` excludes logon groups, so `Security.cs` reads bounded
TokenGroups data and selects the `SE_GROUP_LOGON_ID` entry. Elevation uses
TokenElevation. Both use TOKEN_QUERY; role membership checks that need token
duplication are unnecessary. The SID values and command-line launch parameters
are never saved in the result artifact.

Peer image checks do not verify signatures, managed assembly integrity, dependency
loading, protection against code injection or a user-writable deployment. Packaging
and cross-integrity token/handle access must be validated before product use.

## Lifecycle and failure semantics

Authorization must arrive after mutual identity checks and before `ready` or any
session creation. Control sequences increase exactly by one. Stdio carries only
two bounded diagnostic lines to the coordinator; the pipe uses a four-byte LE
length and closed UTF-8 JSON frames capped at 64 KiB/depth 8. Flood test frames are
capped at 16 KiB padding. No frame backlog or background task list accumulates.

The experiment uses 500 ms broker pings, a 4 s peer read lease, 2 s write deadlines,
25 s maximum peer lifetime and a 1 s best-effort terminal write on each pipe. These accelerated
test values differ from the B2 production proposals. The collector also holds and
watches its broker process; broker death cancels I/O independently of pipe traffic.
Cleanup runs before the terminal write, so blocked output cannot prevent attempting
session stop. Native ETW calls are synchronous; this experiment does not establish
a hard deadline for a stuck kernel call.

After attempting stop, the collector tries `stopped` on the primary pipe, then one
`cleanup` frame on the separate pipe with its own ID and sequence 1. This second
receipt carries the same reason/final statistics and has a separate one-second
write deadline. If the primary terminal arrived, conflicting receipts are rejected.
The blocked-output case never resumes primary decoding: cancellation may have left
a partial frame there. The broker waits for the separate receipt and actual child
exit. An absent receipt, failed stop or unknown absence cannot pass live acceptance.
This receipt is the authenticated collector's report, not a second native observer.

The normal coordinator deadline is 35 s per case; the explicit UAC case allows
150 s. Ctrl+C is recorded as cancellation and closes broker stdin, allowing a
bounded graceful shutdown before the normal-token broker is terminated if needed.
The OS consent UI itself has no cancellable timeout in this implementation. If its
broker has disappeared, a late elevated helper cannot pass the held-parent check
and obtain authorization. Actual late-UAC behavior still needs a live test.

`OwnedTrace` obtains stop authority only after StartTrace succeeds, stops through
its original handle and preserves authority on failed stop for a cleanup retry.
An occupied fixed session name causes failure; nothing attaches to or stops the
existing session. A successful stop is idempotent. Unavailable counters stay null;
the terminal query status and subsequent absence-query status remain separate.

A crashed elevated collector can leave the empty session running. No automatic
orphan deletion is implemented. A later run fails on the occupied name instead of
creating more sessions or guessing ownership. This remains an E2 blocker; do not
interpret the normal-token kill tests as evidence of privileged ETW cleanup.

## Evidence and test coverage

`self-test` checks native layout; framing/uint64/UTF-8/schema/depth-bound parser
configuration; oversized length and truncation; sequence replay; ownership on
collision, unavailable query and failed stop; kernel-read DACL; first-instance
collision; real mutual peer identity; wrong client/server processes; authorization
timeout; a cancelled coordinator request; invalid/foreign/conflicting cleanup
receipts; and rejection of missing counters, absence, identity or child exit.
There are 14 self-tests. Native session calls in the ownership
unit tests use an explicit fake API.

`check` saves `result.json` with environment/runtime, build hashes, mode, scenario
outcomes, actual peer exit codes, primary stop acknowledgments and separate cleanup
receipt flags. All native statistics
must be null in this mode. The expected outcomes are checked explicitly:

| Case | Required observation |
| --- | --- |
| stop | Terminal stop acknowledgment, child exit 0. |
| parent-eof | Stdin closure relayed to collector; acknowledged cleanup, exit 0. |
| broker-kill | Kill the held broker only; collector's held-parent watcher exits 0. |
| peer-exit | Deliberate nonzero collector exit 7; failure remains visible. |
| peer-kill | Abrupt collector kill; broker gets EOF and no stop acknowledgment. |
| lease | Withhold pings; terminal lease-expired, exit 9. |
| blocked-write | Primary pipe stays unread; write deadline exits 10, primary acknowledgment false, separate cleanup receipt required. |
| launch-denied | Check-only injection of Win32 error 1223; no collector starts, refusal survives into the report. This does not exercise UAC. |

Each UAC case passes only with authenticated peer on both pipes, restricted DACLs, initial query
success, actual buffer fields, stop-query success with known loss counters,
absence status 4201, separate cleanup receipt and the expected child exit: 0 for
stop/EOF, 9 for lease expiry, 10 for blocked write. Primary acknowledgment is required
except in blocked-write, where it must be false. Failed runs remain on disk.
An empty session with zero losses says nothing about Kernel-File coverage or cost.

The historical version 1 [real UAC stop evidence](../../docs/recon/evidence/etw-lifecycle-home-26200-uac-stop.json)
records a passing same-account run using the same apphost/assembly as the eight
normal-token cases. Both identity checks and the restricted DACL passed; initial
and final native calls returned status 0, with 256 buffers of 64 KiB and all three
loss counters zero. Stop was acknowledged, both processes exited, and the
post-stop absence query returned 4201. No harness processes remained on the host.
Source hashes include canonical LF values to account for git checkout's CRLF/LF
conversion; the binary hashes match exactly.

The [version 2 cleanup evidence](../../docs/recon/evidence/etw-lifecycle-home-26200-cleanup.json)
records 14 self-tests, eight normal-token and four real elevated cases using the
same new binaries. All live cases reported successful stop and absence 4201,
256 × 64 KiB buffers and zero native loss counters. Blocked output reported no
primary acknowledgment and a valid separate receipt. No harness processes remained.
These results cover local same-account graceful failure paths. Broker death still
needs an independent authorized absence witness;
an elevated collector crash additionally needs a defined orphan-ownership design.
Do not claim cleanup from a missing pipe acknowledgment or normal-token kill test.

Local checks also include `dotnet format ... whitespace --verify-no-changes`,
Release build and the normal AEGIS checks. Existing GitHub CI does not compile or
run this separate C# harness; its five green contexts cannot replace Windows tests.

## References

The API basis is Microsoft's [pipe security guidance](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[named-pipe creation flags](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew),
[peer process IDs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid),
[token queries](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation),
[StartTrace](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew)
and [ControlTrace](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew).
The .NET [WindowsIdentity source](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Security.Principal.Windows/src/System/Security/Principal/WindowsIdentity.cs)
explains the logon-group exclusion. APIs and the local checks support the limited
claims above; E1/E2 completion still requires the separately listed live evidence.
