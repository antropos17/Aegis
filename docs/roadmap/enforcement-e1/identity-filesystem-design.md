# E1 research profile: principal, restricted token and filesystem scope

Status: **strict boundary blocked; revised research scope awaiting review; native qualification not-run**.
Date: 2026-09-28. Source base: `6dee6f0b6ff43a52e01768b4534398d7dd97543a`.
This refines the A0 direction after the accepted inactive v1 protocol.
It changes no runtime code and keeps full E1/A1 incomplete.

## Revised decision and blocking limitation

Retain this profile only as an offline feasibility experiment. It is insufficient
as the strict filesystem boundary required by the master plan. Do not adopt it
for active Protected Session preparation, including if ordinary ACL controls and
useful runtime tasks succeed. The existing helper continues to refuse preparation.

For a separately authorized fixture, use one provisioned, dedicated local
non-admin principal for one active experiment on the machine. Derive a primary
restricted token from that principal;
its sole restricting SID is the provisioned principal's actual SID. Give that
SID explicit minimum rights only on the independent staged project, scratch,
approved immutable runtime and required owned OS objects. Keep trusted service,
policy, owner inventory, grants and original project outside that SID's access.

For a non-null DACL, Microsoft's [restricted-token contract](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)
requires both the normal and restricting-SID checks to allow access. An outside
Everyone-only grant should fail the restricting check. However, a
[NULL DACL bypasses the normal discretionary check](https://learn.microsoft.com/en-us/windows/win32/secauthz/null-dacls-and-empty-dacls).
The actual review `E1-identity-bba16bb-20260928` confirmed this counterexample
using native AccessCheck on in-memory descriptors: ordinary and restricted tokens
both allowed the read-data bit for a present NULL DACL; Everyone-only and empty
DACL controls behaved differently. This establishes a mechanism gap. It is not
a file-effect test under the proposed separate account or a runtime qualification.

Rejecting NULL/absent DACLs on owned objects cannot mediate a later direct open
of an unrelated outside object. Retained traversal privilege also means an
ancestor directory ACL is insufficient to fix that gap. A one-time host ACL scan,
an import-time path check or rewriting unrelated host ACLs is not a solution.
The qualification matrix must include absent/NULL DACLs and changes after setup;
successful access in those cases is a failure of this profile's strict promise.

Before active implementation, return a revised boundary ADR selecting an additional
mechanism that mediates those direct opens and its independent effect tests.
No such mechanism is selected or implemented here. The original strict scope
remains required; any reduced product scope needs separate user authorization.
Windows/Node/Git/Claude usefulness under this profile remains unqualified.

## Trusted roles and registration

The Electron UI remains unelevated. The candidate needs a narrowly provisioned
native supervisor service to obtain and launch a different principal's token.
`CreateProcessAsUserW` may require privileges unavailable to an ordinary owner
process; [Microsoft documents those requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).
Do not replace failure with an unrestricted logon/launch. Service installation,
account creation and logon rights require explicit operator/admin provisioning
on the designated disposable Windows host after scoped review.

Candidate service identity: LocalSystem with its own service SID and an immutable
installed binary. Its entire privileged RPC surface is fixture-oriented at first.
There is no arbitrary executable, path, SID, command, approval or ACL operation.
Any executable selector resolves to a trusted fixture/runtime manifest entry.
The owner broker performs existing policy/binding/grant work outside the sandbox;
renderer data cannot mint authority. Service privileges never enter the child.

The protected inventory records service/version provenance, operator-selected
owner SID and logon session, registered broker process handle, principal SID,
random session epoch, runtime manifest and all owned resource identifiers.
Registration is an explicit trusted operation, not first-client ownership.
It binds a live process handle plus a fresh private bootstrap capability supplied
through a trusted private channel; neither comes from an agent or public CLI.
Other same-owner processes are not automatically registered brokers.

A future local named-pipe transport has a protected DACL, rejects remote clients,
and checks the actual impersonated token against the registered owner/logon
session. [Impersonation failure](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient)
must abort the request, with checked reversion before privileged work. Hold fresh
process/token handles to resolve PID reuse; PID/SID fields are never evidence.
The broker also authenticates the server against provisioned identity and binary
provenance; occupying the pipe name is insufficient. Exact bootstrap transport,
peer checks and process-handle lifetime require their own implementation review.

Assumptions: trusted Windows kernel, administrator and installed service. An
unrestricted compromised host-owner process is outside this boundary. Agent,
repository, descendants, MCP peers, other users and renderer payloads are hostile.
Protocol parsing or a matching owner SID alone never approves a privileged effect.

## Candidate token profile

1. Obtain the dedicated principal's primary token through the provisioned batch
   logon path. Verify actual TokenUser, groups, authentication ID and session ID;
   no administrator, service, interactive-owner or other session identity may be
   substituted. No password reaches agent argv/env/files or receipts. The service
   stores any provisioning secret in SYSTEM-only protected storage.
2. Call `CreateRestrictedToken` with `Flags = 0` and exactly that principal SID
   in the restricting list. Neither `WRITE_RESTRICTED` nor `SANDBOX_INERT` is permitted. The former
   restricts writes only; [the API contract](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
   also describes the privilege flag's exception for SeChangeNotifyPrivilege.
3. Remove every privilege except SeChangeNotifyPrivilege, including any disabled
   backup/restore/debug/impersonate/assign-primary-token/take-ownership privilege.
   Use irreversible removal, check native errors, then query the resulting token.
   [A successful adjustment can still report unassigned privileges](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-adjusttokenprivileges).
   Token inspection is mandatory; a boolean return alone is insufficient.
4. Retain SeChangeNotifyPrivilege only for ancestor traversal. It is not a grant
   to read or list outside data. Qualify public canaries and ancestor enumeration
   independently; any unexpected read/write is a blocker. Privileged group SIDs
   must be absent or deny-only. Inspect the default DACL and actual restricting
   SID list before creating any child; fail on a mismatch.

The restrictor is the dedicated account SID, not Everyone, Authenticated Users,
Users, Restricted Code or the interactive owner's SID. Reusing a principal is
forbidden until all live tokens/processes are accounted for and the previous
grants/resources are retired. Initial qualification uses a fresh principal and
one machine-wide owner lock; concurrent/multiuser operation is unsupported.

## Filesystem and object layout

All mutable fixture data sits on an owned local NTFS volume/root in the disposable
host. Names below are logical roles, not caller-supplied paths. The supervisor
verifies volume, file IDs, owner and protected DACL through handles. Reject absent
or NULL DACLs, unexpected inheritance, reparse points and replacement before use
on owned scope. These checks supply no control over arbitrary outside descriptors.

| Role | Principal rights | Trusted ownership and restrictions |
| --- | --- | --- |
| Service binaries, policy, inventory, grants, account secret | None | SYSTEM/service-owned; admin maintenance only; no user-writable executable/DLL search location |
| Original project and outside canaries | No intended grants; strict denial is not established | Never add a principal ACE; imports are bounded independent copies; NULL/absent DACL access remains a blocking counterexample |
| Session parent | Traverse of the owned branch only | Trusted owner; no principal parent-delete or sibling creation |
| `project`, `scratch`, synthetic `home` | Data read/write/create/delete within scope | Fresh bounded copy; no host profile, secret configs, hooks, shared Git administrative store or credential helpers |
| Runtime payload | Read/execute only | Trusted immutable files with pinned identity/hash; no principal write/delete/ownership/DACL rights |
| Job, private station/desktop, private pipes | Exact required rights per object type | Explicit owned descriptors; no general access to the service or original user's desktop |

Explicit ACE masks must cover the operations needed in each row, without generic
FullControl for the sandbox. Trusted-created roots remain trusted-owned. Account
ownership of files created inside its mutable area cannot become authority over
trusted roots; independently test DACL/owner changes, parent deletion, hardlinks
and reparse races. A path-prefix check is not the filesystem security mechanism.

The restricting token also affects non-file securable objects. DLL loader,
KnownDLL sections, registry, console, pipes and runtime dependencies need exact
qualification. OS dependency access is not satisfied merely by copying node.exe.
Do not solve a loader failure by adding broad host/Windows/profile ACL grants or
adding a common group to the restricting list. Record the exact required object
and rights; a material exception needs renewed scoped design review.

Build a reviewed read-only runtime closure from trusted distribution files and
license obligations, with independent file IDs/hashes and bounded staging. Set
an explicit executable path, cwd and clean Unicode environment. Synthetic HOME,
TEMP/TMP and caches are in scope; no host environment/profile or OAuth store is
inherited. First qualify a fixed harmless native probe, then Node built-in tests,
then a staged Git repository without hooks/helpers. Claude remains a later
offline/stub feasibility target; real Pro credentials remain gated at A2.

## Creation, handles and recovery

Use an explicitly created private noninteractive station and desktop, with
principal-SID rights satisfying both checks; leave the user's default desktop
unchanged. STARTUPINFO.lpDesktop configures the intended station/desktop. Actual
[connection occurs on a relevant USER32/GDI32 call](https://learn.microsoft.com/en-us/windows/win32/winstation/process-connection-to-a-window-station),
with [thread assignment following station connection](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop).
Do not require already-initialized GUI state from the still-suspended child or
report the configured string as observed state. CreateProcessAsUser can return
before DLL initialization succeeds; loader failure belongs to initialization.

Reuse the existing `sidecar/mcpjob/Native.cs` Job/handle-list pattern as source
context. Create the child suspended with an atomic Job-list attribute, no
breakaway, kill-on-last-owner-close and an explicit list of stdio handles only.
Do not inherit supervisor, token, file, registry, service, Job-control or secret
handles. CreateProcessAsUser and handle inheritance have session constraints;
qualify a Session-0 native worker and its noninteractive I/O before integrating
interactive terminals. ConPTY availability under this profile remains unverified.

The first harness launches only a fixed trusted native bootstrap/probe, with
three distinct phases:

1. **Suspended/configured.** Independently query primary token, restricting SIDs,
   privileges, Job membership, executable identity and inherited handle scope.
   Check the owned station/desktop descriptors, explicit lpDesktop selection and
   absence of inherited station/desktop handles. A failure kills the suspended
   child. These are policy and object checks; actual GUI connection is unobserved.
2. **Trusted initialization.** Resume only the hash-pinned trusted probe. Its code,
   imports/DLL search inputs and cwd are immutable trusted runtime inputs; it must
   not load project files, hooks, user profile, agent code or untrusted configuration.
   Make the reviewed harmless GUI call, then query actual station/thread desktop
   via native APIs. The supervisor queries the held initial thread's desktop via
   [GetThreadDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getthreaddesktop)
   and inspects its object information/security. Station measurement uses
   [GetProcessWindowStation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getprocesswindowstation)
   inside the still-trusted probe; this API queries only the calling process.
   Bind measurements to held process/thread handles, session epoch and the owned
   private objects; supplied names alone are insufficient. Cross-session API
   availability and exact object comparison must qualify, with no inferred success.
3. **Fixture admission.** Only after successful initialized-state observation may
   the supervisor release the probe's fixed harmless payload sentinel/file tasks.
   Send a single-use correlated admission through its private inherited stdin pipe;
   bounded framed stdout carries initialized-state measurements. No argv/env secret
   or publicly accessible endpoint supplies admission. Use a 5000 ms monotonic
   deadline from trusted resume to admission, bounded output and process-liveness
   checks. EOF, timeout, wrong correlation/state, loader/observer failure or owner
   loss terminates the owned Job before the sentinel. No release is sent on failure.

This sequence is a proposed fixture contract, not evidence of execution. All
pre-admission executable code, including DLL initialization, must be trusted.
Ordinary stdout from an agent is never a trusted measurement. Native implementation
review must verify the private transport and that no other route reaches the
sentinel. Retest initialized-state failure injection before admitting file tasks.

The fixed probe does not qualify arbitrary Node/Git/Claude startup. A separately
reviewed runtime admission design must identify all code before its release point
and prevent project/agent code from running before required initialization checks.
Launching an agent suspended and checking its desktop after arbitrary code runs
does not meet that requirement. Those runtime cases stay blocked/not-run until
that design exists; a trusted wrapper alone supplies no child-process guarantee.

Failure records failed or cleanup-unknown; no fallback launch is permitted. The
v1 probe/prepare protocol stays inactive. Any future bootstrap/service transport
is a separately reviewed contract and does not add active replies to v1.

Qualification host networking is disconnected and has no production secrets.
The candidate does not claim network isolation: persistent SID WFP deny and
allowed broker endpoint remain E3, reviewed before any network-enabled agent.
On stop/crash, confirm owned process termination through held handles/Job state;
unknown cleanup retains the lock, principal restrictions and owned resources.
Never recycle a principal, remove a deny or export staged results on an unknown
outcome. Cleanup follows trusted resource inventory, not name-prefix guesses.

## Concrete next implementation and acceptance

After actual scoped review of this bounded research scope, implement an offline
**qualification harness** in a separately reviewed change: native token inspection,
owned ACL/object setup, atomic suspended trusted-probe launch, phased admission
and independent file/process oracles. No
production IPC/UI or agent launcher is introduced by that harness. Every changed
native token/ACL/privileged operation needs its own pre-merge review.

Use the [qualification contract](identity-filesystem-qualification.md). The key
result is a four-way comparison: owner control; dedicated ordinary token; actual
restricted token; intentionally broken fixture. Record the known NULL-DACL gap
as an expected strict-boundary failure, separately from broken fixtures and
not-run cases. Research completion may establish reproducibility and runtime
limits; it cannot accept this mechanism as the strict boundary. Both a reviewed
additional boundary and native denial/usefulness evidence are required before
active preparation. Any broadening of runtime access also needs revised review.
Full E1/A1 remain incomplete; no protection guarantee follows from this document.
