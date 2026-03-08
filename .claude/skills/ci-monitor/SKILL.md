---
name: ci-monitor
description: Monitor CI status, GitHub stats, and repo health for Aegis. Use for /loop CI watching, post-push verification, and launch metrics tracking.
---

# CI Monitor — Aegis

## Post-Push CI Watch
```
gh run list --repo antropos17/Aegis --limit 3
gh run view $RUN_ID
```
Wait for status != "in_progress", then report PASS/FAIL.

## Repo Health Check
- `gh api repos/antropos17/Aegis` → stars, forks, open issues
- `gh issue list --state open --limit 20` → open issues
- `gh pr list --state open` → open PRs
- `npm audit --audit-level=high` → security

## /loop Usage
```
/loop 2m watch CI for latest push. Stop when all checks pass or fail.
/loop 1h track stars/forks/issues count on Aegis. Log changes.
/loop 1d run npm audit. Flag HIGH/CRITICAL.
```

## Alert Thresholds
- CI fail on master → CRITICAL
- npm audit HIGH/CRITICAL → HIGH
- >5 open PRs without review → MEDIUM
- Stars growth <1/day post-launch → INFO (adjust strategy)
