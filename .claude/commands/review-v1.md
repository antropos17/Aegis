---
description: Parallel pre-v1.0 read-only audit. Fans out to 4 review subagents, collects one report. Usage: /review-v1
---
Run a parallel **pre-v1.0 release audit** of AEGIS. This command is **READ-ONLY**:
it inspects and reports — it never edits code, never commits, never builds artifacts.

Dispatch these 4 subagents in parallel (one Agent call per subagent, sent together):

1. **architecture-mapper** — structural map: main/renderer/preload split, detection
   pipeline, IPC channels, dead code, JS→TS completeness.
2. **security-reviewer** — Electron hardening, IPC surface, secrets-leak trace,
   Anthropic key handling, dependency CVEs (RED/YELLOW/GREEN).
3. **test-auditor** — coverage matrix, untested monitoring/IPC/cross-platform paths,
   weak or tautological tests.
4. **consistency-reviewer** — docs-vs-reality: verify the 107-agent / 68-rule / <2s-boot
   / CSP / JS-vs-TS / IPC-count claims against source.

Then synthesize all four reports into ONE summary **pre-release report**:
- Top blockers (must-fix before v1.0), grouped by subagent.
- Cross-cutting issues (a finding more than one reviewer raised).
- A single GO / NO-GO verdict for v1.0 with the reasoning.

Do not edit, fix, or commit anything. Report only — the human decides what to fix.

---

### ⚠️ Unattended-run caveat (pre-grant honesty)

**All four subagents are read-only by PROMPT ONLY, not by enforcement.** Each carries a
bare `Bash` grant in its frontmatter (`tools: Read, Grep, Glob, Bash`) — a full shell.
Their "READ-ONLY / no Write-Edit" rule lives only in the prompt text; the harness will
not block a mutation. (The one fleet agent that *is* enforced read-only — `auditor`,
with scoped Bash + `disallowedTools: Write, Edit` — is deliberately **not** in this
fleet.) The only hard guarantee is the project-level `.claude/settings.json` `deny` list
(`rm -rf`, `git push --force`, `.env` reads), which overrides any agent grant and
protects all four from mutation.

**Prompt-stalls under an unattended run:** the documented inspection commands are now
pre-approved in `settings.json` `allow` — including `npm audit` / `npm ls` (used by
security-reviewer + architecture-mapper). So the *documented* command set runs without
prompts. BUT because the grant is bare `Bash`, **any ad-hoc command a reviewer improvises
outside its documented set will still prompt** and stall an unattended run. For a fully
silent run, harden the reviewers to scoped Bash specifiers first (see progress.md
follow-up: "harden review-fleet").
