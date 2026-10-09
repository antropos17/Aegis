# Retained enrollment observation: implementation and local evidence

This inactive internal primitive retains an enrollment observation between calls.
The source base is `888d946e0dc880071dc04c08380aaf31e4eb416d`, branch
`codex/retained-enrollment-lease-20261009`. Independent Sol 6.1 review passed the
frozen source and evidence scope. These local results establish the listed controls only.

## Contract and production boundary

[`EnrollmentLease`](../../../sidecar/session/EnrollmentLease.cs) owns duplicated
already-held process and Job handles, an existing
[`CallerRegistration`](../../../sidecar/session/CallerRegistration.cs), and the
actual ancestor, root, record and image objects transferred by
[`EnrollmentInspection.RetainFiles`](../../../sidecar/session/EnrollmentInspection.cs).
Acquisition copies the originally validated canonical record bytes and image
hash. The registration holds its own process and QUERY token handles and binds
PID, birth time, primary TokenId, ModifiedId and token context. Its permitted
ordinary broker profile does not qualify a protected supervisor principal.

`CheckCurrent` rechecks the retained root process generation and Job membership,
bounded Job accounting, file identities, final paths, object kind, reparse state,
security observations, exact record bytes and image hash. It also compares the
OS process image path with the separately pinned image and checks the current
primary token before and after the file observations. Unexpected thread
impersonation or a failed/unknown observation refuses with the fixed reason
`enrollment-lease-unavailable` and permanently revokes the object.

Checking, revocation and disposal share one private lock. There is no rebaseline
or revival operation. Acquisition duplicates the supplied handles; it does not
consume them. Partial acquisition closes already-owned resources. Disposal tries
all owned resources, clears the retained record bytes and is idempotent. An
observed cleanup failure remains a refusal on later disposal. The type is
internal, has a private constructor and is nonserializable.

The ordinary [one-shot inspection](enrollment-inspection.md) still closes its
objects before returning and keeps `ownershipQualified`, `callerQualified` and
`launchAllowed` false. The default lease factory always uses the strict native
path and descriptor implementation. Observation injection exists only under
`ENROLLMENT_LEASE_TEST`; that factory is absent from the compiled production
assembly. [Build inclusion](../../../scripts/build-sidecar.js) adds the primitive
to the session helper without changing
[`Program`](../../../sidecar/session/Program.cs) or
[`Protocol`](../../../sidecar/session/Protocol.cs). Production ProtectedSession
launch/prepare remains unavailable. No IPC, UI, caller-selected wire path/PID/SID,
installer, principal provisioning or permissions change is included.

The existing limits remain: canonical record 1 KiB, enrollment image 4 MiB,
ancestor depth 32 and post-call observation budget two seconds. This budget
checks elapsed time after synchronous native calls; it cannot cancel them. The
test supervisor separately imposes a 12-second fixture timeout and 8 KiB output
cap. Compilation has a 30-second timeout and 8 KiB output cap. The outer log
runner stores at most 8 MiB per command.

## Executed controls

The [fixture](../../../tests/fixtures/session-enrollment-lease/EnrollmentLeaseFixture.cs)
uses actual Windows file, process, primary-token and Job handles. It launches a
fixed disposable [child](../../../tests/fixtures/session-enrollment-lease/EnrollmentLeaseChild.cs)
under the current ordinary local principal in an actual private Job. Independent
existing [native observations](../../../tests/fixtures/session-caller-launcher/LauncherObservation.cs)
check Job/handle flags, process image and process exit. Positive protected
descriptor acceptance is modeled over actual native held file objects; no
protected installation, ACL, account or trusted supervisor was provisioned.

| Control                      | Observation and scope                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First behavioral red         | The original one-shot inspection completed, then a competing native write-open on `enrollment.json` succeeded: `recordWriteRefused=false`. The new retention expectation failed at its assertion, after successful compilation and fixture execution. This is the additional lease requirement; the original inspection intentionally releases its pins.        |
| Retained native pins         | Repeated checks succeed; actual competing record write, record deletion and root rename are refused while the lease lives. A write-open succeeds after disposal. Protected descriptor acceptance is modeled.                                                                                                                                                    |
| Original handles close       | Closing the fixture's original process/thread/Job handles leaves the actual child alive and the duplicated lease usable. Final lease disposal releases the last Job handle; independent waiting observes the existing Job kill-on-close effect.                                                                                                                 |
| Native acquisition refusals  | The default factory rejects the ordinary root with strict descriptors. A real wrong live image and real wrong Job are refused. An injected partial-open refusal closes already-opened native objects and releases record pins.                                                                                                                                  |
| Native invalidation          | Actual child exit, actual child primary-token privilege change and change-then-restore invalidate permanently. Independent token queries observe unchanged TokenId/authentication ID and changed ModifiedId; the fixture's own primary token is unchanged. Actual thread impersonation also invalidates, and reverting impersonation does not revive the lease. |
| Lifetime and serialization   | Explicit revoke, repeated dispose and check-after-dispose refuse permanently. A gated native recheck exercises concurrent check/revoke under one lock. Serialization of the actual live lease raises `SerializationException`.                                                                                                                                  |
| Modeled observation failures | Changed root volume/identity/path/kind/reparse/security, ancestor identity/security, record identity/epoch/revision/status, image identity/bytes and query failure refuse. These are projections over actual native held objects; they are not native filesystem or protected ACL mutations. Restoring a projected observation never revives the lease.         |
| Modeled cleanup uncertainty  | The adapter closes actual native objects and then reports an injected close failure. Subsequent disposal preserves the refusal. This does not inject an actual OS `CloseHandle` failure.                                                                                                                                                                        |
| Disposable source mutant     | A temporary compiled copy removes both current-primary-token fences. The actual token-change control then exits 1 with the fixed fixture refusal, which the test expects. Repository source is never mutated for this control.                                                                                                                                  |

The [Windows x64 suite](../../../tests/main/session-enrollment-lease-windows.test.js)
has 31 cases on the final tested inputs. An earlier 29-case pass is preserved
separately; it predates the added impersonation and source-mutant controls and
does not replace the final run. The final run selects six files, including the
original enrollment, caller, launcher and protected-session entrypoint/protocol
neighbors: **172 tests passed, six files passed, no skipped tests**.

## Commands and preserved receipts

Commands ran in the isolated checkout using the bounded external runner
`X:/tmp/aegis-github-review-20261006/run-check.mjs` and
`C:/Program Files/nodejs/node.exe`. Per-process TEMP/TMP and existing cache paths
are recorded by each receipt. No global environment or cache setting changed.
The native compilation uses the inbox Windows x64 C# compiler with optimization
and warnings treated as errors.

```text
node node_modules/vitest/vitest.mjs run tests/main/session-enrollment-lease-windows.test.js tests/main/session-enrollment-windows.test.js tests/main/session-caller-windows.test.js tests/main/session-caller-launcher-windows.test.js tests/main/protected-session-windows.test.js tests/main/protected-session-protocol.test.js --project main --maxWorkers 1
node scripts/build-sidecar.js
node node_modules/eslint/bin/eslint.js scripts/build-sidecar.js tests/main/session-enrollment-lease-windows.test.js
node node_modules/prettier/bin/prettier.cjs --check scripts/build-sidecar.js tests/main/session-enrollment-lease-windows.test.js
```

| Receipt prefix in `X:/tmp/aegis-github-review-20261006/receipts/`    | Result                                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-10-09T01-49-19-446Z-enrollment-lease-red`                      | Exit 1, one meaningful native record-write assertion failed.                                                                                                                 |
| `2026-10-09T01-55-07-538Z-enrollment-lease-native-controls`          | Exit 0, prior 29-case pass.                                                                                                                                                  |
| `2026-10-09T01-58-43-473Z-enrollment-lease-neighbors-final`          | Exit 0, final 172 tests across six files.                                                                                                                                    |
| `2026-10-09T01-57-10-318Z-enrollment-lease-build`                    | Exit 0, actual sidecar build.                                                                                                                                                |
| `2026-10-09T01-58-43-108Z-enrollment-lease-lint`                     | Exit 0, scoped ESLint.                                                                                                                                                       |
| `2026-10-09T02-01-10-244Z-enrollment-lease-format-check`             | Exit 0, scoped Prettier check.                                                                                                                                               |
| `2026-10-09T02-01-09-887Z-enrollment-lease-production-surface-final` | Exit 0, reflection of the actual compiled production assembly confirms absent test factory, internal default factory and nonserializable type. No execution-policy override. |

The built production `build/sidecar/aegis-session.exe` is 58,368 bytes with SHA-256
`b5a07dc28c413ae08d6e192b22f5b23f73b1390561bd8fc084f6e3b5dbbca657`.
The external review packet is
`X:/tmp/aegis-retained-enrollment-lease-evidence-20261009/FREEZE.json`; it records
exact changed and dependency source hashes, preserved baseline red sources,
native binaries/observations, commands, receipts and logs. The production
reflection script is preserved there too. `git diff --check` and the evidence
document's scoped formatting/local-link checks complete the freeze.

## Limits and remaining acceptance

This is an internal retained observation. It supplies no protected installation,
protected supervisor qualification, authenticated broker admission, full guest
inventory or production lifecycle authority. Job membership/accounting and
image-path agreement do not attest all Job members, mapped image contents,
vendor provenance or runtime dependencies. A future production caller must
establish those separate contracts before any activation.

Read-only sharing pins prevent normal enrollment record replacement while the
lease is live. In-memory revoke provides no durable revocation, rollback
resistance or installer update coordination. Retaining a kill-on-close Job
handle extends that Job's lifetime; releasing the final handle can terminate
its members under the existing kernel policy. File metadata/security checks may
also revoke conservatively; stable repeated use under a provisioned protected
installation has not been demonstrated.

No cloud VM or provisioned protected-principal positive was run for this change.
Native C# controls are compiled subprocess tests and are outside JavaScript
coverage instrumentation. Full repository CI and independent Sol 6.1 review
remain integration requirements. The unchanged package-module warning emitted
by Vitest was preserved in logs.

Disk samples around the native batches recorded X free space from
188,817,010,688 to 188,734,877,696 bytes and C from 13,307,678,720 to
13,275,648,000 bytes. Concurrent work prevents attributing whole-drive deltas to
this task. The final neighbor TEMP tree was 136 files / 347,634 bytes. A shared
Node compile-cache sample was 48,680 files / 283,951,912 bytes; its prior size is
unknown, so task growth is unknown. The runner used that existing X cache.
Disposable task TEMP/preview output has a seven-day or 32 MiB review/pruning
policy within the exact task directories; skip locked files and reparse points.
Frozen evidence and verification receipts are retained. This policy is manual;
automatic pruning and prevention of future growth have not been established.
