# Verification and worktree lifecycle

Use this procedure for Windows fixture evidence, release-PR CI diagnosis or a
worktree retention review. The [development workflow](workflow.md) owns the
required merge checks and authorization boundaries.

## Bounded Windows fixtures

The optional [Windows fixture workflow](../../.github/workflows/windows-fixtures.yml)
runs for pull requests matching its source/test/tooling paths and on explicit
dispatch. It uses a hosted Windows runner, read-only repository permissions,
no persisted checkout credentials and a ten-minute job deadline. Only the
compact receipt is uploaded, with seven-day retention. On PR events its source
is GitHub's checked-out merge commit (`github.sha`); record that SHA separately
from the contributor head. This additional context is not a new required branch
protection check. The five required contexts in `ci.yml` remain unchanged.

From a clean, isolated checkout on Windows x64 with Node 24, run:

```powershell
$source = git rev-parse HEAD
npm run dev:windows -- --install --source-sha $source --output X:/task-storage/native-run-1
```

Choose an existing spacious parent and a new output directory. Substitute your
own drive/path; the example is not a machine requirement. The runner rejects
reused output, linked output ancestors, dirty source, mismatched SHA and linked
`node_modules`. `--install` runs locked `npm ci --ignore-scripts`; it needs an
owned checkout because npm replaces its dependencies. Omit it only when that
checkout already has dependencies installed from its lockfile. The command does
not regenerate the lockfile or download Electron.

The executable suite allowlist is `WINDOWS_SUITES` in
[verification-contract.mjs](../../tools/development/verification-contract.mjs).
These tests compile disposable C# fixtures using the Windows framework compiler
and exercise caller identity, retained caller context, sealed import and its main
reader, plus retained GUI process ownership and its shell object-ID regression.
The guard-startup fixture additionally requires the installed .NET 10 SDK. It
links the production startup wait, owner and diagnostic code into a BCL-only
project with explicit fixture peers. It checks peer exit, canceled I/O and failure
reporting without elevation, ETW or a qualification guest; its substituted
authentication/trace boundaries do not establish native capture acceptance.
The broker-startup fixture references the production sidecar assembly and runs
its actual two-peer handshake and private framing. Controlled authentication and
custody callbacks exercise ordering, rejection and cancellation; they do not
authenticate elevated Windows peers or start ETW. Its default-budget case crosses
the former shared eight-second deadline while both connection phases stay valid.
The runner records source HEAD/tree, lock/compiler hashes, Node/platform,
free space, command exits, duration, test totals and a raw-report hash. Source must
remain clean at completion. Assertion results must cover every selected suite;
missing, duplicate, empty, skipped and failed results reject PASS.

Preflight requires 2 GiB free on source and output volumes. Installation has a
240-second deadline and fixtures a 180-second deadline with one Vitest worker.
Each child log stops at 2 MiB; overflow terminates that owned process tree on
Windows. Raw test JSON must be at most 4 MiB. No automatic retries occur. TEMP/TMP,
npm and Electron caches and Node compile cache are redirected into the run root.
The fixture harnesses own their cleanup; junction-refusal cases intentionally
retain links. The receipt reports remaining scratch separately as
`retained-for-review`: fixture PASS does not mean cleanup completed. Do not delete
paths reached through a junction.

The GUI fixtures also retain deliberately uncertain cases under the source
checkout's `out/development`. `retainedSourceEntries` counts newly remaining
entries there separately from run-local scratch; preexisting diagnostics are
excluded. Neither location is automatically removed by the runner.

Preserve `evidence/receipt.json`. Raw logs, raw test JSON, scratch and run-local
caches are private diagnostics: review them after seven days, retain failures
needed for diagnosis, and remove only confirmed disposable closed files in the
exact owned directory. The runner does not implement automatic deletion. Cache
and fixture size are not hard-capped; measure disk growth around long runs and
stop before launching another batch when it is unexplained. Only the compact
receipt is suitable for routine CI upload; inspect it before public sharing.

This lane grants no Electron bridge, installer, VM, authenticated-provider or
product acceptance. `launchAllowed` remains false. Use the existing native
qualification workflow for its explicitly selected additional scope; its inline
runner and historical receipts remain separate.

## Failures and retries

For the actual packaged Electron Start/Query/Stop window lifecycle, use the
[packaged desktop milestone](packaged-desktop-milestone.md). It builds the package
and records native window/profile/Job observations in an interactive Windows
session. Its installation authority remains modeled; the hosted fixture lane
above does not run this desktop probe.

| Observed stage | Next investigation |
| --- | --- |
| preflight | SHA/dirty source, OS/Node/compiler, dependency ownership, disk capacity |
| dependency-setup | Registry/network/install exit and bounded install log |
| fixtures | Native compiler or fixture setup versus executed assertion; preserve the first failure |
| source-drift | Source or lockfile changed during execution; repeat only after freezing inputs |
| cleanup | Retained scratch/owned child termination; inspect links and open handles |
| missing receipt | Interrupted runner or workflow setup; no PASS can be inferred |

The stage is an observation, not a root-cause diagnosis. A product-contract defect
requires the failing assertion and source trace; an unclassified failure stays
unclassified. Record the original receipt, diagnosis, changed input or resource
condition and new run directory before retrying. A passing isolated retry alone
does not establish a fix.

For preload, host IPC, Observatory runtime or window-hardening changes, use a
separate Electron smoke lane: build native helpers and the production renderer,
then run the existing `frontend:test:electron` harness after inspecting its
effects. Its acceptance includes a real host window, actual bridge calls and
subscriptions, hardened web preferences, an owned disposable profile and host
shutdown. The current harness exercises broader UI/settings/export behavior;
this package does not replace it with a smaller automatic smoke or claim it ran.
Keep its evidence separate from fixture PASS. Expensive VM/provider qualification
requires the task's own explicit inputs and acceptance criteria.

## Worktree ownership and retention

`npm run dev:worktrees` prints a read-only JSON inventory. For a pure JSON file,
use `node tools/development/worktrees.mjs > <owned-private-report.json>`.
The inventory includes registered paths, branch/HEAD, dirty state, lock/prune
flags, known retained artifact roots, dependency realpaths and their registered
consumers. It disables optional Git locks and never installs, removes, moves or
archives anything. Inspection failures remain visible.

Supply `--owners <private-json>` to join human-maintained ownership information:

```json
{
  "worktrees": [{
    "path": "X:/task-storage/source",
    "owner": "current task owner",
    "task": "verification lifecycle",
    "observedHead": "full SHA observed when recording this owner",
    "reviewAfter": "2026-10-24",
    "receipts": ["X:/task-storage/evidence/receipt.json"]
  }]
}
```

Owner/task are never inferred from branch names. Refresh stale HEAD metadata.
Primary/dirty/unknown/locked checkouts, attached dependency consumers and retained
artifacts block a simple retention review. `human-review-due` only requests human
inspection; it grants no deletion permission. The report does not measure storage
recursively, detect open processes, discover unregistered directories or prove
receipt contents exist. Keep machine paths and this manifest private. Re-read
Git and consumer state immediately before any separately authorized cleanup.

## Release PR awaiting CI approval

Run `npm run dev:pr-readiness -- --pr <number>` for a read-only diagnosis. It reads
the PR twice, selects the latest associated CI run for its exact head, and exposes
head movement, absent runs, pending runs and `action_required`. It does not
approve workflows, merge PRs, install credentials or establish release readiness.

The repository's release-please workflow uses `GITHUB_TOKEN`. GitHub documents
that pull requests created or updated with this token can produce workflow runs
requiring approval for `opened`, `synchronize` and `reopened`; a user with write
access approves them on the PR page. An approval wait with no jobs is different
from a failing test. [GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).

Review the current release diff and head, approve the displayed CI run when
authorized, and wait for the five required contexts on that head. A subsequent
release-please push requires a fresh check. Do not try repeated reruns, bypass
required checks, weaken repository approval policy or replace the token merely
to suppress the approval step. A separately approved GitHub App installation
token is a possible future automation change; no credential change is included.

## Current-candidate qualification inputs

Before installer/release qualification, record this input manifest in the private
task receipt and validate each value against the selected source/artifact:

| Input | Required evidence |
| --- | --- |
| Candidate source | Immutable full commit and tree SHA, clean checkout; expected package version |
| Candidate artifact | Exact asset name, size, SHA-256 and producing run/source SHA |
| Prior installed version | Immutable baseline tag resolved to commit, artifact name and SHA-256 |
| Signing | Expected public-key fingerprint and verification result; no private key in receipts |
| Host | OS build/architecture, Node/compiler, disposable profile and available space |
| Scenarios | Fresh install, baseline upgrade, launch, retained-data and uninstall outcomes as applicable |
| Decision | Per-scenario pass/fail/not-run, raw evidence hashes, unresolved limits and explicit acceptance owner |

A mutable branch or tag name alone is insufficient. Fail before install if source,
package version, artifact identity or signature does not match. A local source
build does not qualify a different downloaded installer. Release tag creation,
signing secrets and install/uninstall effects retain their authorization boundary.

The existing `release-qualification.yml` pins a historical 0.15 candidate and
0.14 baseline. Its results remain historical; dispatching it does not qualify the
current release PR. Parameterizing that workflow is a separate protected workflow
change, and this input contract does not claim that migration has happened.
