# Branch Strategy: GitHub Flow

## Branches

- `master` — always stable, passes CI
- `feat/short-name` — new features
- `fix/short-name` — bug fixes
- `perf/short-name` — performance
- `chore/short-name` — maintenance, data updates
- `docs/short-name` — documentation

## Rules

1. Create branch -> changes -> PR -> CI passes -> **merge commit**. Squash and rebase are
   disabled on the repository, so `gh pr merge <n> --merge --delete-branch` is the only
   method available and every merge lands as a two-parent commit. Squash the noisy commits
   on your own branch *before* opening the PR.
2. Keep branches short-lived (1-3 days)
3. Branch is deleted on merge (`delete_branch_on_merge` is on)
4. **Direct commits to master are impossible, for anything — including typos, version bumps
   and CI config.** `master` requires a pull request plus green `audit` / `build` / `lint` /
   `svelte-check` / `test`, with admin enforcement on, so the push is rejected. The
   `.codex/hooks/branch-guard.js` hook refuses edits on master before you get that far.

## For AI agents (Claude Code)

Replace `<repo-root>` with the path to your local Aegis checkout before running these commands.

```powershell
# Create branch
powershell.exe -NoProfile -Command "cd '<repo-root>'; git checkout -b feat/feature-name"

# Make changes, commit
powershell.exe -NoProfile -Command "cd '<repo-root>'; git add file1 file2; git commit -m 'feat(scope): description'"

# Push branch
powershell.exe -NoProfile -Command "cd '<repo-root>'; git push origin feat/feature-name"

# Create PR
gh pr create --title 'feat(scope): description' --base master
```

## Conventional Commit Prefixes

| Prefix | Use |
|--------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructuring |
| `docs` | Documentation only |
| `chore` | Maintenance, dependencies |
| `ci` | CI/CD changes |
| `test` | Tests only |
| `style` | CSS/formatting only |
