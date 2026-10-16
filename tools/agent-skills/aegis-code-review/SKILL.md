---
name: aegis-code-review
description: Review an AEGIS PR, commit, branch or working-tree diff for concrete defects, requirement gaps and project-rule violations. Read-only unless fixes are requested; use audit-check for broad repository readiness checks.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/code-review/SKILL.md
---

# AEGIS change review

Adapted from Matt Pocock's code-review skill; attribution and terms: [LICENSE](LICENSE).

## Bound the review

Read the selected checkout's AGENTS.md and relevant source. Record path, HEAD, git status and review target. Use [aegis-context](../aegis-context/SKILL.md) when available; otherwise inspect Vite and package configuration directly. Resolve the active renderer and runtime path before calling code missing or retired. Do not switch or clean another task's worktree.

Use the target supplied by the user. For a PR/branch, resolve base/head and inspect `git diff <base>...<head>`, stating that the base is the merge base. For a commit, choose its appropriate parent. For working changes inspect unstaged and staged diffs separately and read relevant untracked files from `git ls-files --others --exclude-standard`. HEAD-only review misses unfinished work. Ask for a base only when the request cannot be resolved reliably.

When workers may change the reviewed tree, agree on a frozen review scope and record its file hashes, including relevant untracked files. Recheck the scope and hashes after validation. Review any changed delta before accepting the result; otherwise identify the exact earlier revision covered by the review. Coordinate generated reports and source-mutating gates with their owner.

Find requirements in the request, supplied spec, linked issue and applicable contracts. Read issue/PR content without posting. No issue-tracker setup is required. If the spec is unavailable, state that limitation and continue defect/convention review without inventing requirements.

## Two passes, one reviewer

Perform both passes yourself. Do not spawn subagents or external AI CLIs unless the user explicitly requests delegation. A review request does not authorize code fixes or publication; existing project authorization applies to actions actually within the task.

**Requirements:** trace each relevant promised behavior through its real callers and outputs. Identify omissions, wrong results and unrequested behavior. Consult current memory-bank notes as navigation, then verify source. A test count, successful command or old handoff is not implementation evidence.

**Engineering:** check the applicable documented conventions and the changed runtime paths. Main uses CommonJS and renderer uses its configured ESM/Svelte setup. Verify platform abstraction, dependency seams and the effective TypeScript/test configuration; bare tsc --noEmit against the root solution is not a type check of the codebase.

Follow contracts where the diff reaches them:

- Identity and attribution: stamped instance identity, OS-grounded birth time or null, PID reuse, concurrent instances, unknown ownership and observation outages. Read relevant memory-bank/ai-mistakes.md entries.
- Sensor/native paths: distinguish empty results, unavailable observations, deliberate filtering and counted loss. Check actual lifecycle and cleanup paths. Live ETW claims need live-provider evidence for the relevant binary/configuration, separate from mocks and self-tests.
- Audit: trace append/flush/normalization and drop accounting. A valid retained chain alone cannot establish event completeness.
- IPC and UI: inspect producer, preload exposure, active consumer and visible result. Verify payload handling and subscription cleanup for changes that affect them.
- Tests: prove that mocks reach the CommonJS caller, source files enter the configured test/coverage projects, and assertions observe the actual triggering pattern.
- Qualification harnesses: trace the actual driver's names, roots, transferred files and execution context into each helper and oracle. For Windows guest changes, check the effective PowerShell policy, principal and desktop, and derive temporary paths on the executing machine. Use caller-produced values in integration regressions; agreeing fabricated fixtures can hide a broken connection. Report local same-principal controls separately from actual guest observations.

Treat architectural smells as hypotheses requiring a concrete consequence in this diff. Do not report a stylistic preference, generic rewrite opportunity or tooling-enforced formatting as a defect. Clearly distinguish introduced defects from relevant pre-existing issues.

## Evidence and delivery

For each actionable finding give priority, exact file/line or symbol, trigger, consequence and supporting requirement or code path. Label requirements versus engineering findings, order by impact and distinguish proven issues from open questions. A concise combined list is sufficient; do not force duplicate reports.

Use existing check results tied to the reviewed revision and focused read-only validation where useful. [audit-check](../audit-check/SKILL.md), when available, covers a separately requested readiness audit; do not automatically run that whole workflow for every diff. Derive any required final checks from the current AGENTS.md/CI. Run source-mutating verification gates in an isolated checkout or exclusively, never alongside readers of the same temporary mutations.

Do not edit source, regenerate lockfiles, run broad formatting, weaken checks or post review comments just to finish a read-only review. Report actual scope, findings and validation gaps. No findings means no defects were found within that scope; it does not establish security, release readiness or correct installation.
