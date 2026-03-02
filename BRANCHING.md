# Branch Strategy: GitHub Flow

## Branches

- `master` — always stable, passes CI
- `feat/short-name` — new features
- `fix/short-name` — bug fixes
- `perf/short-name` — performance
- `docs/short-name` — documentation

## Rules

1. NEVER commit features directly to master
2. Create branch -> changes -> PR -> CI passes -> squash merge
3. Keep branches short-lived (1-3 days)
4. Delete branch after merge
5. Direct master commits OK ONLY for: typos, version bumps, CI config

## For AI agents (Claude Code)

```powershell
# Create branch
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git checkout -b feat/feature-name"

# Make changes, commit
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git add file1 file2; git commit -m 'feat(scope): description'"

# Push branch
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git push origin feat/feature-name"

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
