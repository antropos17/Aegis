# E0 evidence: 2026-09-28

Runtime source inspected and tested: `52fc21f1de58d78eefcba6ef038b651d08cdb421`.
The isolated branch is `codex/enforcement-e0`. The original checkout is at
`64478536ed8e0faa86e7a60eb543d0683b2a2e9e`, version 0.14.1-alpha, with existing
renderer/configuration changes. It was preserved. Fresh `origin/master` matches
the plan's 0.17.0-alpha reference. The selected worktree was clean before E0.
The final review packet records the documentation commit and its exact diff.

## Environment and provenance

Windows 11 Home, x64, build 26200; Node 24.11.1; npm 11.6.2; Python 3.10.6;
.NET SDK 10.0.302. The native Job fixtures compile the current C# source with
the inbox .NET Framework compiler; they do not use the installed AEGIS binary.
Installed executable file metadata reports AEGIS 0.17.0-alpha / 0.17.0.0.
This is metadata evidence, without a binary/source equivalence or installer audit.
Installed Claude Code is 2.1.263; Codex CLI is 0.157.1 (version inspection only).

`claude auth status --json` exited 0. Only these fields were retained:
`loggedIn=true`, `authMethod=claude.ai`, `apiProvider=firstParty`,
`subscriptionType=pro`. No credential values or account identifiers were retained.
This establishes the current login mode, not protected-session compatibility.

## Evidence matrix

| Component | Inspected implementation | Recorded evidence | Executed now | Remaining boundary |
| --- | --- | --- | --- | --- |
| Exact-action owner | `action-execution.js:58-175`: preparation, current binding, decision and one-use approval precede spawn; runtime 5000 ms | ACTION-EXECUTION.md | 28 owner tests, 20 binding tests, 23 approval tests passed | Selected route only; normal commands keep ordinary OS rights |
| Claude Bash hook | `action-policy-hook.js`, ACTION-POLICY-HOOK.md | Windows 2.1.263 synthetic provider fixture recorded in repository | 27 hook tests; installed 2.1.263 fixture passed eight scenarios | Missing hook still executes; no universal OS boundary |
| Windows Job lifetime | `Native.cs:256-307` assigns Job during suspended creation, then resumes; `Program.cs` verifies termination | Native fixture descriptions in MCP-STDIO-GATEWAY.md | 9 action and 4 confirmation native tests passed; MCP repeat 10/10 | Job covers ordinary members; no file/network isolation |
| Short AppContainer | Dedicated workspace/profile, zero capabilities, bounded imports; 128 MiB executable limit | ACTION-APPCONTAINER.md and native test source | 12 protocol tests passed, using mocks | Native AppContainer effect tests NOT RUN in E0; profile/ACL creation excluded here |
| Durable MCP grants | `mcp-gateway-grants.js:189-232` creates and syncs consumption before dispatch | MCP-DURABLE-GRANTS.md | 20 storage/replay tests passed | Windows mode bits do not establish private ACLs; issuance and sandbox authority remain open |
| HTTPS gateway | `mcp-gateway-tls.js`, MCP-HTTPS-GATEWAY.md: configured IP, CA/name/leaf validation, no redirect retry | Repository disposable TLS tests | NOT RUN | OAuth and third-party interoperability not established |
| Project inventory and UI | Existing A1-D1 roadmap and configured Observatory entry | Existing source/tests, no reexecution claim | `dev:context` and `counts:check` exited 0 | Static maps/configured coverage do not establish behavioral coverage |
| Long Protected Session | Planned E1-E11 | No working-session evidence | NOT RUN / NOT IMPLEMENTED | Identity, strict read/write scope, WFP, broker, credentials, useful task and export require implementation and gates |
| SRT candidate | Pinned native source and TS wrapper inspected | Upstream smoke source only | No SRT build, install or smoke executed | Prospective reference; upstream claims are not local native evidence |

## Executed commands and outcomes

Raw receipts keep exact invocation arguments, timestamps, exit codes and logs in
the local E0 receipt directory. The portable packet replaces only local paths
with named aliases and includes the alias mapping. These are fresh Windows runs.

- Dependency installation: `npm ci --prefix <E0_DEPS> --ignore-scripts --no-audit --no-fund`,
  exit 0, 555 packages; original lockfile unchanged. No install lifecycle scripts
  or Electron download ran. Dependencies/cache/temp live on the data drive.
- First `npm run dev:context`: exit 1 before dependencies existed (missing TypeScript).
  After installation: exit 0, source digest
  `cc69ccd929f2541922ebfa8780f5fc79ad16c5358f9e9bbfd8547a00f0465e61`.
- `npm run counts:check`: exit 0; maintained declarations match this source.
- `node node_modules/vitest/vitest.mjs run` with the nine files below,
  `--maxWorkers 2 --no-file-parallelism --reporter=json --outputFile=<RECEIPTS>/baseline-tests-results.json`:
  exit 1, **152 passed, 1 failed, 1 explicitly skipped** (154 cases).
- `node node_modules/vitest/vitest.mjs run tests/main/mcp-gateway-windows-job.test.js --maxWorkers 1 --no-file-parallelism --reporter=json --outputFile=<RECEIPTS>/mcpjob-repeat-results.json`:
  exit 0, 10 passed, no skips. This does not erase the first failure.
- First installed-Claude fixture invocation: exit 1 at option validation, because
  the assumed Git Bash path did not exist; no provider scenario ran.
- With the discovered Git Bash path:
  `node scripts/verify-claude-hooks.mjs --claude <CLAUDE_EXE> --bash <GIT_BASH> --scratch <E0_TEMP>`:
  exit 0, eight scenarios, 18 local API requests, cleanup true, pass true.

The nine baseline files are `action-execution.test.js`, `execution-approval.test.js`,
`execution-binding.test.js`, `mcp-gateway-grants.test.js`, `action-policy-hook.test.js`,
`action-execution-windows-job.test.js`, `action-confirmation-windows-job.test.js`,
`mcp-gateway-windows-job.test.js`, `action-appcontainer-protocol.test.js`, all under
`tests/main/`. Mocks and native integration are separated in the matrix above.

The skipped case is the non-Windows unsupported-host branch in
`action-execution.test.js:92`; Windows intentionally does not execute it.
The initial failure was an EPERM in fixture teardown at
`mcp-gateway-windows-job.test.js:79`, after the helper-death case, while removing
the owned temporary directory. Assertions were not weakened; code was not changed.
A repeat passed. Treat teardown reliability as unresolved before A1 qualification.

Claude positive controls (baseline/allow) created a disposable sentinel. Deny,
linked-deny and adapter-failure left it absent; the missing-hook control created
it. A local synthetic API supplied the responses, with dummy credentials and an
isolated profile. These effects verify the installed client contract only.
No online model request, real credential transport, system firewall or protected
session was tested. The fixture's lifecycle subagent used synthetic replies.

The full local verification batch, renderer build, whole-repository coverage,
mutation gates, production audit, native AppContainer effects, SRT privileged
tests, reboot/uninstall and real subscription broker tests were not run in this
E0 design pass. Hosted CI for draft PR #691 is separate evidence: its actual
commit, platform and results are captured in the final local review packet.
Applicable required checks must pass before an implementation merge/release.
