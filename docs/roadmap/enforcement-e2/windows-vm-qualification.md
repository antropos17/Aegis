# Combined filesystem/Windows guest qualification

Status: **actual cloud Windows 11 Node/Git and dummy-API Claude read/edit/test corpus, separate native test witness, fixed owner-requested cancellation and VM/media cleanup passed; full guest containment matrix remains unqualified**.
The [2026-10-07 cloud evidence](cloud-hyperv-evidence-20261007.md) records
source-bound actual lifecycle runs, management-job settlement and the Windows 11
evaluation guest lab, including successful run 37733668154. Read each run's scope
before applying it to the matrix; its fixed corpus does not qualify entire rows.
The [fixture foundation](vm-fixture-foundation.md) adds a read-only host subset
and synthetic admission/stop/recovery tests. Its original scope predates the
cloud native mutation adapter and guest lab; protected production inventory and
launch are still unavailable.
The [native process fixture](native-bootstrap-fixture.md) additionally exercises
initialized held-child observation, anonymous pipes, fixed acknowledgement and
Job teardown on Windows. Its same-principal, core-runtime and address-codec scope
does not qualify any complete guest VM row below. The subsequent
[channel fixture](guest-channel-fixture.md) authenticates release/cancel/result
and runs a fixed dummy Node/Git project inside a same-principal Windows Job.
Its bounded local oracle and successful task do not qualify guest runtimes,
real socket transport, hostile returned-project interpretation or host isolation.
Requires the [scoped direction ADR](windows-vm-boundary-adr.md), reviewed native
fixture code and explicit authorization of the exact disposable Windows host.
This document does not authorize feature/service/VM/image/network changes.
The [one-use VM preparation contract](disposable-vm-fixture-plan.md) makes the
remaining host/image, resource, authority and first-run inputs explicit.

## Current executable baseline

Run the fixed diagnostic on Windows x64 with the inbox compiler:

```text
node scripts/qualification/qualify-filesystem.mjs --receipt <absolute-new-json-path>
```

It compiles a test-only probe in the process TEMP directory, queries an unassigned
restricted token, runs paired in-memory AccessCheck controls and removes its own
executable/scratch directory after exit. It never impersonates, changes host ACLs,
creates an account/profile or launches under the restricted token. Use the task's
data-drive TEMP/TMP settings and preserve the receipt; the CLI refuses overwrite.

A valid completed measurement returns strictBoundaryPassed=false. The diagnostic
validator rejects unknown authority fields, missing/changed controls, weak token
profiles, inconsistent granted rights and a hidden NULL-DACL counterexample.
It is a developer test tool with no production caller or launch authority.

The report covers three access bits on five descriptor kinds, plus a fresh
Everyone → NULL → empty in-memory transition. DELETE access-check semantics do
not establish file deletion through a parent. An absent descriptor in this probe
does not simulate a filesystem's inheritance/default descriptor assignment.
Actual read/write/delete and dynamic file ACL changes remain mandatory VM tests.

## Host admission and evidence

Record the operator-authorized host ID, snapshot, fixture root/volume identity,
OS/hypervisor build, image/runtime/compiler hashes and all owned resources.
Use dummy data, disconnected external networking and no production secrets.
Authorize only new fixture resources; preserve existing VMs, images, WSL and
machine-wide integration defaults. A directory name is not host authorization.

Controls: ordinary host owner with successful canary operations; fixed guest
fixture under the candidate; deliberately exposed disposable mapping/endpoint;
broken image/bootstrap/observer. Each matrix row requires its positive control.
Do not deliberately expose personal directories as a negative security fixture.

The guest attempts the operation itself. Independently check host canary digest,
existence/metadata and VM/process state. A guest's exit or own denial report does
not prove absence of a host effect. Retain failed, unsupported and not-run cases.

## Required native matrix

| Case | Trigger and independent oracle | Blocker |
| --- | --- | --- |
| Exact VM ownership | Replace supplied VM name/ID/epoch, stale owner PID, unrelated owner and unregistered client; query held owner and live Hyper-V inventory | Any unrelated VM operation, renderer-issued authority or stale identity accepted |
| Admission phases | Wrong image/hash, missing trusted bootstrap, failed loader, wrong agent token/Job, unavailable guest/host observer and timeout before release; independently check payload sentinel | Agent/project code runs before required checks, configured state counted as observation or failed control counted as denial |
| Namespace isolation | Outside host canaries with Everyone, principal, empty, present-NULL and actual absent/default-derived DACLs; guest tries read/write/delete through direct calls, pinned shell and descendants | Any host effect or selected case waived; absence cannot be preserved/observed but reported as tested |
| Dynamic host change | Change dummy outside host ACL after preparation; rename/replace parent and canary; repeat guest attempts and host descriptor/digest checks | Later host access succeeds or setup scan mistaken for ongoing enforcement |
| No shared host data | Try mapped drives/folders, enhanced-session clipboard, printers, USB/pass-through, file-copy integration and device/UNC paths; deliberate disposable-exposure control must be reachable | Unexpected shared resource, missing independent inventory or ineffective exposure control |
| Other host services | Enumerate applicable guest communication/integration endpoints; fixed guest attempts foreign Hyper-V service IDs, wildcard/other-VM endpoints, host delegation and malformed frames | Uncovered route can read/mutate host data; zero adapters or own endpoint security counted as complete mediation |
| Input copy | Sealed tiny corpus with file identity/hash; inject source changes, hardlink/reparse/ADS/UNC indirection, secret/profile files and quota exhaustion | Host hook executes, unadmitted bytes enter guest, source copy is shared or a stale manifest is accepted |
| Useful native task | Fixed guest probe performs admitted dummy read/edit/scratch operations after verified admission | Loader/task failure counted as prevention; broadly exposed host runtime used as repair |
| Useful Node/Git | Pinned guest runtimes, admitted tiny project, actual node built-in tests and local Git status/diff/commit without hooks/helpers | No useful result, original host changes, unreviewed early project code, host profile/shared Git accessed |
| Results channel | Oversized, replayed, cross-session, malformed, content-as-command and path-as-authority messages; trusted host receipt binds VM/epoch | Guest bytes grant authority, execute on host, overwrite originals or become independent observation |
| Stop/recovery | Kill UI/broker/guest controller, crash at creation/admission/result steps, reboot fixture host and exhaust owned storage; query exact owned VM and guest Job | Stop unconfirmed reported stopped, unknown cleanup removes restrictions/reuses IDs, unrelated service/VM stopped |
| Runtime budgets | Cap image/checkpoint growth, output queues, boot/run time and guest CPU/RAM; measure actual locations and growth | Unbounded diagnostics/storage or limit failure ignored while new batches start |

No real online agent runs in this matrix. A3 owns host export; A2 owns real
credentials/subscription use. E3 networking needs its revised guest/host/broker
matrix after this decision; disconnected adapters do not qualify networking.

## Completion rule

Research completion may establish measured gaps and whether the guest candidate
is feasible. Strict acceptance requires every applicable denial/control case,
useful native/Node/Git tasks, exact ownership and confirmed cleanup. The entire
host integration surface is in scope; selective green results are insufficient.
Full E1/A1 remain incomplete until their required native evidence is reviewed.
Keep preparation unavailable on a known bypass, unsupported host or missing proof.
