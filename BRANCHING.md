# Branching and commits

Use one feature branch per logical task. Start from a freshly fetched
`origin/master`; preserve existing work and use a separate worktree when the
shared checkout is dirty. Agent-created branches use `codex/<task>`.
Contributors may use a descriptive prefix such as `feat/`, `fix/` or `docs/`.

The [Git and PR workflow](docs/development/workflow.md#git-and-pr-cycle) is the
single procedure for isolation, staging, pushing, keeping a PR current and
merging its verified revision. Maintainer/agent authorization is defined in
[AGENTS.md](AGENTS.md#permissions-and-boundaries); external contributors submit
a PR for maintainer review. History rewriting is not a prerequisite for review.

Use conventional commit subjects: `type(scope): description`.

| Type | Change |
| --- | --- |
| `feat` | New capability |
| `fix` | Bug fix |
| `perf` | Measured performance improvement |
| `refactor` | Code restructuring |
| `docs` | Documentation |
| `chore` | Maintenance or dependencies |
| `ci` | CI/CD |
| `test` | Tests |
| `style` | Formatting |
