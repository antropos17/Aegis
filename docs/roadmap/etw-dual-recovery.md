# Recovery after collector and guard loss

The diagnostic backend starts an independent elevated fallback before StartTrace.
It inherits the same approved collector token and requires no additional capture
UAC decision. Its owner and normal broker use separate restricted, first-instance
local pipes with mutual PID, full creation FILETIME, executable, user, logon and
elevation checks. The fallback also retains a query-limited original primary-guard
process object after checking the same identity fields. No PID is reopened for
recovery and no termination rights are requested.

Both recovery peers acknowledge the collector's random per-capture GUID before
the public hello and StartTrace. A lost fallback prevents or ends capture. Its
private reservation stays in memory; no session GUID/control handle is written
to disk, a command line or renderer IPC. After owner EOF or broker loss, fallback
cleanup waits for the original collector and primary guard to exit. An expired
wait grants no stop authority. It then uses the reserved-GUID lookup and original
handle recheck introduced by the [pre-arm recovery change](etw-failure-boundaries.md).
Foreign identity, query failure and a zero handle stay unverified. There is no
stop-by-name, arbitrary session adoption or capture retry.
Native operations follow Microsoft's [ControlTrace query/stop contract](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew).
Retaining the original object follows the distinction between [process handles and identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers).

The normal collector stops first, disarms the primary guard, then disarms the
fallback. Fallback disarm is query-only and requires primary exit 0 plus fixed-name
absence status 4201. Collector disposal closes the fallback pipe without waiting
for its exit: fallback crash recovery requires that very collector to exit. The
normal broker independently retains both recovery peers and waits for their exits.

On a failed capture, the broker requires fallback exit 0 and a matching receipt
with confirmed absence and exact original-peer exit codes. Healthy primary recovery
keeps its measured stop counters. When only the fallback can certify cleanup, the
closed v6 recovery cause is `collector-and-guard-exited`; rebuild main and helper
together. Main stays FAILED, clears diagnostic records and retains unknown stage
totals with an observation gap. Explicit restart becomes available only after the
terminal receipt and broker exit 4. Nothing restarts or requests UAC automatically.

## Packaged qualification

Select `--etw-dual-recovery` instead of the other ETW profiles in the isolated
desktop qualifier. It plans eleven captures: four additional pair-loss cases and
the [seven existing regressions](etw-failure-boundaries.md). There is a 20-minute
parent deadline, bounded per-case waits, independent before/after native queries,
retained original-peer exits and actual Sensors health checks. Each planned capture
needs one same-account UAC decision. An ordinary query denied by Windows can also
require the existing explicit query-only elevated witness.

The four fixed native faults cover collector exit before StartTrace, collector
exit after StartTrace/before arm, collector-first loss after ready and guard-first
loss after ready. The affected processes exit themselves with codes 70 and 71,
bypassing their cleanup. In collector-first modes the primary exits when its
original collector exits; in guard-first mode the collector exits when its original
guard is lost. These are coordinated pair failures with observed ordering, not a
claim of instruction-level simultaneous crashes. The broker accepts fallback
cleanup only after both original objects signal exit. No elevated kill is used.

The local regression requires no ETW control while either peer is alive, rejection
of mismatched/incomplete receipts and preservation of primary measured counters.
The package oracle rejects missing cases, missing original helper observations,
wrong recovery causes, fabricated final stage totals and unknown absence statuses.
Raw receipts, profiles and screenshots remain private with the existing manual
seven-day diagnostic review policy. Qualification results are recorded separately.

The 2026-10-18 [packaged evidence](../recon/evidence/etw-packaged-dual-recovery.json)
records all eleven captures PASS at `5a09b16ae2140ee91cb1772bc23aca7173f10603`.
Both ready loss orders required independently observed session presence before
the fault and native status 0 from fallback stop; all cases independently queried
fixed-name absence afterward. Both early boundaries passed, with before-start
status 4201 and unknown native counters. The broker verified original collector
exit 70, primary exit 71 and fallback exit 0 for the four new pair-loss cases.
The actual Sensors card remained FAILED, diagnostic records were erased, stage
totals stayed null and no capture automatically restarted. Single guard loss now
also has verified fallback absence after the collector's own cleanup; broker loss
continues to block retry because main has no authenticated terminal receipt.

The subsequent fresh capture verified actual synchronous and pending overlapped
Read witnesses, normal quit and helper closure. Native/stage losses were zero
in that capture, with 77 main-ring evictions; this is not complete read coverage.
All 229 archived main/shared JS/JSON files matched the frozen source, the native
DLL matched its published copy and no mutation fixture entered the package.
An additional scan of all eleven profiles found no diagnostic ETW/fixture audit
admission. Native self-tests passed 81 cases and the focused JS suite passed 192.
No packaged attempt failed in this task. Earlier local compile/test-construction
errors and the meaningful native red test are identified in the evidence.

This historical profile is an in-memory recovery authority in a mutable local
diagnostic package. It did not qualify loss of all three elevated peers. The
[all-helper follow-up](etw-total-recovery.md) now records six target PASS cases with
the original normal broker surviving; four packaged regressions remain incomplete.
Loss of broker plus all elevated peers, protected/durable service recovery,
protected installation, alternate credentials and actual sleep/wake remain unqualified.
Production ETW stays disabled by default. Path confirmation, complete I/O coverage
and the remaining E1-E8 gates are unchanged.
