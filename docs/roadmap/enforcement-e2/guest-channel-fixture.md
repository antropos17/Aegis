# Bidirectional channel and fixed Node/Git process fixture

Status: **developer qualification tool; native guest VM not-run**. Base is
`2e325d0591c4011c9c4e25d7bc0522202fb96be1`, the reviewed PR #696 merge.
The accepted review `native-bootstrap-fa05fd3-20260928` covers its preceding
same-principal bootstrap. This channel change requires its own scoped review.
Protected Session v1 continues to refuse preparation; full A1 is incomplete.

## What executes

`qualify-guest-channel.mjs` snapshots eleven C# sources, compiles a fixed supervisor
with the inbox x64 compiler, and runs nine fixed scenarios. It discovers the host
Node/Git executables, records their file hashes and checks them again after all
cases. The supervisor holds read-only handles without write/delete sharing to
its image and both tool executables during each case. This pins those files,
without establishing complete runtime, DLL, helper or publisher provenance.

The unchanged `Native.Start` assigns a trusted child atomically to its private
Job. The supervisor observes its held child before handoff and again after the
existing authenticated initialized frame. It forwards a byte-exact Node-generated
release/cancel message only after those observations agree. The worker verifies
its own image, core assembly subset, TokenUser and Job presence before returning
initialized evidence. The VM/session/epoch binding is synthetic and supplied by
the collector; no OS caller or VM authority follows from its possession.

After accepting release, the worker creates a tiny disposable project, initializes
and commits a local Git baseline, changes `alpha` to `beta`, runs one fixed Node
built-in test with an explicit TAP reporter, and collects the expected Git diff.
The test script and command arguments are fixed trusted fixture code. A fresh
minimal environment points profile/temp paths at that project; inherited Node
options, Git configuration, hooks, credentials and provider settings are absent.
Git uses an empty template/hooks directory, disabled signing/external diff/textconv
and no allowed network protocol. No arbitrary project, command or tool path can
be selected through the CLI. Host access by these same-user tools is unrestricted.

The local Node collector never runs Git or returned project code to interpret the
result. After native Job-empty and held-child-exit observations, it reads fixed
files, rejects parent/file links and hard links, checks exact known source/test
bytes and Git metadata, and compares authenticated result digests to an independent
known patch. These checks cover this generated corpus only. They are not a safe
import/export path for an adversarial project, nor protection against same-user
filesystem races. No original project or host destination is written.

## Channel contract

`guest-channel-wire.mjs` and `GuestChannelWire.cs` independently implement the same
canonical HMAC-SHA256 payload. It has exactly eleven fields: protocol/version,
session/VM/epoch/challenge, direction, per-direction sequence, operation, bounded
base64 data and MAC. A four-byte little-endian length precedes at most 4096 UTF-8
payload bytes. Result bytes are opaque and capped at 2048; release/cancel/stopped
carry only fixed one-byte controls. Unknown/duplicate/noncanonical fields, invalid
UTF-8/base64, bad MAC, foreign context/direction, skipped or replayed sequence and
an invalid phase permanently invalidate the channel and clear its copied key.

The host sends one release or an early cancel; the guest sends a result only
after release, then a stopped message. The state contract also rejects late
results after a running-phase cancel. This latter transition has JS behavioral
tests; the native worker executes its fixed task synchronously and does not read
an in-flight cancel. Its actual native cancellation control runs before work.
In-flight guest cancellation and VM crash/recovery remain future native tests.

Both implementations clear their copied keys on close/failure. Keys and fresh
binding values pass through inherited private input, never command lines or saved
receipts. HMAC authenticates possession and message order only. In Node, release
encoding records intent before the asynchronous supervisor run; actual execution
is gated by the supervisor's initialized/held-child checks. Wire construction
alone never grants release authority or confirms OS initialization.

A stopped message has no process/VM closure authority. The JS wire snapshot always
keeps `executionClosureConfirmed=false`, even after accepting it. Native completion
separately requires termination, held-child exit and queried zero active processes
in the owning Job. Initial accounting can include `conhost`; complete member and
loaded-module inventory remains unqualified. No callback or synthetic identifier
controls a real VM.

## Bounds and cleanup

Compile time is capped at 30 seconds; the supervisor process at 10 seconds with
three seconds to reap after failure. Reports/stdout are capped at 16 KiB and
stderr at 1 KiB. Worker frame reads have explicit 1–6 second bounds. Each fixed
tool invocation has five seconds plus one second to drain output, capped at 4096
characters per stream. Its outer owning Job provides descendant lifetime control.

Cleanup requires a validated completed native report with an empty Job. It first
inspects the exact owned project tree: only four allowed root entries, no links,
at most 256 files/64 directories, depth eight and 256 KiB total. Any refusal
preserves every leaf; deletion is nonrecursive and does not follow links. An
unconfirmed/failed collection retains its project for diagnosis. The collector
removes only its known compiler inputs/executable and refuses an unexpected root.
This policy bounds one trusted fixture, not hostile concurrent writes to TEMP.

```text
node scripts/qualification/qualify-guest-channel.mjs --receipt <new-absolute-json-path>
node scripts/qualification/qualify-guest-channel.mjs --receipt <new-absolute-json-path> --mode admit
```

Use a data-drive TEMP/TMP and preserve the exclusive, fsynced receipt. Only the
nine enumerated modes are accepted; no VM selector or arbitrary command option
exists. The saved receipt contains digests and explicit scoped observations,
without raw frames, keys, binding values, tool paths, SIDs or project content.

See [executed evidence](guest-channel-evidence.md) and the
[disposable VM preparation plan](disposable-vm-fixture-plan.md). Anonymous pipe
interoperability, same-principal Node/Git and a synthetic VM GUID do not qualify
Hyper-V transport, guest runtime containment, filesystem/network restriction,
private desktop, protected host inventory, real credentials or host export.
