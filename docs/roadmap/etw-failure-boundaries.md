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

Simultaneous loss of collector and guard still needs protected recovery authority;
this profile does not deliberately orphan such a session or claim it recovered.
Actual sleep/wake, alternate credentials, complete I/O coverage, real forced
PID/TID reuse and the remaining E1-E8 gates are separate qualification work.
