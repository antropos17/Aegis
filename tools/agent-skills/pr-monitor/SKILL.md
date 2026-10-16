---
name: pr-monitor
description: Read and triage AEGIS pull requests, review contributor changes, or monitor a specified PR when requested.
---

# Review and monitor AEGIS PRs

Resolve the repository from the supplied PR or configured remote. Use explicit PR numbers and record the head revision so concurrent pushes cannot be mistaken for the reviewed change.

    gh pr list --repo <owner/repo> --state open
    gh pr view <number> --repo <owner/repo> --json title,author,body,files,additions,deletions,headRefOid,url
    gh pr diff <number> --repo <owner/repo> --name-only
    gh pr diff <number> --repo <owner/repo>
    gh pr checks <number> --repo <owner/repo>

gh pr diff has no --stat flag. Use the files/additions/deletions fields for scope and the patch for review. Use ci-monitor to interpret unfinished checks and bind results to the current revision.

Review changed behavior, contracts and evidence:
- Main-process changes preserve CommonJS, platform boundaries and stamped identity.
- Renderer changes follow the actual Vite entrypoint and Svelte conventions; consider frontend/observatory/ as well as src/renderer/.
- Rule changes match the applicable schema and runtime consumer.
- Dependency changes are assessed using the relevant manifest/lockfile diff and audit scope; npm audit is not a per-package command.
- Run tests relevant to the changed behavior, including when the PR changes implementation without changing a test file.

A file exceeding 300 lines is context for maintainability, not an automatic defect. Do not reject a change solely by file length or changed-line count.

Report the PR/revision, scope, actual check state and actionable findings. Recommendation text is not a posted review or a merge. Reading/reviewing a PR does not authorize publishing comments, labels or review decisions to other people. Follow the session's explicit authorization for such actions.

For requested recurring monitoring, use the current host's scheduler and notify on meaningful changes; a one-time review does not set up /loop or an automation.
