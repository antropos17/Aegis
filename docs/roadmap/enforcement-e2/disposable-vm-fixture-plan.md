# One disposable Windows VM: preparation contract

Status: **cloud lab implemented and Windows 11 boot observed; production boundary
qualification remains incomplete**. The operator authorized disposable cloud
Hyper-V testing on 2026-10-07. The [source-bound cloud evidence](cloud-hyperv-evidence-20261007.md)
records the selected hosted runner, pinned public evaluation image and actual VM
effects. The requirements below still govern unqualified production capabilities;
they do not authorize changes to unrelated hosts or resources. The earlier
[process fixture](guest-channel-fixture.md) remains same-principal.

## Exact inputs required before provisioning

| Input | Required recorded value | Current state |
| --- | --- | --- |
| Disposable host | Explicit operator authorization for its exact host identity and allowed effects; independent identity/build/capability observations | Fresh GitHub Actions windows-2025 runner selected for the authorized lab. Actual PowerShell and native C# lifecycle observations are retained per run; this does not establish local-host support |
| Guest image | Legally usable clean Windows 11 x64 edition/build, source/license, exact file identity/hash/size and offline first-boot readiness | Pinned public Microsoft Windows 11 EnterpriseEval 26300.9457 image, exact SHA256/size and WIM checks; actual offline boot/profile readiness observed. No personal account, key purchase or production activation used |
| Owned volume/root | Exact new private local directory and volume identity; available storage/RAM; baseline/backup location; no reparse/UNC/shared resource | Fresh per-run D: root, disk/RAM preflight, exact VM ID and bounded receipts implemented in the lab. Protected persistent production registration remains unqualified |
| Native owner | Separate trusted host principal, protected registration/inventory and exact allowed VM ID/epoch; OS-authenticated caller contract | Not implemented; renderer, names, GUIDs and HMAC labels cannot issue ownership |
| Guest bootstrap | Pinned trusted bootstrap/runtime manifest, separate agent identity and private Job; protected image/state and initialized observations | Hashed fixed bootstrap and guest Node transferred; separate AegisTask identity and held-process/Job guards implemented. Current actual run evidence and initialization limits are recorded separately; a complete guest runtime closure is not qualified |
| Endpoint | One explicit service GUID, exact non-wildcard VM binding, narrowly scoped registration backup/restore and independently observed peer | Not implemented; current endpoint code only tests address serialization |

Microsoft requires generation 2, at least two virtual processors, at least 4 GB
RAM and 64 GB disk, with Secure Boot and TPM enabled for this Hyper-V guest.
The original design proposed two vCPUs, 6 GiB fixed RAM and one fresh 64 GiB fixed
VHDX. The executed cloud lab uses two vCPUs, 4 GiB RAM and a fresh 64 GiB dynamic
VHDX with explicit host free-space checks. Its receipts record the realized
configuration. No existing VM is upgraded or repurposed. See
[Windows 11 VM requirements](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements).

Use an already permitted, offline-ready image and dummy local guest accounts.
Do not bypass setup/licensing requirements or silently use a personal Microsoft
account. Admission must reject an image that needs unapproved setup/networking.
The first corpus is a sealed tiny project; install no agent, plugin or dependency
from the network in the qualification run.

## Owned resources and storage admission

Before any change, bind an operation record to the authorized host, original
configuration backup, exact root/volume, VM ID and fresh epoch. Track the fixed
disk, VM configuration, guest bootstrap and separately owned endpoint registration.
Preexisting VMs/disks/service keys, WSL resources and global settings are excluded.
Record identity and content before cleanup; a matching name/path is insufficient.

For the proposed fixed disk, require free space of at least **64 GiB + selected
image bytes + 64 MiB receipts + 16 GiB host reserve** on its actual data volume.
Also check the system volume and actual VM/diagnostic output locations. This
formula is an admission rule to implement, not a claim that space has been reserved.
No automatic checkpoints, saved states or image copies beyond the listed inputs.
New logs have an 8 MiB cap; receipts retain a 64 MiB review threshold. Record
before/during/after sizes, and stop starting further cases on uncontrolled growth.
Do not clear system Temp or change service permissions to suppress diagnostics.

Fixed disk size bounds that disk's allocation only. VM metadata, crash dumps,
host services and diagnostics still need separately verified caps/retention.
Preserve unknown/locked artifacts and verification receipts; no recursive deletion
through links, parent disks, existing images or the task dependencies junction.
Back up any authorized global registration before modification and verify both
the storage effect and service health after restoration.

## Boundary to implement

Start one exact registered VM off, using a pinned image with no host data mapping.
Independently observe its full realized device/service/storage configuration.
Disconnect its external network for this offline stage, and inventory all other
host/guest integration routes. Enhanced-session clipboard/drive/printer forwarding,
pass-through devices and file-copy interfaces require explicit absence checks
and a deliberate dummy-exposure positive control on this disposable host.
Changing only this VM's approved settings must preserve machine-wide defaults.
Integration services are an additional host surface described by
[Microsoft's management contract](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/manage/manage-hyper-v-integration-services).

Implement the native lifecycle adapter behind the existing `vm-session.mjs`
mutation/observation fences and fsync journal. Track actual asynchronous Hyper-V
jobs until settlement; no synthetic promise or old off snapshot may establish
closure. Failed observation, unknown jobs, interrupted setup or corrupt recovery
must keep launch unavailable and prevent VM/epoch reuse. Recovery operates only
on resources proven owned in protected registration, never from journal labels.

The host channel must observe the exact connected peer and authorized service
before accepting initialized guest evidence. A separate trusted guest observer
must pin the initialized bootstrap and verify the agent token/Job/runtime closure
before releasing project code. Return state remains untrusted relative to host
effects. Guest agent write authority must exclude bootstrap, runtime and observer
state. Private pipes and the current HMAC protocol are useful contract controls;
they provide no independent OS peer, guest image or host ownership authentication.

Hyper-V socket service registration is a host registry change requiring
administrator rights; prepare its exact diff and backup for the authorized host
before requesting that effect. Use one nonzero service and exact VM endpoint;
refuse special/wildcard/other-VM addresses. Inventory and test foreign services,
since the app's own endpoint is only part of the host surface. See
[Microsoft's socket contract](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/make-integration-service).
No registration or socket connection has occurred in the current batch.

## First native run and independent oracles

1. Create only the newly authorized owned resources, record identities/hashes and
   observe the exact off configuration. Break ownership/configuration/bootstrap
   inputs as negative controls and verify that the task sentinel stays absent.
2. Boot the registered VM, wait for actual backend jobs, authenticate the guest
   peer and independently verify initialized observations. Admit a copied dummy
   corpus with a sealed identity/hash manifest and no shared original directory.
3. Run the same fixed edit/test/Git-diff task with guest-pinned Node/Git. Require
   its unrestricted positive control, valid result and independent host canary
   observations. Never run returned Git hooks/project code in a privileged reader.
4. Exercise every applicable row in the [native matrix](windows-vm-qualification.md),
   including hostile input/results, foreign services, descendants, caller identity,
   ACL/namespace changes, crashes and reboot. Retain failed/unsupported/not-run
   rows; a useful task alone does not establish isolation.
5. Cancel, settle all actual jobs and independently observe the exact VM off and
   owned guest lifetime closed. Retain unknown cleanup and stop further launches.
   Remove only exact confirmed disposable resources after the required review.

The cloud lab resolves the host/image selection for these authorized disposable
runs. Full A1 needs actual native matrix evidence and independent review;
A2 owns real credentials and online agents, A3 owns any original-host export.
