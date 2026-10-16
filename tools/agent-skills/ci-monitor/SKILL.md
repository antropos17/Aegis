---
name: ci-monitor
description: Check AEGIS CI for a specific PR or commit. Also handle recurring CI monitoring or repository metrics when the user requests them.
---

# Monitor AEGIS CI

Resolve the repository from the checkout's remote or the supplied PR URL. Identify the target PR and head commit before reading results. For a PR, use its check rollup; a workflow may run on a synthetic merge commit, so filtering runs only by the branch head can miss it.

Useful read-only commands, with placeholders replaced by observed values:

    gh pr view <number> --repo <owner/repo> --json headRefOid,statusCheckRollup,url
    gh pr checks <number> --repo <owner/repo> --json name,state,bucket,link
    gh run list --repo <owner/repo> --commit <sha> --json databaseId,headSha,status,conclusion,url
    gh run view <run-id> --repo <owner/repo> --json status,conclusion,headSha,jobs,url

A run is finished only when status is completed. Report success only from a successful conclusion. Queued, waiting and pending are unfinished; cancellation, timeout, skipped jobs and missing checks are not proof of success. gh pr checks exit code 8 means pending. An API/authentication failure is unavailable evidence, not a failed build.

Match required checks against AGENTS.md, the current CI workflow and available branch requirements. If the PR head changes, refresh the target and do not reuse results from the old revision. On failure, inspect the failed job and relevant logs.

For active watching, use bounded waits and stop at the requested outcome or a result requiring action. A routine post-push check does not create a recurring automation. For explicitly requested recurring monitoring, use the host's available scheduler; /loop is host-specific, not a universal command. Save the target, stopping condition and notification intent; stay quiet while nothing meaningful changes.

Fetch stars, forks or issue counts only when requested. Report measured changes without invented growth targets or severity thresholds.
