# AEGIS

AEGIS is an Electron desktop app that monitors local AI agents, with a Svelte renderer and Vitest tests.

Explicit user instructions take precedence over repository guidance. If a repository instruction blocks requested work, name its file and quote the rule.

## Read for the task

- Starting or resuming work: use [Current development context](docs/development/current-context.md) to identify the checkout, task and evidence.
- Code or documentation changes and reviews: read [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Checkout isolation, source navigation, dependency setup, verification or the PR cycle: read the relevant sections of [Development workflow](docs/development/workflow.md).
- Observatory frontend work: also read [its instructions](frontend/observatory/AGENTS.md); they identify the visual authority and host-integration rules.
- Identity stamping, snapshot-session or sequence-rule changes: read the runtime invariants in [CODING_STANDARDS.md](CODING_STANDARDS.md#runtime-invariants).
- Identity stamping, audit-chain or Windows worktree work: read the relevant history in [memory-bank/ai-mistakes.md](memory-bank/ai-mistakes.md).

## Permissions and boundaries

Local fixture tests and the full git cycle (branch from `origin/master`, commit, push, open a PR and merge) are authorised in advance. Follow the development workflow and wait for all required CI contexts before merging.

Human authorisation is required for cutting a release tag, force pushing, regenerating the lockfile, deleting a remote branch other than the one just merged, or changing anything under `.github/workflows/` or `.codex/config.toml`. An explicit user request for that action supplies the authorisation.

## Delivery and verification

When starting or resuming in a preserved checkout, resolve current process rules
using [policy freshness](docs/development/current-context.md#process-policy-freshness)
before selecting checks or installing skills. Old source stays pinned; obsolete
workflow requirements do not become current authorization.

Choose the next task by the unfinished user-visible milestone in
[the completion plan](docs/roadmap/completion-plan.md#7-execution-order).
Finish existing integration before adding another dormant helper.
Run focused behavioral checks during implementation and use hosted required CI
for the final revision. Reuse passing evidence for unchanged relevant inputs.
Do not run mutation campaigns or deliberately break source to prove tests.
After a failure, record the failed assertion/stage and changed input before a
scoped retry. Observe an authorized in-flight VM; do not start another without
its own task authorization and a concrete diagnostic or acceptance question.
Post-merge CI observation does not block independent work. Preserve the five
required contexts and strict branch protection.
Use [the delivery loop](docs/development/workflow.md#delivery-loop) to state the
observable result, select checks and finish without reopening completed scope.

## Writing

Prefer prose unless items are genuinely parallel. Use measured claims, avoid superlatives and contrastive "X, not Y" framing.
