---
name: commit-and-track
description: Commit and push a completed AEGIS change when requested or already authorized as part of the active task. Preserve unrelated work and stage only task files.
---

# Commit and track

Use the active session's authorization and the selected checkout's AGENTS.md.
For a commit/push request, apply isolation, verification, staging and commit/push
steps from `docs/development/workflow.md#git-and-pr-cycle`. Stop at the requested
outcome; use ship for an authorized PR/merge cycle. An audit or prompt request
alone does not call for publication.

Inspect both the index and working tree. Stage only identified task paths or
intended hunks; a mixed index must not pull unrelated work into the commit.
Canonical skills live in `tools/agent-skills/`; ignored installed copies stay
local. Format only task paths when necessary.

After pushing, use ci-monitor for the actual commit or PR. If CI triggers only
on master and PRs, an absent feature-branch run before PR creation is expected.
Report commit, branch, push status and available checks. Reuse passing evidence
only for unchanged relevant inputs.
