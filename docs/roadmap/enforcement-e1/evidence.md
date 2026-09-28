# E1 first slice: inactive supervisor protocol

Source base: `c1d0aa6dc74b31e63e9cd8c0687638048e31f3ae` (merged E0 PR #691).
Branch: `codex/enforcement-e1-protocol`. The final scoped review packet records
the committed HEAD, complete diff, source snapshot and hosted CI status.

Architecture A0 PASS remains tied to `535c0e8`; it is not approval of this code.
See [A0 resolution](../enforcement-e0/review-resolution.md) and
[v1 wire contract](../../PROTECTED-SESSION-PROTOCOL.md).

## Implemented and remaining

Implemented: a pure CommonJS/JSDoc codec and separate C# entrypoint; one bounded
canonical request/response; two operations; unavailable/refused result only;
2000 ms input deadline; fixed errors without echoed input; reply correlation;
build integration using the existing compiler; behavioral and native tests.

Not implemented: trusted caller authentication, separate Windows principal,
protected broker storage, private desktop, inherited-handle qualification,
Job/token/ACL/WFP session setup, persistent recovery, real agent lifecycle,
Pro broker, grants/export, or a production caller. The test processes use
ordinary rights. No provisioning or new OS containment was exercised.

E1.1/E1.2 are still partial; the protocol IDs do not establish actual ownership.
No full E1 task or A1 gate is marked complete by this implementation.

## Executed Windows checks

Environment: Windows 11 x64 build 26200; Node 24.11.1; npm 11.6.2.
The C# compiler is the inbox Framework64 v4.0.30319 `csc.exe`, file version
4.8.9221.0; no new compiler dependency or lockfile change.

| Check | Actual result |
| --- | --- |
| Initial stub with new behavioral suite | Exit 1, retained as `e1-protocol-red` receipt |
| New JS protocol and native helper tests | Exit 0; 59/59 pass, no skips (35 JS + 24 native) |
| Six-file Windows regression | Exit 0; 94/94 pass, no skips |
| Final expanded protocol/native suite, including trailing-newline IDs | Exit 0; 63/63 pass, no skips (37 JS + 26 native); implementation unchanged from the regression batch |
| `npm run counts:check` | Exit 0; 68/68 declaration sites agree; new main module included in the index |
| `npm run format:check` | Exit 0 |
| `npm run lint` | Exit 0; 0 errors, 57 existing warnings |
| `npm run typecheck` | Exit 0 for all configured projects; main `checkJs` remains false, so this is not body-level proof of the new JS module |
| `npm run typecheck:svelte` | Exit 0, both scopes 0 errors / 0 warnings |
| `npm run build:renderer` | Exit 0; existing large-chunk warning retained |
| `git diff --check` | Exit 0 |

Test invocation: `node node_modules/vitest/vitest.mjs run` with
`tests/main/protected-session-protocol.test.js`,
`tests/main/protected-session-windows.test.js`,
`tests/main/action-execution-windows-job.test.js`,
`tests/main/action-confirmation-windows-job.test.js`,
`tests/main/mcp-gateway-windows-job.test.js`, and
`tests/main/action-appcontainer-protocol.test.js`,
`--maxWorkers 1 --no-file-parallelism --reporter=json --outputFile=<RECEIPTS>/e1-windows-regression-results.json`.

Together these batches cover 98 distinct cases: 26 new helper + 9 action +
4 confirmation + 10 MCP native tests, plus 37 JS codec and 12 mock protocol cases.
The 12 AppContainer protocol cases use mocks and establish no native ACL
effects. The previous E0 teardown EPERM remains an unresolved A1 reliability
item; this successful run does not identify or repair its cause.

The native no-dispatch test uses an independently observed sentinel: an ordinary
control writes it, then the test removes it and sends an unsupported launch
request to the helper. The helper exits 2, emits no output, and the sentinel is
absent. The deadline test keeps stdin partial/open and observes exit 2 without
closing stdin first. This tests the compiled helper, not a mocked response.

The final compiled development `aegis-session.exe` was 5632 bytes, SHA-256
`1d9db106186052851d1412e57b4152db65e6af8dd64b150a2535512b9e4d5345`.
Compiler SHA-256:
`46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00`.
These identify inspected local artifacts; they do not establish signing,
distribution integrity or equivalence to an installed release.

## Receipt and resource limits

Exact commands/timestamps/exits/results are retained in the task-local receipt
directory. TEMP/TMP and dependency caches use the owned data-drive directory.
Measured during this slice: disposable temp approximately 3.9 MB; receipts
approximately 200 KB; known native diagnostic directory 53 files / 531640320
bytes, unchanged from E0. No global configuration or retention service changed.
Preserve receipts; the inherited 14-day/64 MiB review policy and 256 MiB scratch
budget remain explicit review limits, not a new automatic cleanup guarantee.

Whole-suite coverage, mutation gates and production dependency audit are tied
to the final hosted CI commit in the scoped packet. The full local suite,
native AppContainer effect tests, new privileged provisioning, persistent
network denial and real subscription use were not run for this slice.
