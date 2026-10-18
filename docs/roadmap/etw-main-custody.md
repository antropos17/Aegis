# Recovery after broker and all three elevated helpers exit

The surviving Electron main holds the capture's original reservation and four
original process-object references. Before StartTrace, the authenticated normal
broker duplicates query-limited + synchronize references into the actual normal
packaged main. They are noninheritable and have no terminate right. Main accepts
the private tuple only for its own PID and its original owned broker. A one-shot
acknowledgment precedes the final collector connection and capture authorization.

Custody is in main memory and its kernel handle table. No service, scheduled task,
account membership, machine permission, durable journal or extra resident process
is installed. Normal unmarked packages keep ETW disabled. Development and synthetic
four-argument broker modes keep their earlier contract; this handoff is enabled
by the fixed `main-escrow` argument in marked diagnostic packages.

## Original object proof

After an unverified original broker close, main creates one normal cleanup
controller. It verifies its actual packaged main parent's full birth, image,
user, logon and normal token. It retrieves the four retained objects from that
main, checking each original PID and full FILETIME through the copied handle.
It waits for all four original objects to signal exit. A timeout, missing reference,
wrong birth or live process authorizes no ETW control.

The controller applies the existing original-GUID query, handle recheck, handle-only
stop and absence query. It cannot select a name/provider/path, create a capture or
adopt a foreign session. Successful recovery releases the main-held deposits,
emits a terminal receipt and exits 4. Main requires both receipt and exit; capture
health remains FAILED, final stage totals stay null and an observation gap remains.
Only a later explicit retry can start a new capture. Retry during pending recovery
is refused without queuing a later UAC/capture.

Original broker cleanup releases deposits only after a valid capture/recovery
terminal. Main processes child `close` after stdout drain. A valid terminal with
an incorrect exit remains unverified and does not invoke another controller through
possibly released deposits. Failed imported proofs never close caller-supplied
main handle values. `DUPLICATE_CLOSE_SOURCE` closes even on API error, so release
is attempted once for internally created or fully validated references.

## Consent and protocol

Only actual native status 5 permits one cleanup-only same-account UAC attempt.
Before opening the dialog, either cleanup controller must receive main's private
`consent-ack`. Main remembers that request and never starts a second controller
after canceled, timed-out or interrupted original cleanup consent. Other native
errors and foreign identity never request elevation. The elevated worker retains
the existing restricted-pipe and full peer-identity checks and accepts only the
original reserved-GUID cleanup command.

Protocol `etw-file/8` adds a private zero-sequence `escrow` prelude, its acknowledgment,
cleanup consent acknowledgment, the cleanup request and `broker-and-all-helpers-exited`
terminal cause. Telemetry starts at hello sequence 1 and keeps the existing
single-encoding forwarding path. A replacement continues the original observed
sequence. Native Windows uint32 exits are normalized to signed int32 before matching
the original broker exit. Rebuild main/helper together; older versions are rejected.

The initial replacement budget is 40 seconds; native original-object waiting is
bounded at 15 seconds. Pending consent has an 8-second automatic acknowledgment
budget, one 120-second OS consent deadline and a 145-second main exit budget.
A verified terminal restores the 15-second exit budget. Native replacement lifetime
is bounded at 170 seconds. Original main exit cancels the replacement's linked
pipe deadline. Expiry cannot dismiss Windows consent; late peers still need a
live authenticated private command. App exit during cleanup consent is unqualified.

The reservation and process-handle values travel only through owned private pipes
and main's private closure. Diagnostics expose booleans for observed custody and
pending consent. The tuple never enters the reducer, ring, summary, renderer IPC,
CLI, persisted output or logging. These process references are separate from the
ETW control handle, which remains native-only.

## Packaged qualification

`--etw-group-recovery` plans twenty-two captures with a 32-minute ETW parent deadline:
five new group cases plus the [seventeen earlier cases](etw-total-recovery.md).
It plans twenty-two capture consents and two cleanup consents; query witnesses may
need more consent when ordinary queries are denied. Each failed case stops the
sequence. Private artifacts use manual seven-day diagnostic review and preserve
failed attempts and verification obligations.

The group cases are before StartTrace, before arm, broker-first, elevated-triple-first
and restricted-effective-token access denial. Original broker/collector/guard/fallback
exit themselves with codes 75/70/71/74, skipping cleanup. Fault modes require the
main handoff before capture. The broker-first collector checks actual original
broker exit before ordinary finally can stop the trace. Ready cases independently
observe session presence and all original helper IDs; every case independently
queries absence after cleanup. The original main must remain alive. No elevated
kill is used. These are coordinated exit orders, not instruction-level simultaneous
death or an actual unhandled SEH crash.

The profile also requires the earlier broker-only loss to recover through main
(original broker 72, collector 2, guard 0, fallback 0 or unverified 2, absence 4201),
then actual read attribution after collector loss and a fresh normal stop. Historical receipts are preserved;
the new group oracle cannot substitute an earlier blocked broker-loss result.

Qualification results are recorded separately. Main loss together with all native
helpers, protected durable authority/installation, actual declined consent, alternate
credentials, actual sleep/wake, complete I/O coverage, forced real PID/TID reuse and
production/path admission remain separate qualification gates. This is a mutable
local diagnostic authority, with production ETW disabled by default.

## Current result

The 2026-10-18 [packaged evidence](../recon/evidence/etw-packaged-main-custody.json)
records all five target cases PASS at runtime/harness source
`d05ecd0c9c8176277cb250d57e3ff64db5590a2c`. Both early boundaries and both ready
loss orders recovered through surviving original main custody. Original exits were
75/70/71/74, the cleanup controller exited 4 and independent queries confirmed
absence. Ready cases first observed session presence. Actual restricted-token
status 5 required separate elevated cleanup, and main observed pending consent.
Sensors stayed FAILED, stage totals remained null and no capture restarted itself.

All twenty-two unique cases passed across fourteen original captures and two
four-capture continuations on the identical immutable package. The original sweep
did not pass: fourteen cases passed before
the earlier `dual-collector-first` regression failed its PID-only CIM closure
witness. Native original-helper exits and controller exit 4 were verified;
subsequent enumeration found all observed IDs absent and a separate query returned
absence 4201. The discrepancy remains unclassified, and no product fix is claimed.
A continuation then expired before ready while awaiting UAC. After four more PASS
captures, another continuation stopped at `broker-exit`: main verified recovery
and controller exit 4, but fallback exited with native unverified code 2 instead of
the harness's required 0. Native fallback success is not the cleanup authority after
broker loss; surviving main independently waits for all four original objects and
verifies reserved-GUID cleanup. The corrected harness permits fallback 0 or 2 only
with that proof, controller receipt/exit 4 and absence 4201. A failing behavioral
test preceded the correction; 87 packaged-oracle tests then passed. The exact
internal fallback failure branch remains unclassified; no native fix is claimed.
All failed attempts remain FAIL. A fresh broker capture and the remaining three
cases passed at harness head `83078819` without changing the runtime or package.

The final collector-loss and normal workloads each performed 160 synchronous and
160 actually pending overlapped reads with issuer attribution witnesses. Collector
loss kept unknown final stage totals and an observation gap. The fresh normal
capture stopped with acknowledgment and exit 0; observed native loss counters were
zero, while the bounded main ring evicted 79 records. No loss-free or complete I/O
coverage is claimed. All twenty-six created profiles, including failed attempts,
had no diagnostic ETW or fixture file-access audit admission.

Earlier attempts also retain a NuGet runtime-download timeout before capture and
a harness PID mismatch after successful early cleanup. A no-ETW normal-package
probe showed that Playwright's Windows child is `cmd.exe`, while Electron main has
a different PID. The harness now records the actual main PID at launch; the current
package was frozen after that correction. All 231 archived main/shared JS/JSON files
match frozen runtime source, the native DLL matches publication and no mutation
fixture entered the archive. Later changes update documentation, evidence,
finite Windows CI failure diagnostics and the broker-only harness expectation
described above; ETW runtime files and the package stay frozen.

Published native self-tests passed 91 cases and the focused JS suite passed 259.
Normal-token original-object lifetime, limited rights, high-bit Windows exits and
synthetic transport were checked. Effective typecheck, Svelte check, renderer
build, formatting, lint and tracked-source counts passed. Runtime-head CI passed
8,685 tests with 1,218 skipped and both witness gates; that initial job failed only
four stale derived counts in two MD declarations, subsequently corrected. The
separate full local Windows coverage attempt reported failures in AppContainer,
gateway and installed-owner suites and reached its 300-second limit without completion.
One isolated installed-owner control passed afterward; the full Windows result is
not claimed fixed. Local Semgrep remains unavailable (`ENOENT`).

Two earlier hosted Windows fixture attempts failed existing natural-exit GUI
control 14. Finite failure diagnostics were added without changing acceptance;
their 17 tests, an actual reporter-format probe, and all 112 native assertions
subsequently passed locally and in hosted CI. Later passes do not establish the
earlier control's cause or a fix. Final PR checks are tracked on the current head.
