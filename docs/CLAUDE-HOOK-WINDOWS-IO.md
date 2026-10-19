# Private Windows hook IO fixture provider

`createWindowsHookIO` in `src/main/claude-hook-windows-io.js` supplies the four
private callbacks consumed by the [owned hook writer](CLAUDE-HOOK-WRITER.md).
`sidecar/hook-transaction/` is its framework-only .NET stdio host. The only
caller is a development fixture that creates explicit new inert files. There
is no application/main/IPC/UI registration, profile discovery, default target,
installer, policy evaluator, command invocation, hook loading or reference
import. `ownedFixture: true` records the trusted caller's scope; it cannot
authenticate ownership. The caller must own and select the target and storage.
Sensitive policy activation remains owner pending, and `launchAllowed` remains
false. Installation into an inert fixture proves no provider observation,
blocking, enforcement, production readiness or full W6 acceptance.

## Native capabilities and lifetime

The host receives `targetPath` and a new private backup root through its private
input pipe. It keeps an original `TargetLease.Begin` witness alive throughout
review, installation, postwrite readback and removal. Every `readTarget` opens
a fresh lease and calls `CopyBeforeBytes`; captured bytes never stand in for a
current read. Every commit opens another fresh lease. The native commit consumes
that attempt; the separate witness survives it. The witness pins the original
object so its file ID cannot be reused during this session. A fresh read may
observe a replacement identity, allowing the writer to refuse its review; a
commit also requires both the supplied and fresh identities to equal the
original witness.

`compareAndWrite` returns exactly `written` for native `Written`, and `stale`
only for an identity/exact-byte mismatch before mutation or native `Stale`.
Every other native result becomes a fixed private error and closes admission.
The native same-handle guard, metadata behavior, sharing model and limitations
remain those documented in [Windows target IO](CLAUDE-HOOK-WINDOWS-TARGET.md).
This provider adds no rollback or stronger filesystem isolation.

`retainPrivate` and `readPrivate` use `PrivateBackupStore.Retain/Read`. Only the
live helper owns native backup references. A bounded numeric pipe token maps to
an empty frozen JavaScript object through a session-local WeakMap; callers cannot
import a token or recover references after restart. The writer still verifies
its independently retained byte and manifest hashes. Backups use current-user
DPAPI and protected current-user/SYSTEM ACLs. The real persistent quota is eight
records and **2 MiB** of aggregate logical ciphertext per explicit root, with a
288 KiB per-record limit. Partial/orphan records remain counted. No automatic
pruning, adoption, restoration or backup deletion occurs. See
[private backup storage](CLAUDE-HOOK-PRIVATE-BACKUP.md) for its threat boundary.

## Private process and protocol

The adapter requires explicit hash pins for exactly five host load files, the
existing `dotnet.exe`, selected `hostfxr.dll`, and every file in the selected
framework directory. The qualified version is .NET `10.0.10`; runtimeconfig
must select `net10.0`, that exact framework version, disabled roll-forward and
the three generated false configuration properties. Unlisted host/framework
files, unknown hashes, unsupported versions, symbolic-link ancestors or wrong
file kinds are refused. The existing runtime root is used directly; nothing is
downloaded, installed or copied into a runtime distribution. There is no PATH
executable lookup, shell, arbitrary assembly selection or fallback framework.

These are bounded read-only hash observations of owner-trusted build inputs.
They do not atomically authenticate the bytes subsequently loaded by Windows or
.NET. The owner must keep the executable, runtime, load folder and ancestors
stable and trusted through launch and execution. Node's filesystem checks do
not establish the native target library's complete reparse/identity guarantees
for runtime artifacts. Same-user hostile modification, administrator/kernel
access, runtime compromise and unqualified filter drivers remain outside this
fixture's boundary. A hash manifest supplied by an untrusted caller cannot
confer executable trust.

The original `ChildProcess` object owns termination. The host launches no child
or command, and cleanup never looks up or kills a reused PID. Child environment
is a narrow whitelist with .NET diagnostics, multilevel lookup and roll-forward
disabled. Ambient startup hooks, additional deps, stores, profiling, tracing,
dump settings and Node options are not inherited. Target/storage paths,
configuration bytes and manifests travel only inside the pipes, never child
argv, environment or diagnostic messages. Pinned executable and assembly paths
are launch metadata. Before spawning and before each private operation, the
adapter refuses nonempty `execArgv`, an inspector, diagnostic report modes,
relevant diagnostic environment settings, and effective cached `child_process`,
`stream`, `net` or `worker` debug logging. Effective checks matter after
`NODE_DEBUG` was deleted: STREAM logging can otherwise print private pipe chunks
before application handlers receive them.

The protocol has a four-byte little-endian length and strict UTF-8 JSON body.
Each frame is at most 768 KiB. Only one request may be outstanding; IDs increase
from one through at most 128. Fixed operations are `open`, `read`, `retain`,
`backup` and `commit`; each has an exact schema. Duplicate/escaped response keys,
nested/extra fields, noncanonical base64, malformed/truncated/overflow frames,
unexpected IDs, unsolicited output and diagnostics cause terminal refusal.
Native configuration bytes are bounded to 256 KiB and manifests to 16 KiB.
The host has no diagnostic output and returns only a fixed failure frame/exit.

The caller supplies bounded request (100–10,000 ms), session (at most 180,000 ms)
and cleanup (100–5,000 ms) deadlines. Parent admission and response acceptance
use a monotonic clock; late responses are refused even when a blocked JavaScript
turn delayed timer delivery. Parent deadlines are mandatory because synchronous
native filesystem operations can block the host's own clock checks. Session
output is capped at 16 MiB; terminal draining is capped at 1.5 MiB. Timeout,
disconnect, native refusal or uncertain write closes admission permanently,
awaits bounded original-handle termination/stream closure, and never retries or
restores. Exit/stream confirmation that misses the cleanup deadline remains
`unknown`, including after late events; forced drain termination also remains
unknown. All backup artifacts remain for owner review. The provider never
deletes artifacts even after confirmed exit. Buffers are cleared where practical;
managed strings, OS buffers and runtime copies prevent any secure-erasure claim.

## Focused qualification

Build `sidecar/hook-transaction/HookTransaction.csproj` with the installed .NET
10 SDK, an explicit task-owned artifacts directory, `DebugType=None`,
`UseSharedCompilation=false`, MSBuild node reuse disabled, and an empty package
source. The projects use only installed framework references. Put CLI home,
NuGet, TEMP/TMP and bounded diagnostic output on a spacious task-owned drive;
disable ASP.NET certificate generation per process. No native library source or
application entrypoint needs modification.

The development driver
`sidecar/hook-transaction/fixtures/windows-io-fixture.mjs` accepts one explicit
new fixture root and a private owner-prepared asset manifest. It records binary
hashes immediately before/after execution, fixed case labels and a bounded
receipt. It performs the actual writer preview, later exact-ticket confirmation,
DPAPI backup verification, installation of `AEGIS_INERT_FIXTURE_NEVER_EXECUTE`,
fresh removal review/confirmation, and exact original-byte restoration. That
command string is never executed. It also covers unrelated concurrent edits and
targeted removal; fresh reads and stale content; equal-content replaced identity
before and after installation; tampered backup/no target mutation; foreign
references; real record/byte quotas; maximum pipe payloads; an actual host session
deadline; asset refusal; cached-debug subprocess canaries; and malformed raw
host frames. `tests/main/claude-hook-windows-io-wire.test.js` separately models
split/malformed responses, stalled/late operations, disconnects, bounded draining
and unconfirmed exit/streams. Those synthetic transport cases do not establish
an actual disk-write interruption or crash recovery.

Qualification artifacts and mutation receipts belong in a private local packet,
bound to exact source/commands/logs/binary hashes. Ordinary CI does not execute
this .NET fixture. This slice does not repeat or supersede the native libraries'
separate qualification. Failed/closed fixture files and DPAPI backups are
retained deliberately. Review the fixed task-owned diagnostic set within seven
days; preserve immutable evidence and remove only validated closed disposable
files after owner review. This is an explicit retention policy, without a
recurring cleanup mechanism or a promise that unrelated logs cannot grow.
