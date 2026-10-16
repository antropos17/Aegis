---
name: audit-check
description: Audit AEGIS repository health or readiness for a push or release, using current CI checks, derived counts and source-backed documentation checks.
---

# Audit AEGIS

Record the checkout, commit and working-tree changes first. An audit reports findings; fixes follow the user's requested scope and preserve concurrent work.

For a full pre-push or pre-release audit, read AGENTS.md, package.json and .github/workflows/ci.yml, then run the verification commands defined by the current workflow. Include its type checks, tests, mutation gates, derived-count check and production dependency audit, rather than treating format/build/lint as the complete gate. For a specifically limited check, run that scope and state what remains unchecked.

- Use npm run counts:check for maintained counts and documentation declarations. Counting occurrences of a word in README does not validate a claim; compare other relevant claims with source or measured output.
- Match the CI dependency audit scope: currently npm audit --audit-level=high --omit=dev. Distinguish a requested broader development-dependency audit.
- Check tracked internals with git ls-files and the current .gitignore. tools/agent-skills/ is the versioned skill source; .agents/ and .claude/ contain ignored local installations. Check the catalog and synchronization rather than force-adding installed copies. Judge .codex/, .mcp.json and memory-bank/ from current repository policy and tracking rather than a blanket exclusion.
- Run temporary-source mutation gates separately from format/lint/build checks so transient fixtures do not contaminate results.
- Do not run repository-wide formatting to repair unrelated concurrent edits.

Report actual commands, failures, unavailable checks and relevant dirty files. Preserve the distinction between a check that passed, one that failed, and one that never ran.

When available, `dev:map` checks configured dependency boundaries and visualizes static module/IPC scope. Inspect unresolved edges and graph limitations; do not infer complete architecture coverage. `dev:security` runs pinned local Semgrep rules with strict parser handling. Zero findings with parser errors is an incomplete check, not a pass. Read the JSON error/skip list before reporting success.

Use the available Codex Security diff workflow for a security review of a patch; a whole-repository scan or repeated deep scan belongs to an explicitly scoped audit. Protect credentials and telemetry when querying external documentation tools. Keep fresh verification receipts separate from an agent's narrative; the narrative does not prove a check ran. Development/Electron dependencies are outside an `npm audit --omit=dev` result.
