# Native initialized-process bootstrap fixture

Status: **Windows process fixture executed; VM bootstrap/containment unqualified**.
Base: `567c6b00b3dac04970b7ef5284a20a53e764e191`, merge of PR #695 after actual
scoped review `vm-fixture-r1-bf464c1-20260928`. This change needs a separate scoped
review. Protected Session v1 remains inactive and refuses preparation.

This is the next executable E1/E2 foundation step. It addresses initialized-child
observation after the earlier still-suspended loader assumption was rejected.
The fixture runs one fixed trusted executable under the current user's principal.
It creates no VM, guest account, service, registry entry, ACL or network rule.
It supplies no arbitrary executable, project bytes, host path or command to its
child. Full guest lifecycle and useful Node/Git tasks remain outstanding.

## Owner and initialized observation

The fixture compiles the unchanged six `sidecar/mcpjob` dependencies with four
test-only sources. It reuses `Native.Start`: the child enters an unnamed private
kill-on-close Job during `CreateProcess` through `PROC_THREAD_ATTRIBUTE_JOB_LIST`,
with only its three stdio handles inherited. Native creation resumes this fixed
trusted bootstrap after Job setup. No agent or project task runs in this phase.

The supervisor retains the original process and Job handles. Before the binding
handoff and again after authenticated initialized evidence, it checks the held
process is live, its exact Job membership, observed image path, freshly read
100-nanosecond creation time, TokenUser SID and the Job's actual limit flags.
It rejects breakaway flags. The executable remains open with read sharing only
through the run. It never reopens the child by PID or reads a cached birth time.

This pins **one held bootstrap process**. Windows .NET Console can start `conhost`
in the same Job: a local diagnostic observed both members. The initial active
process count is recorded, rather than assuming one. A complete member/module
inventory is unqualified; the fixture's Job fingerprint hashes the child stamp
and limit flags and supplies no external resource ownership authority.

The runtime hash covers the on-disk .NET core assembly only. The parent hashes
its core assembly; the fixed child checks its own core-file hash matches. Neither
step measures loaded pages or independently enumerates the child's runtime
closure. TokenUser equality establishes the same user SID; it does not establish
a restricted token, private desktop, separate guest identity or host isolation.
The same-principal supervisor and observer are not a tamper-resistant boundary
against another process with that principal's authority.

## Bounded anonymous channel

The Node collector supplies a fresh test-only 32-byte key, session/epoch, synthetic
VM GUID and challenge through the supervisor's input pipe. They never enter argv
or a saved receipt. The supervisor supplies a canonical binding and four pins to
the child's inherited anonymous input, and receives a bounded initialized frame.

`BootstrapWire` emits the existing `vm-wire.mjs` canonical v1 format: a four-byte
little-endian length, at most 4096 payload bytes and HMAC-SHA256 over exact evidence.
The native verifier compares the complete expected authenticated payload without
an early byte comparison exit and consumes acceptance once. A C# acceptance is
followed by fresh held-handle observation before the supervisor sends the one-byte
release for a fixed acknowledgement task. Cancellation sends no release.

After the supervisor exits, Node independently verifies each accepted C# frame
with the unchanged JS verifier and confirms replay is rejected. This is actual
binary interoperability over redirected pipes. It is not a host/guest connection
or OS peer authentication. HMAC establishes possession of the supplied fixture
key; host key distribution and malicious guest evidence remain unqualified.

Frame reads have one shared header/payload deadline. Binding reads use one second,
initialized reads two seconds, and the acknowledgement one second. Compilation
has a 30-second bound; each supervisor run has a 10-second bound, a further
three-second termination confirmation bound, 16 KiB stdout and 1 KiB stderr caps.
Owned byte-buffer key copies are cleared; transient JSON/.NET strings are not a
claim of complete memory erasure. These are generated disposable test credentials.

The collector preserves its input pipe until supervisor exit because the reused
Job helper treats a closed control input as revocation. It forwards only
SystemRoot and scratch TEMP/TMP to this trusted fixture, and the supervisor forwards
only SystemRoot to its child. Diagnostics contain fixed stage codes. Source,
compiler and executable hashes are measured before/after the run; these disk
hashes are provenance records, not a hostile-tampering or full toolchain guarantee.

## Failure matrix and closure

| Case | Required observation | Release | Closure oracle |
| --- | --- | --- | --- |
| admit | Initialized frame plus fresh held-child identity | One fixed acknowledgement | Held child signaled and Job accounting empty |
| cancel | Valid initialized frame, then cancellation | None | Held child signaled and Job accounting empty |
| close-job | Valid initialized frame, then last owned Job handle closed | None | Held child signaled; Job-empty status unavailable after closure |
| bad-mac / cross-epoch | `frame-authentication` | None | Held child signaled and Job accounting empty |
| oversized | `frame-size` | None | Held child signaled and Job accounting empty |
| replay | `frame-consumed` after first acceptance | None | Held child signaled and Job accounting empty |
| observer-loss | Injected `observer-unavailable` after native re-observation | None | Held child signaled and Job accounting empty |
| timeout | `frame-timeout` while fixed child delays its frame | None | Held child signaled and Job accounting empty |

Each refusal must match its intended fault. Unexpected worker exit, EOF, loader
failure, failed API or a mismatched fault is unavailable and fails collection.
The positive admit control uses the same compiled image. `close-job` never counts
a held-child exit as an independently queried empty Job. Actual owner crash,
descendant module inventory, reboot and persistent recovery are still not-run.

## Exact endpoint codec

`HvEndpoint` serializes the 36-byte Windows `SOCKADDR_HV` layout and checks an
independent expected byte vector. It rejects wrong size/family/reserved bytes,
another VM/service, zero service and all documented special VM routing GUIDs.
It performs no socket creation, bind, connect, listen, accept or host registry
registration. This codec supplies no connected-peer or service-authorization
evidence. A real host/guest channel is explicitly not-run.

## Use and remaining gate

```text
node scripts/qualification/qualify-native-bootstrap.mjs --receipt <new-absolute-json-path>
node scripts/qualification/qualify-native-bootstrap.mjs --receipt <new-absolute-json-path> --mode admit
```

Use data-drive process TEMP/TMP settings. A receipt path must be new and absolute;
unknown selectors/commands and duplicate options are refused before compilation.
The default runs all nine fixed cases. Scratch cleanup deletes only the eleven
known closed files in its validated exact directory, without recursive traversal.
Unexpected/locked/reparse output causes failure and is retained for diagnosis.
The saved receipt excludes keys, challenges, bindings and raw frames. It always
states `vmEffectsRun=false`, `launchAllowed=false`,
`nativeContainmentQualified=false` and `completeJobMemberInventory=false`.

The [evidence](native-bootstrap-evidence.md) separates executed process fixtures
from the still-required [native VM matrix](windows-vm-qualification.md). Before
real VM effects, prepare the concrete privileged lifecycle and guest transport,
review their scope, and obtain authorization for the exact disposable host/image.
Protected host inventory, independent guest image/device/service observations,
separate identity, filesystem/network control, real credentials and export are
outstanding. Full E1/A1/E2 task completion remains unchanged.

## Primary API references

[Process attribute contracts](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
document Job/handle lists. [Job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
and [Job information](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject)
define lifetime and accounting queries. These do not imply file/network isolation.
[Hyper-V socket contracts](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/make-integration-service)
define address layout, special routing GUIDs and registration requirements;
this fixture implements only the address codec.
