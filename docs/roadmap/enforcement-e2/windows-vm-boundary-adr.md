# Filesystem boundary ADR: Windows guest qualification

Status: **proposed for combined review; no VM backend implemented or qualified**.
Source base: `8e0f5085acfeb83ad50fc5dbc7424b06d8f0de43`, 2026-09-28.
The original strict host-filesystem requirement remains mandatory. The existing
Protected Session helper still refuses preparation; full E1/A1 are incomplete.

## Decision and measured reason

Select a dedicated Windows 11 x64 Hyper-V guest as the next boundary candidate
to qualify. This is an explicit proposed revision of the earlier host-native
direction. The agent remains a Windows CLI inside a separately provisioned guest.
No Hyper-V feature, VM, image, network, account or host service is created here.
No download, license purchase or change to another VM is authorized by this ADR.

The reusable [native diagnostic](filesystem-qualification-evidence.md) directly
queries an unassigned restricting-user-SID token and tests allocated Everyone,
principal, empty, present-NULL and absent DACLs. It reproduces the missing
discretionary boundary for read-data, write-data and DELETE access bits. These
are in-memory AccessCheck results, without filesystem effects or separate-account
qualification. The single-token profile remains research-only.

AppContainer/LPAC remains a comparison, without new native qualification.
[Microsoft's launch contract](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
describes another DACL-based intersection, including LPAC opt-out of common
package access. It supplies no verified closure of this exact counterexample
in AEGIS. Do not silently promote the existing short AppContainer route into a
long-running strict session. A host minifilter would require a different kernel
driver/signing/provisioning project; no driver is proposed or installed here.

The guest candidate addresses host-data reachability through a separate machine
namespace. Its sufficiency is a hypothesis to qualify, including host integration
and broker routes. Successful boot alone cannot accept the candidate.

## Scope and preserved product requirement

The approved session inputs consist of a trusted guest runtime image and bounded
independent copies of selected project files. Host originals, profiles, credentials,
policy/grants and all other host volumes remain outside the guest namespace.
Attach no host volume, mapped folder, shared .git store, pass-through disk or device.
Never add a share of the original project for convenience.

This ADR does not claim arbitrary per-path isolation within the guest. The runtime
image is a deliberately admitted synthetic session environment; it contains no
production secrets or unrelated projects. The guest agent remains non-admin and
cannot write trusted bootstrap/service files. Guest-side token/ACL controls are
defense in depth, without treating their known NULL-DACL limitation as solved.
Any sensitive state or authority needed to make a host decision stays on the host.

The review must decide whether this explicit scope meets the original staged
project/runtime promise. A reduced product promise is not authorized implicitly.
If strict isolation of other guest data is also required and cannot be established,
keep preparation unavailable and revise the design. No canary or host-integration
exception may be waived to make the matrix pass.

## Trusted roles and lifecycle

The unelevated UI requests a session from the registered host broker. A narrowly
provisioned host supervisor owns one newly created VM and its protected inventory:
VM ID, session epoch, image provenance, owned storage identity and registered owner.
No arbitrary PowerShell, VM selector, image mount or host filesystem RPC is exposed.
Actual caller token and held-process ownership remain required; renderer fields,
matching user SID and a VM name supply no authority.

The guest image contains a pinned trusted bootstrap/service and a dedicated
non-admin agent identity. Use the accepted phased admission principle: verify
host configuration first, start trusted guest code, observe initialized guest
state, then release the fixed fixture. A trusted bootstrap's measurements are
limited to its phase; reports emitted after agent code runs are untrusted.
Node/Git/Claude still need a reviewed pre-project-code admission design.

Host-side VM observations must independently bind the exact VM ID and image to
the owned session. Observe generation, Secure Boot, attached disks/devices,
network adapters and integration configuration. Observation failure, unexpected
configuration or identity replacement prevents admission. Repeat relevant checks
while active; freeze/stop on observation loss and retain uncertainty.

Agent lifetime is owned by the guest helper's verified Job. The host owns VM
lifetime through its management identity, without attaching shared Hyper-V
services or arbitrary vmwp processes to a kill-on-close Job. A host controller
crash may leave the VM running. Persistent inventory and default-closed broker
state must survive it; VM restart does not reuse an old session admission.

Stop confirms both guest work termination and the exact owned VM's stopped state.
Unknown stop retains resources and denies export/credential dispatch. Do not
remove shared services, unrelated VMs, user images or existing network settings.
The working host's Hyper-V/WSL/RDP defaults are never changed to prepare a fixture.

## Host interfaces and input/result transfer

Initial qualification has zero virtual network adapters, no enhanced-session
connection, clipboard, drive/USB/device redirection or guest file-copy convenience
service. Enumerate and qualify every enabled integration route rather than
assuming a disconnected virtual switch is sufficient.
[Enhanced sessions expose host resources](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/enhanced-session-mode),
and [integration services have separate controls](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/manage/manage-hyper-v-integration-services).
Configure only the new owned guest; preserve machine-wide settings and services.

The proposed data channel is one narrow host/guest broker over Hyper-V sockets.
[Microsoft documents VM-ID/service-ID addressing and administrator registration](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/make-integration-service).
Use the exact owned VM and registered session endpoint, no wildcard binding.
Those identifiers route a connection; they do not authenticate a caller or grant
an operation. Exact peer checks, protected registration, bootstrap capability,
token/epoch binding, operation schema, frame limits and replay handling require
native implementation review before any agent is released.

No IP network is needed for this channel. Therefore a zero-adapter observation
does not prove all host communication closed. Existing host Hyper-V services and
guest-to-host delegation are mandatory adversarial cases. If an uncovered route
can read or alter host data, the candidate is blocked. Merely securing AEGIS's
own endpoint cannot establish the entire VM boundary.

Import sends only a sealed, quota-bounded host-selected manifest over the reviewed
channel. Resolve source handles independently, reject reparse/linked/ADS/device
indirection and stale identities, and create a distinct guest copy. No repository
hook, installer or executable runs on the host as part of import. No host API/OAuth
store or saved Pro credential is copied into the image or import bundle.

Results are bounded untrusted bytes from the guest, held on the host as a proposed
change set. They never become host commands, paths, approval, policy or trusted
measurements. The later export gate binds a stopped writer/immutable snapshot and
rechecks destinations/originals. This ADR authorizes no export implementation.
Do not mount an agent-modified VHD to extract results:
[Microsoft warns against mounting unknown VHDs](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/plan/plan-hyper-v-security-in-windows-server).

## Deployment and cost constraints

Qualification requires an explicitly authorized disposable Windows host, a
licensed/pinned Windows guest image, supported virtualization hardware/edition,
space/memory quotas and a recoverable snapshot. Availability is not checked or
assumed in this change. Feature activation, image acquisition, service/endpoint
registration and VM provisioning require exact operator authorization later.

Bound guest disk/checkpoint growth and boot/run duration; store task-owned data
on the spacious drive. Measure CPU/RAM, boot and useful-task time before choosing
this backend for the product. Neither fast startup nor competitive cost is claimed.
The current installed Claude version and claude.ai Pro workflow still require
separate guest compatibility and secret-free broker qualification.

## Acceptance and next implementation

Use the [combined qualification matrix](windows-vm-qualification.md). Both strict
host-effect denial and an actual useful staged Node/Git task must pass, with
unrestricted positive controls and independent host observations. An unsupported
or failed fixture is reported separately; it cannot count as prevention.

The current PR supplies the permanent native baseline probe, guarded report
validation and this proposed VM contract together for one scoped review. No VM
launcher, privileged registration or production caller is included. After the
decision is reviewed, prepare the host/guest fixture code and its full checks as
one implementation batch; obtain exact host authorization before provisioning.
Full containment, online credentials, export and release remain separate gates.
