# E1 candidate: principal, restricted token and filesystem scope

Status: **design proposed; scoped Astra review pending; native qualification not-run**.
Date: 2026-09-28. Source base: `6dee6f0b6ff43a52e01768b4534398d7dd97543a`.
This refines the A0 direction after the accepted inactive v1 protocol.
It changes no runtime code and keeps full E1/A1 incomplete.

## Decision to qualify

Use one provisioned, dedicated local non-admin principal for one active protected
session on the machine. Derive a primary restricted token from that principal;
its sole restricting SID is the provisioned principal's actual SID. Give that
SID explicit minimum rights only on the independent staged project, scratch,
approved immutable runtime and required owned OS objects. Keep trusted service,
policy, owner inventory, grants and original project outside that SID's access.

This is a candidate to test, not a claim that Windows/Node/Git/Claude already
work under it. A separate account with an ordinary token fails the intended
public-file boundary. A restricting-SID token makes the additional access check
part of the candidate. Microsoft's [restricted-token contract](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)
requires both the normal and restricting-SID checks to allow access. Our design
inference is that an Everyone-only canary without a principal-SID grant should
fail the second check; actual native reads must establish that result.

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
verifies volume, file IDs, owner and protected DACL through handles. Reject null
DACLs, unexpected inheritance, reparse points and replacement before use.

| Role | Principal rights | Trusted ownership and restrictions |
| --- | --- | --- |
| Service binaries, policy, inventory, grants, account secret | None | SYSTEM/service-owned; admin maintenance only; no user-writable executable/DLL search location |
| Original project and outside canaries | None | Never add a principal ACE; imports are bounded independent copies |
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
unchanged. A process connects to the named private desktop before its first code
runs. Its exact station/desktop access masks and same-session handle behavior
must be observed in qualification, not inferred from a string in STARTUPINFO.

Reuse the existing `sidecar/mcpjob/Native.cs` Job/handle-list pattern as source
context. Create the child suspended with an atomic Job-list attribute, no
breakaway, kill-on-last-owner-close and an explicit list of stdio handles only.
Do not inherit supervisor, token, file, registry, service, Job-control or secret
handles. CreateProcessAsUser and handle inheritance have session constraints;
qualify a Session-0 native worker and its noninteractive I/O before integrating
interactive terminals. ConPTY availability under this profile remains unverified.

Before resume, independently query primary token, restricting SIDs, privileges,
Job membership, executable identity, desktop and handle scope. Failure at any
step terminates the still-suspended owned child and records failed or
cleanup-unknown. No fallback launch is permitted. The v1 probe/prepare protocol
stays inactive; future service RPC is a separately versioned contract.

Qualification host networking is disconnected and has no production secrets.
The candidate does not claim network isolation: persistent SID WFP deny and
allowed broker endpoint remain E3, reviewed before any network-enabled agent.
On stop/crash, confirm owned process termination through held handles/Job state;
unknown cleanup retains the lock, principal restrictions and owned resources.
Never recycle a principal, remove a deny or export staged results on an unknown
outcome. Cleanup follows trusted resource inventory, not name-prefix guesses.

## Concrete next implementation and acceptance

After actual scoped design review, implement an offline **qualification harness**
in a separately reviewed change: native token inspection, owned ACL/object setup,
atomic suspended fixed-probe launch and independent file/process oracles. No
production IPC/UI or agent launcher is introduced by that harness. Every changed
native token/ACL/privileged operation needs its own pre-merge review.

Use the [qualification contract](identity-filesystem-qualification.md). The key
result is a four-way comparison: owner control; dedicated ordinary token; actual
restricted token; intentionally broken fixture. Both prevention and useful
runtime work must pass. If required Windows/runtime objects cannot be admitted
without broadening data access, keep preparation unavailable and return a revised
ADR for review. Do not label a design or a denied task as a working session.
