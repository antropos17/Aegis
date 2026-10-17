# Diagnostic issuer proof and collector recovery

Protocol `etw-file/6` adds a narrow Read v1 issuer proof and independent cleanup
guard. Production capture, path confirmation and downstream FileEvent admission
remain gated. This document describes implementation; each live receipt binds its
result to a source SHA and does not qualify subsequent runtime changes.

Read v1 supplies `IssuingThreadId`. A later lookup alone cannot identify an earlier
event. The collector instead retains original thread/process handles before an
eligible event, requires both objects to remain live across its fresh creation-time
query and stamps the event only inside that held interval. The first lookup, exited
objects, reordered events and unavailable queries stay unverified. Retention is
128 pairs / 30 seconds, without a birth-time cache. Main joins only an exact full
FILETIME OS witness to a reliable annotated population. A same-millisecond mismatch
is rejected even if its legacy instance ID matches. Header PID and path correlation
do not grant issuer authority. See Microsoft's [issuing-thread schema](https://github.com/microsoft/Tx/blob/master/Generated/Microsoft_Windows_Kernel_File.cs),
[thread owner API](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessidofthread)
and [held-object waiting semantics](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject).

The collector starts an elevated guard with its inherited token. The normal broker
independently verifies that exact process using query-limited retained handles,
restricted local pipes and full PID/birth/image/user/logon/elevation checks. Before
provider enablement, the guard receives the original StartTrace handle and random
session GUID, independently queries them and acknowledges ownership. It never
adopts or stops a session by name or prefix. Normal disarm independently queries
the original handle after stop. Collector exit triggers bounded handle/GUID query,
owned stop and absence query, delivered through a separate authenticated pipe.
[ControlTrace](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew)
invalidates a stopped handle. Absence means that armed original handle no longer
queries successfully with the accepted native absence statuses; it is not a global
claim that no similarly named session exists.

Broker exit 4 plus a validated recovery receipt confirms cleanup while preserving
FAILED capture health. Application-stage totals remain null and `observationGap`
stays true. No receipt, receipt without expected exit, guard failure or conflicting
session GUID blocks retry. Explicit retry after confirmed cleanup is permitted;
there is no automatic relaunch/UAC. Crash before guard arming, simultaneous guard
and collector loss, protected installation, alternate credentials and actual
sleep/wake remain open. Held-handle PID/TID reuse is modeled in deterministic
tests; real reuse is not forced by the packaged check.

The optional packaged profile runs two planned captures: controlled collector
`Environment.Exit(70)` after ready, then a separate normally stopped capture only
after verified cleanup. The normal-token native fixture independently records
PID, TID, fresh FILETIME and QPC intervals for synchronous reads and actual pending
overlapped I/O. A rapid-exit process must produce unresolved evidence without an
incorrect generation join. Actual preload health, visible Sensors failure, no
automatic restart, bounded retention, content exclusion and observed helper exit
are checked. This is a mutable diagnostic build and a bounded host scenario;
warm mmap, Fast I/O, comprehensive coverage and all E1–E8 gates remain open.
