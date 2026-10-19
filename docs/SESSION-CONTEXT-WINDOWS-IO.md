# Windows explicit stable-file session context

The private development API supplies real Windows IO to the existing
`createSessionContextReader` and the caller's existing synchronous session-context
owner. There is no application caller, discovery, profile enumeration, IPC,
startup integration or UI. `launchAllowed=false` remains unchanged.

This route is for an explicitly selected stable or exported file. It holds a
read handle with `FILE_SHARE_READ` for the complete pass. An existing ordinary
writer can make admission unavailable, and a writer opening during the pass can
be blocked by the read lease. The qualification does not establish compatibility
with active agent transcripts or nonintrusive live collection. A refused writer
is never stopped and no permission, ACL or global policy is changed.

## Owner API and lifecycle

`createWindowsSessionContextReader` in `src/main/session-context-windows-reader.js`
accepts `{adapter, assets, requestMs, sessionMs, cleanupMs}` and returns one
single-use `read(source, file, selection)` operation. The original owner and its
original `parse` function are captured at construction. The wrapper returns the
exact owner's batch, retaining that owner's WeakMap ownership. Promise parsers
are refused. There is no binding or correlation assertion.

The lower private `createWindowsSessionContextIO` exposes exactly
`{pathStyle:'win32', statPath, openRead}` as its `files` object. A handle exposes
`stat()`, `read(targetBuffer, offset, length, position)` and `close()`. Its separate
owner cleanup/status methods are never passed as reader callbacks.

The first path stat lazily starts one helper and retains the original file and
ancestor witnesses. The existing reader performs path stat, open, handle stat,
at most 16 reads of at most 64 KiB, one one-byte EOF probe, handle stat, fresh path
stat, close, and synchronous parse. The total file limit is 512 KiB. All identity
and version comparisons happen before the native lease is released.

An operation failure awaits bounded cleanup of the original child handle before
throwing. A successful close requires the native lease-close acknowledgement,
original helper exit and closure of stdin, stdout and stderr. Failure cleanup
requires original process exit and stream closure, which also releases its native
handles. The parser barrier permits delegation only if the helper never started
or cleanup is confirmed. Unknown cleanup suppresses every result and stays
unknown; later events cannot promote it. An outer `finally` repeats idempotent
cleanup while keeping the result private. There is no numeric-PID cleanup,
adoption, retry or late-result delivery.

## Native proof and read-only grammar

`sidecar/session-context-reader/SessionContextReader.csproj` compile-links the
unchanged `hook-config-target/{Native,TargetPath,TargetLease}.cs` and the framing
only `hook-transaction/Wire.cs`. `ReadLease` uses `Native.Open`, `Native.Inspect`
and fresh `RandomAccess.Read`; it never uses `Native.ReadExact`, the cached
256 KiB target snapshot, target writes, backup or commit APIs. The linked
`TargetLease` public write API exists in the assembly to satisfy unchanged native
source references but is unreachable from the closed host grammar. The host has
only `open`, `stat`, `read`, `close`, exact fields and ordered request IDs. It has
no reflection or generic action dispatch.

The witness includes the volume serial and all 128 bits of `FILE_ID_INFO`, size,
`FILE_BASIC_INFO.LastWriteTime` and `ChangeTime`. Native 100 ns ticks are converted
with checked integer multiplication into decimal nanoseconds since
1601-01-01 UTC. `ctimeNs` means native change time; it does not mean creation time.
No JavaScript floating timestamp conversion is used. Ancestor handles remain held
through the pass; fresh-path proof is compared against the original identity and
version. Unsupported queries, nonlocal drives, non-NTFS volumes, unknown
attributes, hardlinks, reparse points, oversize files and changed proof refuse.

File identity/version proof does not authenticate transcript provenance, process
identity, session ownership, producer clocks or binding. Privileged/kernel
changes and a malicious preinstrumented embedding process remain outside this
trusted local-filesystem/kernel model.

## Assets, privacy and development route

The owner pins a normal framework-dependent .NET apphost bundle containing exactly
`SessionContextReader.exe`, `.dll`, `.deps.json` and `.runtimeconfig.json`. Assets
contain `hostRoot`, `hostFiles` (`{name,sha256}`), `runtimeRoot`, the fixed
`runtimeVersion:'10.0.10'`, complete `runtimeFiles`, and `hostFxrSha256`.
Every fixed bundle/runtime file and the selected installed hostfxr are checked.
The SDK used by the local qualification is .NET 10.0.302. Build reuse and shared
compilation are disabled by the fixture driver; obj, bin, CLI home, NuGet and
TEMP/TMP output are task-owned on the data drive. No installation or runtime copy
is part of this route.

There is no PATH lookup, caller-selected executable/assembly template or fallback.
The child gets a narrow environment with diagnostics disabled. Private target
paths and bytes travel only in bounded frames, never argv, environment, cwd,
logs, error messages or receipts. Owner metadata excludes raw prompt/argument
canaries. Buffer clearing is best effort and does not establish secure erasure.

The guard refuses inspector, effective debug logging, reports, argv flags, cached
CommonJS `--require` modules, and observable startup/trace environment controls
before private input, spawn and each operation. These mutable observables do not
authenticate startup provenance. In particular, an earlier `--import` hook can
delete its environment setting before this module loads. A trusted embedding and
stable trusted asset directories are prerequisites. This is neither an atomic
loader-authentication mechanism nor a sandbox against prior arbitrary code.

For local development, build the new project with the installed .NET 10 SDK,
`UseSharedCompilation=false`, `nodeReuse:false`, an explicit empty restore source
and task-owned output/intermediate directories. `native-fixture/build.mjs` and
`native-fixture/run.mjs` are bounded, machine-local qualification drivers rather
than production installation commands. `qualify.mjs` first proves a real inert
Claude read and file unlock before parse. `controls.mjs` uses only new owned
copies of the existing Claude, Codex and Gemini fixtures. `MetadataFixture.csproj`
is an isolated fixture-only program: it changes native Write/Change metadata and
tests repeated EOF refusal; it is excluded from the production reader project.
The transport and startup controls use disposable children without live profiles.
The copied-source EOF mutation runs only after an immutable source freeze.

The local evidence directory preserves source, unchanged compile-linked inputs,
runtime/SDK/Node pins, build outputs, commands, bounded raw-log hashes and results.
The first native pass is retained separately from subsequent revisions. An early
maximum-size harness assertion expected `available`, although the existing parser
correctly returned `partial` for a padded long line; the failure is retained and
the corrected control compares the actual owner parser baseline. Native fixture
success establishes only the tested local explicit-file boundary. Runtime,
provider, live-writer integration and production acceptance require separate work.

Disposable qualification logs are capped at 2 MiB per command with a five-minute
command bound. Closed scratch outputs may be removed after seven days inside the
exact task-owned directory, preserving source snapshots, receipts, hashes and
required evidence. This is a retention policy, not an automatic rotation service.
