---
name: ship
description: Complete an explicitly requested AEGIS PR/merge or deployment workflow. Use commit-and-track for a commit-and-push-only request.
---

# Ship AEGIS

Use the active session's authorization and the selected checkout's AGENTS.md.
The canonical PR/merge procedure is
`docs/development/workflow.md#git-and-pr-cycle`; commit-and-track handles staging
and commit/push details, and ci-monitor interprets the current PR's checks.

Review the final diff and create or update one focused PR with the resulting
behavior and actual validation. Avoid empty or duplicate PRs. A request limited
to preparing a PR ends at that boundary. For an authorized merge, wait for every
required context on the current revision, keep master current by merging when
needed and use the verified head with `--match-head-commit`. Never bypass checks
with `--admin`. Follow the workflow's occupied-master/worktree procedure.

Verify and report the resulting PR and merge state. A merge does not establish
installation or deployment. Release tags, force pushes, lockfile regeneration
and protected configuration retain the boundaries in AGENTS.md. If installation
is explicitly requested, identify the destination, preserve its app/profile,
verify the package and inspect the installed executable and shortcuts.
