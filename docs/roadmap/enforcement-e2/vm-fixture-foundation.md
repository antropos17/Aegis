# Windows VM fixture foundation

Status: **executable developer tooling; native VM mutation/containment not-run**.
Base: `b21eaa94f78ba3c84024bd2f13b159862bad9488`, merge of PR #694.
The actual review `filesystem-boundary-4057479-20260928` accepted the preceding
diagnostic and Windows guest qualification direction at HEAD `4057479`. It did
not accept a VM implementation or full E1/A1/E2. This new code needs its own
review. Protected Session v1 stays inactive and refuses preparation.

## Executable pieces

`scripts/qualification/qualify-vm-inspection.mjs` compiles the fixed test-only
C# probe with the inbox Windows x64 compiler. It reads WMI and RtlGetVersion:
host hypervisor presence, management-provider accessibility and optionally one
canonical VM GUID. It never invokes a WMI method or changes a VM/service/feature.
No names, host resource paths, SIDs, raw exceptions or guest content are emitted.
Compilation/run have 30/10-second bounds and 16 KiB output bounds; the collector
hashes source/compiler/executable and removes only its own two scratch files.

```text
node scripts/qualification/qualify-vm-inspection.mjs --receipt <new-absolute-json-path>
node scripts/qualification/qualify-vm-inspection.mjs --receipt <new-absolute-json-path> --vm-id <canonical-lowercase-guid>
node scripts/qualification/qualify-vm-lifecycle.mjs --receipt <new-absolute-json-path>
```

Use data-drive TEMP/TMP/cache settings. Receipt paths must be new; unknown options,
relative paths and existing receipts are refused. The optional VM query returns
missing/denied/unavailable separately. An observed subset includes enabled state,
generation, Secure Boot and synthetic NIC count. Its digest covers only generation,
Secure Boot and NIC count. It excludes disk identity, image content, integration
services, foreign sockets, clipboard/device sharing and ownership. This digest
must never be passed off as a complete configuration/admission measurement.

The lifecycle CLI creates **no VM or child process**. It executes one fixed
in-memory backend with the real bounded fsync journal, then verifies the journal
and removes its scratch file. Its receipt contains synthetic states, one fixture
release, source hashes and seven journal records. `effectsRun=false`,
`launchAllowed=false` and `nativeContainmentQualified=false` remain explicit.
The synthetic image/runtime/principal/Job hashes are labels, not native evidence.

## Admission and cancellation contract

`vm-wire.mjs` uses one length-prefixed canonical JSON frame, at most 4096 payload
bytes, with HMAC-SHA256 and constant-time MAC comparison. The host context pins
session/VM/epoch, one fresh 32-byte challenge, sequence 1, initialized phase and
four hashes. Replays, cross-session evidence, altered pins, unknown fields,
duplicate/noncanonical JSON and bad framing fail. Successful acceptance consumes
the challenge; cancellation clears the copied key. No key/challenge enters the
journal, receipt or command line.

HMAC proves possession of the supplied key only. The guest's claimed observations
are not independent host observations. Trusted guest bootstrap, OS caller/held
process authentication, protected inventory/key distribution, Hyper-V socket
registration/transport and service endpoint mediation are **not implemented**.
GUIDs, epochs, digests and the synthetic backend label provide no host authority.

`vm-session.mjs` accepts only developer-supplied synthetic callbacks; there is no
native mutation adapter. Admission checks the separately registered exact VM/epoch,
off state, pinned synthetic configuration and absence of reported pending jobs;
it journals start intent, starts the simulated machine, checks running state,
verifies the challenge-bound initialized frame and rechecks observation. Release
rechecks state/configuration and journals intent before one fixed callback. No
arbitrary command, project content or host path is sent to that callback.

Stop immediately invalidates admission and signals cancellation. Every mutating
callback remains tracked until its underlying promise settles, even after a
timeout. Stop needs an exact off observation, zero local outstanding mutations
and zero independently reported backend jobs. A late start/release or observer
loss leaves cleanup unknown. A subsequent stop can confirm closure after that
work settles. No automatic retry of launch, resume or identifier reuse exists.
Native backends must observe actual asynchronous Hyper-V jobs; these synthetic
promise tests establish no native job cancellation or race-free VM admission.

## Persistence and remaining native work

`vm-journal.mjs` exclusively creates a task-owned file, writes complete canonical
hash-chained records and fsyncs before returning. It caps growth at 128 records
and 64 KiB. Short writes are completed; write/sync/capacity failure is sticky.
Launch mutations require a successful prior journal intent. Emergency cleanup is
still attempted after journal failure, but stopped status stays unconfirmed when
the journal cannot record it. Recovery verifies bounded bytes, chain and separate
registration and always returns cleanup-unknown / launchAllowed=false.

The chain detects damage, not malicious rewriting. It is not a protected host
inventory and does not guarantee power-loss durability of the parent directory.
Recovery never infers VM ownership or resumes execution from journal contents.
Retain the actual receipt; scratch journals are disposable diagnostic artifacts.

Remaining work includes exact authorized disposable host/image, protected host
supervisor/inventory, real generation-2 VM/image lifecycle, trusted guest bootstrap
and channel, independent device/service/image/process observations and the entire
[native qualification matrix](windows-vm-qualification.md). No host configuration,
VM image, WSL, existing VM, online agent, original project or real credential is
modified by this foundation. Full E1/A1/E2 remain incomplete.

## Sources for the read-only subset

The [Msvm_ComputerSystem contract](https://learn.microsoft.com/en-us/windows/win32/hyperv_v2/msvm-computersystem)
defines VM GUID/state and warns about UAC filtering. The
[realized settings contract](https://learn.microsoft.com/en-us/windows/win32/hyperv_v2/msvm-virtualsystemsettingdata)
defines generation subtype, Secure Boot and the distinction from snapshots.
[Synthetic NIC settings](https://learn.microsoft.com/en-us/windows/win32/hyperv_v2/msvm-syntheticethernetportsettingdata)
cover one device class only. These APIs describe observations; no subset implies
complete guest-to-host isolation.
