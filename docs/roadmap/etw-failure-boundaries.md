# Remaining diagnostic ETW failure boundaries

The optional `--etw-failures` packaged qualification exercises five additional
boundaries plus the existing collector-crash/read-attribution and fresh normal
capture regression. It is a mutable local diagnostic build. Ordinary packages,
production admission, path confirmation and protected installation remain gated.

The collector's authenticated guard now acknowledges a random per-capture session
GUID reservation before StartTrace. If the collector dies before transferring its
successful StartTrace handle, the guard queries the fixed name without stopping
anything. Only a matching reserved GUID with a nonzero native HistoricalContext
can become an original-handle candidate. Recovery rechecks that handle/GUID before
stopping by handle and independently queries absence. A foreign occupied name,
invalid handle or failed query never grants stop authority. Before-start absence
is status 4201 with unknown counters, rather than a fabricated successful zero-loss
stop. No reservation or raw handle is persisted or exposed to renderer IPC.

This closes a diagnostic ownership handoff gap; it does not establish a protected
service or durable recovery authority. The random GUID is an in-memory capability
shared only over the mutually authenticated owner/guard pipe. Microsoft documents
[ControlTrace query/stop semantics](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew),
and its [TraceEvent session implementation](https://github.com/microsoft/perfview/blob/main/src/TraceEvent/TraceEventSession.cs)
uses queried Wnode.HistoricalContext as the session handle. Unlike generic session
attachment, this implementation requires the preannounced GUID and rejects foreign
identity before any handle-based recovery operation.

The fixed fault modes exit only their own process: collector before StartTrace,
collector after StartTrace/before guard arm, guard after arm, broker after ready,
and the owned Electron main process. The latter bypasses normal app quit. No user
process intervention, arbitrary elevated kill, session-prefix cleanup or automatic
capture retry occurs. Native fault modes are selectable by main only in a marked
diagnostic package with one valid root and one exact whitelisted flag.

Pre-ready collector faults require an authenticated guard receipt and broker exit
4. A lost guard or broker leaves main FAILED and restart blocked even if a separate
qualification witness subsequently observes absence. Failed runs retain maxima
from previous samples, but final counters/totals are null unless a valid terminal
stop/recovery and its expected process exit were both observed. Observation gaps
remain explicit. Nothing infers zero loss from a previous heartbeat.

The query-only helper checks only the fixed session name. It cannot stop a trace,
select a provider or write an elevated output file. Status 0 proves presence;
4201 proves name absence; access denial and other errors are unknown. The normal
qualification owner retains bounded output. If an ordinary query is denied, it
explicitly launches a same-account query-only elevated peer over a restricted,
mutually authenticated pipe. Each scenario records before/after queries; ready
scenarios also require actual presence before the fault. Pre-ready helper exits
are confirmed by the broker's retained peer objects; later scenarios additionally
record independent owned PID enumeration.

Run the isolated desktop qualifier with `--etw-failures` instead of `--etw`.
Seven planned captures each request one normal same-account UAC decision; query
witness UAC may additionally be needed if ordinary queries are denied. There is a
15-minute parent deadline, bounded per-case waits and private receipts/screenshots.
Any failed case stops the sequence before another capture. Diagnostic artifacts
use the existing manual seven-day review policy and preserve failed attempts.

The original seven-case profile did not qualify simultaneous collector/guard loss.
The later [dual-loss recovery](etw-dual-recovery.md) adds an independent pre-reserved
fallback and eleven packaged cases. Loss of all three elevated peers still needs
protected durable authority; neither profile deliberately orphans that topology.
Actual sleep/wake, alternate credentials, complete I/O coverage, real forced
PID/TID reuse and the remaining E1-E8 gates are separate qualification work.

The 2026-10-18 [packaged evidence](../recon/evidence/etw-packaged-failure-boundaries.json)
records all seven scenarios PASS at `278f075438ee7c027f1435be4721a48db4ca0049`.
Before-start exit produced status 4201 with unknown counters; pre-arm exit produced
verified guard cleanup with native query status 0. Guard/broker loss kept FAILED,
retry blocked and final counters/totals null, while independent queries subsequently
observed absence. Abrupt Electron exit 73 also left no observed owned helper or
session. The existing actual sync/pending-overlapped issuer proof, collector crash
and new normally stopped capture passed unchanged. A separate explicit elevated
query-only witness passed; the access-denied fallback trigger was not induced.

All 229 packaged main/shared JS/JSON files matched the clean worktree; the published
native DLL matched its packaged copy and no mutation fixture entered the archive.
The first packaging attempt failed before ETW because a concurrently running
mutation gate removed a temporary file while the packager enumerated it. That
receipt is retained; the successful run started after both gates completed. The
evidence also hashes the raw receipts/package manifest and independently checks
all audit rows in all seven retained profiles for diagnostic admission.
