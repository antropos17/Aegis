# Windows explicit stable-file session context

The private development API supplies real Windows IO to the existing
`createSessionContextReader` and the caller's existing synchronous session-context
owner. There is no application caller, discovery, profile enumeration, application
IPC bridge, startup integration or UI. `launchAllowed=false` remains unchanged.

This route is for an explicitly selected stable or exported file. It holds a
read handle with `FILE_SHARE_READ` for the complete pass. An existing ordinary
writer can make admission unavailable, and a writer opening during the pass can
be blocked by the read lease. The qualification does not establish compatibility
with active agent transcripts or nonintrusive live collection. A refused writer
is never stopped and no permission, ACL or global policy is changed.

## Owner API and lifecycle

`createWindowsSessionContextReader` in `src/main/session-context-windows-reader.js`
accepts `{adapter, assets, requestMs, sessionMs, cleanupMs}` and returns a
shared single use across `read(source, file, selection)` and
`readTail(source, file, selection)`. `readTail` requires an explicit JSONL selection;
Unsupported sources or lexically refused paths, non-JSONL format and caller-supplied truncation flags
return an unavailable owner batch before starting the helper. Other selection
fields are validated by the owner parser after file IO.
The original owner and its
original `parse` function are captured at construction. The wrapper returns the
exact owner's batch, retaining that owner's WeakMap ownership. Promise parsers
are refused. There is no binding or correlation assertion.

The lower private `createWindowsSessionContextIO` exposes the same exact
`{pathStyle:'win32', statPath, openRead}` shape through separate `files` and
`tailFiles` providers. The first stat fixes the lease mode; provider mixing is
refused. A handle exposes
`stat()`, `read(targetBuffer, offset, length, position)` and `close()`. Its separate
owner cleanup/status methods are never passed as reader callbacks.

The first path stat lazily starts one helper and retains the original file and
ancestor witnesses. The existing reader performs path stat, open, handle stat,
at most 16 positive-length data requests of at most 64 KiB, one one-byte EOF
probe, handle stat, fresh path stat, close, and synchronous parse. The complete
`read` path retains its 512 KiB full-file limit and oversized-file unavailable
result.

The opt-in tail path permits full-file metadata sizes through
`Number.MAX_SAFE_INTEGER`, with a fixed start at `max(0, size - 512 KiB)`. It
returns at most 512 KiB of raw file bytes in total; JSON/base64 framing is separate.
Positions must remain contiguous, and the one-byte EOF request must return zero
bytes at the original full size. There is no caller-selected seek window. Full
identity/version comparisons happen before the native lease is released.

At a truncated head, the generic reader discards the potentially split leading
byte line, even if the fixed suffix begins at a complete row boundary. It keeps
the source incomplete, so even an otherwise strong binding remains at most
`inferred`. Missing Codex/Gemini session headers remain unavailable; this provider
does not reconstruct metadata or change correlation authority.

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
only `open`, `tail`, `stat`, `read`, `close`, exact fields and ordered request IDs.
The first operation selects either legacy `open` or fixed `tail`; both accept only
`{id, op, path}` with `id == 1`. Tail mode applies its fixed suffix start, byte and
call limits again in C#. It has
no reflection or generic action dispatch.

The witness includes the volume serial and all 128 bits of `FILE_ID_INFO`, size,
`FILE_BASIC_INFO.LastWriteTime` and `ChangeTime`. Native 100 ns ticks are converted
with checked integer multiplication into decimal nanoseconds since
1601-01-01 UTC. `ctimeNs` means native change time; it does not mean creation time.
No JavaScript floating timestamp conversion is used. Ancestor handles remain held
through the pass; fresh-path proof is compared against the original identity and
version. Unsupported queries, nonlocal drives, non-NTFS volumes, unknown
attributes, hardlinks, reparse points, sizes above the selected mode limit and
changed proof refuse.

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
is part of this route. The new `tail` opcode requires a freshly built and pinned
helper bundle; an older complete-read-only bundle refuses it.

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

The original complete-read qualification used the installed .NET 10 SDK,
`UseSharedCompilation=false`, `nodeReuse:false`, an explicit empty restore source
and task-owned output/intermediate directories. The fixed-path drivers
`native-fixture/build.mjs`, `run.mjs`, `qualify.mjs` and `controls.mjs` are historical
records; do not rerun them against their retained evidence directories.
`qualify.mjs` proved a real inert
Claude read and file unlock before parse. `controls.mjs` uses only new owned
copies of the existing Claude, Codex and Gemini fixtures. `MetadataFixture.csproj`
is an isolated fixture-only program: it changes native Write/Change metadata and
tests repeated EOF refusal; it is excluded from the production reader project.
The transport and startup controls use disposable children without live profiles.
The historical copied-source EOF mutation ran only after an immutable source freeze.
Use the parameterized tail drivers below for new qualification.

For the bounded-tail extension, `native-fixture/tail-build.mjs` accepts a new
task output directory, an installed runtime root, and `reader` or `fixture`. It
pins SDK 10.0.302, uses an empty restore source, rejects checkout/runtime overlaps
and existing output leaves, and directs its SDK profile/cache output to that
directory. `tail-controls.mjs` exercises the actual host with bounded inert files;
`tail-owner-controls.mjs` exercises the actual JavaScript wrapper and owner,
including original-child closure and write unlock before synchronous parse.
`TailFixture.csproj` separately checks retained Write/Change metadata and repeated
EOF refusal. These are explicit local drivers; the existing automatic native CI
job does not compile this session-context helper.

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
