# Windows recovery admission decision

Status: **W11 block 2 decision and owner preparation complete; restart qualification pending**.
No restart or live capture was performed for this document. W11 block 3 remains
behind recovery qualification and its separate event-admission contract.

## Evidence boundary

This decision inspects source `3d49ca6faf1c5bbf0709ee4f438fec4bc3f68b34`
and [completion baseline Q2](completion-baseline.md#q2--windows-etw).
Ordinary Windows x64 packages already include explicit user-controlled ETW capture
([helper guide](../../sidecar/etw-file/README.md)). Older disabled-package wording
in historical recovery documents and #974 describes those earlier packages.
Current observations enter only the bounded read view via
[`etw-file-runtime.js`](../../src/main/platform/etw-file-runtime.js) and
[`etw-file-attribution.js`](../../src/main/platform/etw-file-attribution.js).
Candidate paths do not establish object identity or scored FileEvents.

[#986's receipt](../recon/evidence/agent-idle-first-read.json) binds runtime
`5249c10a8c81f9bf0f22a886826f84fc6cf035f2`, package manifest
`ee9149007a81609b5eca1cd30670b1bdb97b785a475a085d87afb2cdc1e1dc52`
and native DLL `c51e6c0f9163fceba433da828dce6b1493a2c9ef0060284dd5acf8c63258cf66`.
Its three first reads after 65/70/85 seconds qualify the retained-interval renewal
fix on one host. The selected native and ETW runtime inputs are unchanged at this
source; broader main/pipeline inputs have changed. Preserve #985's historical
failure: four instrumented baseline attempts passed and its unique cause remains
unproven. Adopt W11 block 1's bounded evidence; repeat repair or live qualification
only for changed relevant inputs or a demonstrated residual defect.

[#974](https://github.com/antropos17/Aegis/pull/974), inspected open/draft at
`0c7a6e8a939b79c1b57ef24c8c7b5d102038dd61`, has a
[pinned preflight receipt](https://github.com/antropos17/Aegis/blob/0c7a6e8a939b79c1b57ef24c8c7b5d102038dd61/docs/recon/evidence/etw-packaged-reboot-preflight.json)
and [procedure](https://github.com/antropos17/Aegis/blob/0c7a6e8a939b79c1b57ef24c8c7b5d102038dd61/docs/roadmap/etw-reboot-recovery.md).
Its runtime/package sweep is bound to `3547b5195a695293549f4c35ce4d14744fcca3e1`;
preparation/refusal/cancellation use harness
`212fbe85ae7d12f0aff91ed63cf1aed643d16364`. Those are distinct bindings.
Preparation was cancelled; no actual reboot or reboot defect was reproduced.
The 32-scenario preflight PASS cannot qualify the later ordinary package.

## Recovery admission matrix

| Check | Already verified within its recorded scope | Required remaining evidence and decision |
| --- | --- | --- |
| Durable reservation and conservative ownership | [Durable recovery](etw-durable-recovery.md) records all-six-process loss/relaunch, live-owner refusal, restricted-write denial and independent absence. Current `FileDurableJournal` persists before allowing StartTrace. | Preserve six PID/full-birth exit checks, protected state and scope refusal. No boot timestamp, digest or generic session name may grant cleanup authority. Recheck changed recovery inputs only. |
| Genuine restart boundary | #974 rejects same-boot resume before UAC/new capture; cancellation leaves independent status 4201. | **Required, unqualified:** fresh PREPARED followed by a full Windows Restart and a fresh boot observation later than completed preparation. Relaunch, sleep/wake and the cancelled receipt cannot satisfy this row. |
| Original reservation correlation | #974's private observer hashes the complete canonical protected record; cancellation matched the prepared digest. Current master lacks that added digest observation. | **Required preparation dependency:** adapt/review the observer and harness for current inputs. Resume must bind the prior record digest to the fresh preparation receipt, and bind both phases to unchanged source/package bytes. A generic recovered count could refer to another stale record. |
| Absence independent of recovery | Historical same-boot profiles query absence separately from helper acknowledgements. | **Required, unqualified across restart:** status 4201 before the new main starts, again while recovery is paused before its own StartTrace, and after recovery closure. This separates OS-session disappearance from metadata retirement and prevents a new trace from obscuring the result. Unknown/access-denied observations fail qualification. |
| Post-restart capture and attribution | #974's earlier package observed 160 synchronous and 160 asynchronous reads with actual pending I/O per workload; #986 qualifies idle renewal separately. | **Required, unqualified after restart:** a second fresh capture must observe 160 synchronous and 160 asynchronous synthetic reads, require a positive pending-I/O count and full event-time issuer/birth witnesses, then acknowledge normal stop. Cleanup alone cannot establish restored observation; synchronous success cannot stand in for the pending-I/O path. |
| Complete process/host closure | Historical #974 host accounted for 39 children and zero live children; preparation/cancellation hosts closed. | **Required for the new two-phase run:** observe all six original exits and expected codes, close the preparation host, then account for both resumed cohorts and close their new host. The reviewed #974 contract expects resumed collector exits `[70, 0]`; contradictory/missing exits, EOF alone or unknown cleanup fail. |
| Gap, loss and privacy | Recovery records `observationGap=true`, prior `finalTotals=null`; #986 retains nonzero drop/mapping limits. | **Required in new receipts:** retain the gap, unknown old totals and stage/native/ring loss evidence; new counters describe only the new capture. Exclude contents and diagnostic file-access audit rows. A successful reboot case cannot establish complete delivery. |
| Downstream read admission and process events | The current read view has no audit/baseline/sequence/risk sink; collector selects Kernel-File IDs 10/12/13/14/15. | **Separate W11 blocks 3–4:** reviewed path/object and event-time identity proof, unknown/loss labels and W1 consumer verification remain prerequisites. ETW process start/stop and the 1,000 short-lived-process acceptance remain unqualified. Recovery PASS alone does not admit reads. |

The boot witness uses
[`Win32_OperatingSystem.LastBootUpTime`](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem#properties),
which Microsoft defines as the last OS restart time. Require consistent fresh
observation time; unknown, nonincreasing or inconsistent timestamps fail.
Record either value of `previousSameScope`: a changed logon label is not a required
boot witness. Microsoft guarantees
[LUID uniqueness only until restart](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-allocatelocallyuniqueid).
No forced SID reuse or clock-manipulation qualification is inferred.

## Prepare a current candidate before owner execution

The #974 `tools/development/etw-reboot.mjs` driver and its digest observer changes
are **absent from this source checkout**. Commands below are templates for a later
reviewed candidate containing those files. Do not run them in current master or
reuse #974's old binary. Its public protocol was `etw-file/9`; current main/helper
require `etw-file/10` and issuer preparation. Preparing updated tooling is a
separate implementation task; it does not perform or authorize the owner's restart.

The Windows sensor owner must first prepare an isolated clean revision with the
reviewed driver, complete-record correlation observer and current matching
main/helper. Preserve runtime cleanup authority and ordinary capture behavior.
Record the driver/oracle hashes separately from runtime source, package manifest,
archived main/shared bytes, native EXE/DLL, build receipt and lockfile hashes.
Bind OS build, architecture, Node/Electron/.NET versions and diagnostic marker.
If a marked diagnostic package is needed, explicitly document its differences
from the ordinary package before applying its result to ordinary read admission.
Every phase must use the same clean source and immutable candidate; rehash after
execution. A source, package or harness change starts a new receipt chain.

After adapting #974 to protocol 10, run only affected oracle/native/source-binding
checks and bounded prepare/same-boot-refusal/cancel controls before the final run.
Keep both historical oracle regressions: contradictory child exits must fail;
either observed scope comparison is permitted with the independent boot witness.
A full 32-scenario sweep is warranted only by changed recovery behavior, an
identified regression or the separately reviewed qualification scope. Do not
repeat the accepted #986 repair or unchanged sweeps as a substitute for reboot.

## Owner-only execution after those prerequisites

1. Select the reviewed clean source, immutable candidate and three new absolute
   output directories outside the candidate. Save user work and agree the full
   Windows Restart window. Verify at least 3 GiB free on the system/output drives;
   place TEMP/TMP and caches on the task data drive. Check diagnostic growth before
   each phase. Use only synthetic fixture files and the fixed owned session.
2. From normal PowerShell with Node 24.16.0 or later in the supported 24.x line,
   run the prepared candidate's `prepare` template below and approve its explicit
   UAC request. Require PREPARED: original protected record persisted, ordinary
   write-open denied, all six original objects exited (main 73; broker 0 or 75;
   collector 70; guard 71; fallback 74; custodian 76), session still independently
   present, and host closed with zero live children. Preparation deliberately
   leaves one bounded owned trace/reservation, writes no ETL, and cannot be PASS.
3. The owner performs Windows **Restart** manually and reopens the same source
   and candidate. Run `resume` into a new directory. Before any new UAC/capture,
   require the later-boot witness and pre-main absence. Approve fresh explicit
   consent; never reuse an elevated host across boots. Require exact old-record
   correlation, independent pre-StartTrace absence, recovery closure, fresh real
   synchronous/pending-I/O attribution, acknowledged stop and complete new host
   closure. Retain every failure and the original preparation receipt.
4. If restart is postponed after a fresh preparation, run `cancel` in the original
   boot with explicit consent and a new output directory. Require exact-record
   correlation, independent absence and closure, then record CANCELLED. If cleanup
   is unknown, stop qualification and investigate owned evidence; do not terminate
   by process name/PID or remove the protected record manually. A later reboot
   attempt always needs new preparation.

Templates, available only after the reviewed driver is present:

```powershell
node tools/development/etw-reboot.mjs --phase prepare --source-sha <clean-commit> --candidate <absolute-win-unpacked> --output <new-before-directory>
node tools/development/etw-reboot.mjs --phase resume --source-sha <same-commit> --candidate <same-absolute-win-unpacked> --prepared <before-directory>/receipt.json --output <new-after-directory>
node tools/development/etw-reboot.mjs --phase cancel --source-sha <same-commit> --candidate <same-absolute-win-unpacked> --prepared <before-directory>/receipt.json --output <new-cancel-directory>
```

Publish only a bounded projection after reviewing the complete linked receipts.
Keep raw digests, identities, births, paths and fixture values private. Retain
failed attempts and verification receipts. Cap command output at 2 MiB, private
receipts at 256 KiB and profile inspection at 16 MiB/file and 64 MiB/profile;
review closed disposable diagnostics after seven days. These budgets are required
preconditions for the prepared harness; this document installs no retention job.

A passing run qualifies controlled all-six-process loss, full restart and explicit
relaunch on its measured inputs. Hard power loss, interrupted hive writes,
hibernation/Fast Startup, sleep/wake, package/logon changes with a live session,
protected installation, unattended capture and complete I/O coverage remain
outside that result. No boot logger, service, scheduled task or stored elevation
is part of this procedure. W11 block 2's runtime acceptance remains pending until
the owner supplies the linked restart and post-restart receipts.
