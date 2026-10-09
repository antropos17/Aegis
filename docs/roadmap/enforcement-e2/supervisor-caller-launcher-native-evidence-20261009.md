# Suspended retained caller launcher increment — 2026-10-09

This increment completes the preserved internal `CallerLauncher` primitive in
`sidecar/session`. The selected checkout is
`X:/tmp/aegis-caller-suspended-launch-20261008`, branch
`codex/caller-suspended-launch-20261008`, with actual HEAD
`455d291441e776a6dfd735ad19abc4fda2f736e2`. These changes are uncommitted working
files at the initial review freeze. The coordinator owns Git and publication.
The existing `node_modules` junction is retained.

The launcher pins the trusted-code-selected executable and its path ancestors
using the unchanged `AppContainerExecutable` implementation, checking the held
file size, hash, path and observed process image. The trusted-code path and
expected hash parameters convey no protected installer or provisioning authority.
The child is created suspended with an atomically supplied private Job and
`bInheritHandles=false`. The Job uses kill-on-close and a fixed active-process
limit of 64. Live held process identity, noninheritable owner handles, owned Job
membership, held-file/process image agreement and actual `CallerRegistration`
construction/current checks must succeed before the single initial suspension
is resumed. There is no assignment-after-execution fallback.

Disposal revokes registration, terminates the Job and requires retained root exit
and queried Job-empty observation. Failure cleanup uses the same bounded stop
and closes all held resources in `finally`; a failed stop throws rather than
certifying closure. Root wait and Job-empty polling each have a two-second budget.
Job handle closure also supplies kernel kill-on-close containment on owner death.
A naturally exited root invalidates registration; its descendant remains in the
retained Job until disposal. No inactive `Program` or production launch flag is
changed. Build inclusion compiles this internal primitive into the session helper.

## Native controls

Eight Windows x64 controls compile and execute actual C# fixture processes under
the current local principal. The observation helper separately imports native
Job, process image, handle information, file identity and wait APIs. A retained
duplicate child process handle survives failed-launch cleanup so root exit is
observed independently of the launcher's disposed handles.

| Control | Observed result |
| --- | --- |
| Positive | Actual selected OS image, no pre-resume marker, successful retained registration/current checks, marker after resume, noninheritable owner handles, private kill-on-close Job membership, write/rename refusal while pinned, idempotent disposal, registration revocation, root and descendant exit, released image pins. |
| Registration refusal | Intentionally invalid session induces actual registration construction refusal after suspended creation; marker absent and independently retained root exited. This is an injected registration control, not a foreign-principal/token-policy observation. |
| Wrong image | Native test seam routes an actual separately compiled second executable. Independent OS image query confirms the injected image differs from selected image; actual production image check refuses it before resume; marker absent and retained root exited. The route is injected, not a filesystem race. |
| Wrong expected hash | Held-file validation refuses before native process creation; marker absent. |
| Natural root exit | Registration becomes invalid, live descendant remains observed before disposal, and both retained process observations report exit after disposal. |
| Owner death | Separate observer retains child and descendant handles, confirms both live, kills launcher owner, then observes owner, root and descendant exit. This exercises actual kernel Job kill-on-close without managed disposal. |
| Inheritance mutant | Disposable native-source mutation sets `bInheritHandles=true`. Actual child matches the outside sentinel's volume/file identity and writes six bytes through that handle. Fixture exits 1 with `outside-sentinel-changed`; unchanged native source denies access and sentinel stays empty. |
| Early execution mutant | Disposable native-source mutation removes `CREATE_SUSPENDED`; the invalid-registration control finds the actual child marker and exits 1 with `refused-child-executed`. |

The outside sentinel is a genuinely inheritable exclusive file handle to a
disposable file outside the marker directory. The child's candidate handle is
compared through queried file volume/index identity before any write is attempted.
An unrelated object with the same numeric handle does not count as sentinel
access. In the final unchanged-source positive observation the candidate file
identity is unavailable, identity match and write are false, and the sentinel
remains empty. The inheritance mutant independently demonstrates the oracle can
detect actual access. Runtime image pins are reopened for write without writing
bytes after cleanup/disposal to detect leaked file pins.

These are native local same-principal observations with explicitly injected
failure routes and actual compiled mutants. No mock reports child exit, Job
membership or outside-file access. They do not qualify a protected principal,
installation authority, foreign account, guest/VM matrix, primary token or
inherited environment/runtime dependency provenance. The creation API inherits
the owner environment and primary token; runtime dependencies are not independently
pinned. No protected installer, accounts, bootstrap, credential delivery or
production launch authority is introduced.

## Verification and retained inputs

All commands ran from the selected checkout through
`X:/tmp/aegis-github-review-20261006/run-check.mjs`, invoked with
`C:/Program Files/nodejs/node.exe`, per-process X: `TEMP/TMP`, disabled Node compile
cache and an 8 MiB diagnostic log cap. Commands below show the runner's child
command; full exact commands and outcomes are retained in its JSON receipts.

| Child command | Result and receipt filename |
| --- | --- |
| `node scripts/build-sidecar.js` before correction | Actual `CS0051` compilation failure from private `ProcessInformation` supplied to internal `Created` constructor; `2026-10-09T01-09-44-178Z-caller-launcher-compile-red.json`. The structure accessibility was corrected. |
| `node scripts/build-sidecar.js` on final native source | Exit 0; `2026-10-09T01-12-54-832Z-caller-launcher-build-final.json`. |
| `node node_modules/vitest/vitest.mjs run tests/main/session-caller-launcher-windows.test.js tests/main/session-caller-windows.test.js tests/main/session-caller-endpoint-windows.test.js tests/main/protected-session-windows.test.js tests/main/protected-session-protocol.test.js --maxWorkers=1` | 102 tests in five files passed; `2026-10-09T01-12-38-985Z-caller-launcher-native-final.json`. |
| `node node_modules/vitest/vitest.mjs run tests/main/session-caller-launcher-windows.test.js --maxWorkers=1` after adding result captures and released-pin observations | Eight tests passed on final fixture/test inputs; `2026-10-09T01-14-43-580Z-caller-launcher-pins-final.json`. Adjacent source/tests are unchanged from the 102-test run. |
| `node node_modules/eslint/bin/eslint.js scripts/build-sidecar.js tests/main/session-caller-launcher-windows.test.js` | Exit 0 on final inputs; `2026-10-09T01-15-35-885Z-caller-launcher-lint-frozen.json`. |

An earlier runner invocation incorrectly supplied a whole shell command as its
executable and returned `ENOENT`; that is preserved as runner setup evidence,
not a code regression. The actual red compilation receipt above is distinct.
Vitest emitted the existing module-type warning for `svelte.config.js`; it did
not affect the result. C# is outside Vitest's JavaScript coverage instrumentation;
these claims depend on the compiled native fixture observations. Repository-wide
CI remains the coordinator's integration gate after ancestry is updated, not a
claim from this local scoped verification.

The external review packet is
`X:/tmp/aegis-caller-suspended-launch-evidence-20261009`. Its manifest records
actual HEAD, frozen source/dependency/test hashes and binary hashes. It retains
the exact fixtures, per-control `observation.json`, markers, mutants, session
binary, selected receipts and bounded logs. The final session binary SHA-256 is
`bb8b55bf1105a90bdb5d085451a4f38baf13bc81ecce62afd982597605220e67`.

Before work, free space was X: 188,905,254,912 bytes and C: 13,382,557,696 bytes;
after the initial scoped checks it was X: 188,900,737,024 and C: 13,354,082,304.
The captured final-fixture directory before the released-pin addition contained
39 files totaling 119,257 bytes. Current packet measurements are recorded in its
manifest. Disposable closed fixture directories and diagnostic logs are eligible
for pruning after seven days or when this task's disposable output exceeds
32 MiB, only within their recorded exact directories, skipping locked files and
reparse points. Verification receipts and the frozen review packet are retained.
This finite retention policy is not an automatic rotation mechanism or a claim
that other machine activity cannot grow storage. System temporary paths and
unrelated caches remain untouched.

This document records worker implementation and observed checks. Independent
Astra review is a separate coordinator step; it does not certify its own changes.
