# Qualification contract: E1 identity and strict filesystem candidate

Status: **planned; no account, service, ACL or token-effect experiment executed**.
Source base: `6dee6f0b6ff43a52e01768b4534398d7dd97543a`.
Requires the [candidate design](identity-filesystem-design.md), actual scoped
review and explicit operator/admin provisioning of a disposable Windows host.
This document is not an executable setup instruction or host authorization.

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
| Dedicated principal, ordinary token | Show that an Everyone canary is reachable without the restricting pass |
| Dedicated principal, candidate restricted token | Demonstrate denial outside and useful work inside using actual child operations |
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
| Public canary read | Everyone-readable sibling, with no principal ACE: ordinary principal returns expected digest; restricted direct CLI, shell, child and grandchild cannot | Control cannot read, protected process reads any known bytes, or test only measures wrapper failure |
| Read/write scope | Restricted child edits only staged input and scratch; observer checks originals and outside sentinel | Outside bytes change or inside permitted work cannot complete |
| Delete/rename/ownership | Attempt outside deletion via parent, DACL/owner change and sibling creation; inspect fresh handles after attempts | Any protected outside mutation, trusted root tamper or unaccounted ownership change |
| Link/path adversaries | Owned junction/reparse, hardlink, symlink, ADS, device/UNC path, rename/replacement and ancestor-delete races | Out-of-scope effect or accepted unsupported path; initial imports must reject unsupported indirection |
| Native runtime first | Fixed probe starts under the actual profile, including loader/registry/object dependencies; observer binds digest and token | Startup failure counted as isolation, loader exception hidden, common-group restrictor or broad host ACL used as a repair |
| Useful Node task | Frozen staged tiny JS project, clean env, change a function and run built-in node tests; compare expected diff and source bytes | No real test result, host profile/env read, runtime becomes writable or original changes |
| Useful Git task | Independent staged repository, no hooks/helper/shared administration; status/diff/local commit operate offline | Host hook/helper executes, outside administrative store accessed, broad grants needed without new review |
| Private desktop | Inspect actual station/desktop and attempt default-desktop/clipboard/host-window access from child | Default desktop access or unverified private-desktop claim |
| Handles and host brokers | Canary handle is intentionally inheritable in parent but omitted from explicit child list; child attempts duplication/host pipe/COM task delegation | Canary bytes or privileged effect reaches child, token/Job-control/secret handle inherited, uncovered host-broker route |
| Owner authentication | Unregistered same-owner process, other user, sandbox principal, reused PID and forged fields attempt fixture RPC | Any unauthorized fixture control, caller check trusts supplied metadata, stale handle treated as current ownership |
| Startup/cleanup failure | Inject token, ACL, station, Job, loader and observer failure before resume; crash at each owned-resource step | Child resumes without verified bounds, fallback starts, live/unknown token remains while principal is recycled or restriction removed |

First qualify direct reads using the fixed native probe. Node/Git are additional
usefulness checks, not substitutes for native access checks. Only then assess
the exact supported Claude offline/stub binary and dependencies; no saved host
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

Pass requires every admitted control to work, the native denial matrix to pass,
the in-scope native/Node/Git task to work, and confirmed cleanup. Publish failed,
unsupported and not-run cases separately. E1/A1, real networking, credentials,
export and release remain incomplete after design acceptance alone.
