# Qualification contract: E1 bounded identity/filesystem research

Status: **strict boundary blocked; native process/file qualification not-run**.
Source base: `6dee6f0b6ff43a52e01768b4534398d7dd97543a`.
Requires the [research profile](identity-filesystem-design.md), actual scoped
review and explicit operator/admin provisioning of a disposable Windows host.
This document is not an executable setup instruction or host authorization.

The single-token/ACL profile has a known NULL-DACL gap. The actual review ran
in-memory AccessCheck controls only; it did not provision the dedicated account,
change file ACLs or execute a child. The following matrix cannot yield acceptance
of strict filesystem protection, even if every other case works. Keep expected
mechanism failures, broken fixtures, unsupported cases and not-run cases separate.

## Host admission and evidence

Use a clean snapshotted Windows 11 x64 VM/test host with local NTFS fixture
storage, ordinary owner account, no production credentials, and disconnected
network adapters. Establish the exact host and fixture root before provisioning.
Do not infer disposability from a directory name or an environment variable.
Operator records the snapshot/host identity and authorizes that exact target.
No experiment runs on the user's current working host by default.

Pin source/compiler/executable hashes and reviewed contract; record OS build,
runtime versions, corpus manifest, initial DACL/owner/file IDs, account SID,
queried token profile, privileges, Job/process handles, elapsed time and cleanup
status. Redact content/passwords/bootstrap values. Merely comparing wrapper
exits or reading the supervisor's own report cannot establish prevented effects.

Four controls use identical harmless operations:

| Control | Purpose |
| --- | --- |
| Unrestricted fixture owner | Demonstrate known reads/writes and a working Node test independently |
| Dedicated principal, ordinary token | Reach Everyone/NULL-DACL controls; distinguish empty DACL and operation rights |
| Dedicated principal, candidate restricted token | Measure actual child effects, including expected NULL-DACL failures and useful in-scope operations |
| Deliberately broken runtime/fixture | Demonstrate that failed setup or a broken executable is reported as failure, never counted as prevention |

A trusted observer checks canary bytes/existence after each attempt. A fixed
native child opens the target itself and reports only success/error and a digest
of dummy fixture data. The parent does not read on the child's behalf. Process
success plus the expected digest proves a permitted read; a native access error
plus independent unchanged data establishes the corresponding denied operation.
Do not store dummy contents as a habit that would later leak real contents.

## Required staged sequence

| Case | Trigger / independent oracle | Blocking result |
| --- | --- | --- |
| Principal/token identity | Query the launched process token through a held process handle; compare to trusted inventory and exact restrictor/privileges | Wrong user, missing/extra restrictor, reusable privileged token, unexpected enabled group/privilege |
| Everyone-ACE canary read | Outside canary with an allocated non-null DACL and Everyone allow ACE, no principal ACE: ordinary principal returns expected digest; restricted admitted runtimes/descendants cannot | Control cannot read, restricted process reads known bytes, or test only measures wrapper failure |
| Empty DACL control | Explicitly allocated empty outside DACL, distinguished by queried DACL-present flag and non-null pointer; independently test data read/write | Treating an empty DACL as NULL, or counting both controls' denial as a restricting-token effect |
| Present NULL / absent DACL counterexamples | Separate owned outside fixtures for present-NULL and absent DACL, verified through fresh handles; child attempts read, write and delete, observer checks digest/bytes/existence; parent-delete rights controlled separately | Any allowed outside effect fails the strict promise. Expected for this profile; never reported as prevention or waived from acceptance. Operation-specific denial alone does not close the read counterexample |
| Dynamic outside ACL change | After preparation, trusted fixture observer changes an owned outside Everyone/empty descriptor to present-NULL or absent DACL; child reopens and repeats read/write/delete; verify actual descriptor and parent rights | Later outside access fails strict scope; setup-time scan used as a purported fix, or changed ACL not confirmed |
| Read/write scope | Restricted child edits only staged input and scratch; observer checks originals and outside sentinel | Outside bytes change or inside permitted work cannot complete |
| Delete/rename/ownership | Attempt outside deletion via parent, DACL/owner change and sibling creation; inspect fresh handles after attempts | Any protected outside mutation, trusted root tamper or unaccounted ownership change |
| Link/path adversaries | Owned junction/reparse, hardlink, symlink, ADS, device/UNC path, rename/replacement and ancestor-delete races | Out-of-scope effect or accepted unsupported path; initial imports must reject unsupported indirection |
| Suspended policy checks | Query held child's token, Job, image and handle scope; verify owned station/desktop descriptors and configured selection before trusted resume | Wrong policy resumes; configured lpDesktop string presented as actual initialized state |
| Trusted initialization | Fixed immutable probe and trusted DLL/cwd inputs; trigger GUI connection, observe actual private station/desktop through the design's trusted measurements before sentinel admission | Loader fails/child exits, observation unavailable/mismatched, deadline exceeded, project/agent code executes early, or startup failure counted as prevention |
| Payload admission control | Private correlated single-use release after successful observation; observer sees fixed sentinel only after admission; also run successful positive control | Sentinel runs after any failure, admission forged/replayed, or failed positive control counted as secure denial |
| Native runtime first | Admitted fixed probe executes harmless file tasks under queried token, including exact loader/registry/object dependencies; observer binds digest and token | Runtime startup failure counted as isolation, common-group restrictor or broad host ACL used as a repair |
| Useful Node task (blocked pending runtime admission design) | Frozen staged tiny JS project, clean env, change a function and run built-in node tests; qualify reviewed pre-project-code release point first | Missing admission design counted as PASS, no real test result, host profile/env read, runtime writable or original changes |
| Useful Git task (blocked pending runtime admission design) | Independent staged repository, no hooks/helper/shared administration; qualify reviewed pre-project-code release point before offline status/diff/local commit | Host hook/helper executes, outside administrative store accessed, broad grants needed without new review |
| Private desktop effects | After initialized-state admission, fixed child attempts default-desktop/clipboard/host-window access; sentinel/digest observed independently | Default desktop access or configured-only private-desktop claim |
| Handles and host brokers | Canary handle is intentionally inheritable in parent but omitted from explicit child list; child attempts duplication/host pipe/COM task delegation | Canary bytes or privileged effect reaches child, token/Job-control/secret handle inherited, uncovered host-broker route |
| Owner authentication | Unregistered same-owner process, other user, sandbox principal, reused PID and forged fields attempt fixture RPC | Any unauthorized fixture control, caller check trusts supplied metadata, stale handle treated as current ownership |
| Pre-resume failures | Inject token, owned ACL, station setup, Job, image or inherited-handle policy failure while initial thread remains suspended | Trusted probe resumes despite failed configuration, fallback launches or sentinel runs |
| Initialization/admission failures | After trusted resume inject missing/wrong desktop, denied desktop ACL, loader failure, observer error/mismatch, private-channel EOF/replay and 5000 ms timeout; independent sentinel observer must remain unchanged | Untrusted payload/sentinel executes after failed initialization or merely configured state counted as observed |
| Cleanup failures | Crash at every owned-resource phase, including trusted initialization and admission; query held handles/Job | Live/unknown token remains while principal is recycled or restriction removed; cleanup-unknown reported as stopped |

First qualify initialized-state admission and direct reads using the fixed
trusted native probe. Node/Git require their own runtime admission design and
are additional usefulness checks, not substitutes for native access checks.
Only then assess the exact supported Claude offline/stub binary and dependencies; no saved host
profile or Pro token is copied. Shell/descendant checks must use admitted pinned
runtimes; an unavailable shell is unsupported and cannot count as a passed block.

Host broker and object access is broader than filesystem ACLs. An uncovered
route is an explicit blocker to the claimed protected session, even when a
direct file read is denied. Full WFP families/persistence remain the later E3
matrix; disconnected networking here does not prove WFP enforcement.

## Stop and recovery rules

Time-limit each harmless child and bound stdout/stderr; cap the owned fixture
corpus before creation. Inspect free space and diagnostic growth around batches.
Use the task's 256 MiB scratch review budget and 14-day/64 MiB disposable-log
review limits; preserve receipts, journals and retained staged work. These limits
do not claim an automatic retention mechanism.

On failure, stop creating new effects, terminate confirmed owned members and
retain restrictions/lock when termination is unknown. Cleanup reads protected
inventory and validates exact root/volume/file IDs; no recursive cleanup through
reparse points, no unrelated ACL restoration/account deletion and no system Temp
clear. Verify service health and filesystem/security state after recovery; retain
the receipt and diagnose E0's teardown EPERM before A1 resilience acceptance.

Research completion requires reproducible paired controls, faithful reporting of
known mechanism failures and confirmed cleanup. It grants no strict-boundary PASS.
The NULL/absent-DACL and dynamic-change rows remain mandatory blockers; observing
an expected escape completes a research measurement while failing protection.
After a revised boundary ADR selects an additional mechanism, strict acceptance
requires every control to work, every native denial row to pass, the reviewed
in-scope native/Node/Git tasks to work and confirmed cleanup. No matrix subset or
one-time outside-ACL audit replaces that gate. E1/A1, real networking, credentials,
export and release remain incomplete after documentation or research acceptance.
