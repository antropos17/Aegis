# AEGIS

AEGIS is an Electron desktop app that monitors local AI agents, with a Svelte renderer and Vitest tests.

Explicit user instructions take precedence over repository guidance. If a repository instruction blocks requested work, name its file and quote the rule.

## Read for the task

- Code or documentation changes and reviews: read [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Checkout isolation, source navigation, dependency setup, verification or the PR cycle: read the relevant sections of [Development workflow](docs/development/workflow.md).
- Observatory frontend work: also read [its instructions](frontend/observatory/AGENTS.md); they identify the visual authority and host-integration rules.
- Identity stamping, snapshot-session or sequence-rule changes: read the runtime invariants in [CODING_STANDARDS.md](CODING_STANDARDS.md#runtime-invariants).
- Identity stamping, audit-chain or Windows worktree work: read the relevant history in [memory-bank/ai-mistakes.md](memory-bank/ai-mistakes.md).

## Permissions and boundaries

Local fixture tests and the full git cycle (branch from `origin/master`, commit, push, open a PR and merge) are authorised in advance. Follow the development workflow and wait for all required CI contexts before merging.

Human authorisation is required for cutting a release tag, force pushing, regenerating the lockfile, deleting a remote branch other than the one just merged, or changing anything under `.github/workflows/` or `.codex/config.toml`. An explicit user request for that action supplies the authorisation.

## Writing

Prefer prose unless items are genuinely parallel. Use measured claims, avoid superlatives and contrastive "X, not Y" framing.
