# Recovery after loss of all three elevated helpers

The architecture and qualification below record the v7 surviving-broker path.
Current marked packages also use [main-held custody](etw-main-custody.md) before
StartTrace; the later record separates its five target PASS cases from the still
incomplete full regression qualification. Earlier JSON receipts remain unchanged.

The normal broker receives the capture's original random reservation through the
authenticated collector channel before StartTrace. Both authenticated peer hellos
must carry the same canonical nonempty GUID. The reservation stays in memory and
private pipes; no GUID/control handle enters command lines, files, logs or renderer
IPC. The broker retains the original collector, guard and fallback process objects.

When their cleanup receipts cannot establish recovery, the broker waits for all
three original objects to signal exit. It then uses the reserved-GUID query,
native-handle recheck, handle-only stop and absence query. A live peer, mismatched
reservation, foreign GUID, unknown query or zero handle grants no takeover.
Capture remains FAILED, records are erased, application-stage totals stay null
and an observation gap remains. Explicit retry requires terminal proof and exit 4.

## Permissions and cleanup consent

This host already has Performance Log Users membership. Normal-token stop here
does not prove other users can control the session. The implementation changes no
membership, trace ACL, registry permission, service or scheduled task. Microsoft's
[ControlTrace](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew)
and [EventAccessControl](https://learn.microsoft.com/en-us/windows/win32/api/evntcons/nf-evntcons-eventaccesscontrol)
documentation describe the access boundary.

After actual access-denied status 5, the diagnostic broker requests **one**
same-account cleanup-only UAC decision. A replacement worker starts after the
original three exit. It authenticates the original normal broker's PID, full birth,
image, user, logon and elevation over a restricted first-instance pipe. It accepts
the private original GUID and has no caller-selected name/provider/path or capture
operation. The broker verifies the identity-checked stop, absence receipt and
replacement exit 0. Foreign identity and other failures do not request elevation.

Protocol `etw-file/7` adds pending-consent and original peer exit metadata. Rebuild
main/helper together. Pending consent stays FAILED with retry blocked. One native
120-second consent deadline has a 135-second outer process budget; duplicates
cannot extend it. Successful terminal proof restores the 15-second exit budget.
Rejection, timeout, invalid receipt or wrong exit stay unverified. Expiry cannot
dismiss Windows consent; a late worker must still authenticate the original broker
and receive a live private command. Closing the app during consent certifies no
cleanup. No capture is automatically restarted.

That v7 qualification uses a surviving original broker. Its authority does not
survive broker loss. Current v8 main-held custody addresses broker-plus-peer loss
while the original main survives; protected durable recovery after main loss and
installed-binary provenance remain separate gates.

## Packaged qualification

`--etw-total-recovery` plans seventeen captures: before StartTrace, before arm,
collector-first, guard-first, fallback-first and denied-controller recovery, plus
the [eleven existing regressions](etw-dual-recovery.md). Its parent deadline is
25 minutes. It requires seventeen capture UAC decisions and one cleanup consent;
query-only witnesses can also require consent if ordinary queries are denied.

The original collector, guard and fallback exit themselves with codes 70, 71 and
74, skipping cleanup. Ready cases require independent session presence and four
observed original helper/controller IDs. The broker confirms original object exits;
after cleanup, independent queries require status 4201 and observed helpers must
be gone. Tests cover coordinated loss orders, not instruction-level simultaneity.
No elevated kill is used.

The denied-controller case applies a temporary restricted impersonation token to
the synchronous control attempt. It must produce actual status 5 and restore the
original token before any await, pipe operation or cleanup launch. The replacement
performs real elevated same-account cleanup. No account or OS setting changes.
This qualifies a restricted effective token, not alternate credentials. Local
permission probes retain their original results separately; raw capture receipts,
profiles and screenshots remain private under manual seven-day diagnostic review.

## Current result

The 2026-10-18 [packaged evidence](../recon/evidence/etw-packaged-total-recovery.json)
binds six target PASS cases to runtime/harness source
`6b66655ac65a9a8976a7a29d72a50219f8a077e9`. Both early boundaries and all three
first-loss orders recovered with original collector/guard/fallback exits 70/71/74.
The denied-controller case observed pending consent in main, actual native status
5, elevated replacement cleanup and independently queried absence. The surviving
broker was normal in every target case. Sensors remained FAILED, final stage totals
were null and no capture automatically restarted. All target cases independently
queried absence afterward; ready cases first observed actual session presence.

Thirteen planned captures passed in the first attempt. The full sweep stopped at
`broker-exit` before ready while a Windows consent window was awaiting a decision.
A continuation on the identical package reached the same startup expiry. Its
earlier private launch attempt used an incorrect executable basename and failed
before capture. These failed attempts are retained; no single-sweep PASS is claimed.

After fresh UAC confirmations, a bounded continuation passed `broker-exit`,
`app-exit`, collector-after-ready and fresh normal capture on the same immutable
package. The seventeen-case oracle accepted the thirteen retained PASS captures
plus these four actual PASS captures. The checkout only added documentation after
the runtime freeze; the harness, runtime and full package manifest stayed unchanged
before/after the continuation. Both read captures verified synchronous reads and
160/160 actual pending overlapped reads. The fresh normal capture stopped with
exit 0, zero sampled native/stage drops and 78 main-ring evictions; complete read
coverage is not claimed.

All 229 archived main/shared JS/JSON files matched frozen source, the native DLL
matched publication, no mutation fixture entered the package and the full package
manifest remained unchanged after the attempts. Nineteen created profiles,
including failed startups, had no diagnostic ETW/fixture audit admission; the failed
launch created no profile. Native self-tests passed 86 cases and focused JS tests
passed 223. Typecheck, task lint, derived counts, native whitespace and normal-token
synthetic transport passed. Local Semgrep was unavailable (`ENOENT`).

Broker loss together with all elevated peers was outside that frozen evidence.
The [main-held follow-up](etw-main-custody.md) now records five target PASS cases
and all twenty-two regressions across fourteen original captures and two four-capture
continuations on the same immutable package. Failed attempts remain recorded;
no single-sweep PASS is claimed. Refused/abandoned cleanup
consent, protected durable recovery after main loss, protected installation,
alternate credentials, actual sleep/wake, complete I/O coverage and production/path
admission remain explicit limits. Ordinary production ETW remains disabled by default.
