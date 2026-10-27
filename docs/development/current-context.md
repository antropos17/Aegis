# Current development context

This entry point identifies the source and evidence for a task. It intentionally
does not cache a "latest" PR, test total, machine path or active task: those change
independently of this document. The active user's request selects the work.

## Establish the checkout

Before interpreting source, record the working directory, branch, HEAD, dirty
state and intended base revision. These commands only read local Git state:

```sh
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git log -1 --format="%h %s" origin/master
git worktree list
```

`origin/master` is a local remote-tracking reference; fetch it when the task
requires the current remote state. A preserved dirty checkout may be older than
that reference. Keep its changes and select or create an authorized isolated
worktree using the [Git workflow](workflow.md#git-and-pr-cycle). A skill's install
directory, old handoff or another task's worktree does not select the source.

Record the task boundary and dependency owner as well: a shared `node_modules`
junction does not authorize installation or cache writes in its owner's tree.
Keep reports and temporary output in the task's own storage. Do not copy private
handoffs, host paths or acceptance artifacts into public documentation.

## Process policy freshness

At task start or resume, distinguish the source revision from the process-policy
revision. If the checkout predates a known merged workflow correction, read the
current `AGENTS.md` and the relevant workflow/skill sections from the verified
default-branch revision with `git show <revision>:<path>`. Fetch once when current
remote state is needed; do not poll Git merely to refresh instructions. Record
that policy revision in the existing task note or handoff, without creating a
second tracker. If unavailable, preserve the user's latest instructions and
state the limitation.

This updates how the task is conducted, not its source or acceptance evidence.
Resolve commands against the selected checkout's package/workflow files, retain
its runtime contracts, and do not reset another chat's source to refresh rules.
Current user instructions take precedence over historical mutation requirements,
routine approval waits and model/delegation prescriptions.

Before synchronizing installed skills, compare the catalog revision with the
installation receipt and current policy. An older checkout must not downgrade
newer installed instructions. Read the current catalog directly when a safe
installation update is unavailable; preserve local customizations. At handoff,
name any policy/install drift still present. Existing running chats require a
message or explicit reread; editing a file does not prove they reloaded it.

## Read the authority for the decision

| Decision | Source |
| --- | --- |
| Requested result and authorization | Active user request; [AGENTS.md](../../AGENTS.md) for repository boundaries |
| Code conventions and monitoring invariants | [CODING_STANDARDS.md](../../CODING_STANDARDS.md) |
| Entrypoints, commands and dependency versions | [package.json](../../package.json), [Vite config](../../vite.frontend.config.ts), relevant source and TS configs |
| Required verification and Git procedure | [Development workflow](workflow.md); current [CI definition](../../.github/workflows/ci.yml) |
| Approved interface and applicable amendments | [Observatory design](../../frontend/observatory/DESIGN.md) |
| Project skill source and local installation | [Skill catalog](../../tools/agent-skills/README.md) |
| Historical decisions and mistakes | [Memory index](../../memory-bank/README.md); search only the affected subsystem |

## Navigate the implementation

The current Vite configuration selects `frontend/observatory/`; production and
simulated preview share its Svelte application. `runtime/host.ts` owns the host
boundary and `styles.ts` owns stylesheet order. Retained renderer computations
and regression fixtures also live in `src/renderer/lib/`.

Electron starts at `src/main/main.js`; inspect `src/main/preload.js` with the
handler and consumer for IPC changes. Platform operations live in
`src/main/platform/`. Shared contracts and catalog data live in `src/shared/`.
Verify these paths against the selected checkout when working on older revisions.

If present, read `out/development/context.md` only after matching its checkout,
commit and dirty state. Its digest covers selected source/configuration inputs;
it excludes native sidecars, qualification scripts, workflows, Vite config, docs
and skills. For those paths or concurrent edits, inspect the diff and relevant
file hashes. `npm run dev:context` overwrites local reports: regenerate only when
owning those outputs. A read-only review can inspect source directly.

## Interpret completion

For new product work, use [completion plan section 7](../roadmap/completion-plan.md#7-execution-order).
The older `memory-bank/AEGIS-MASTER-PLAN.md` and dated execution waves are history.
Apply the current English working-language rule to briefs and delegated work;
read only task-relevant evidence instead of restarting the broad audit.

Tie check results to the tested revision and inputs. Historical PASS records,
merged component PRs and a green hosted suite do not establish native runtime,
provider, installation or product acceptance. Consult the task's actual evidence
and report missing verification explicitly; this document grants no acceptance.
