---
name: prompt-craft
description: Write or revise an AEGIS task prompt when the user asks for a prompt, using current source, design context and session authorization.
---

# Write an AEGIS task prompt

State the requested result, relevant observed files and behavior, and validation needed to assess completion. Make the prompt self-contained, while leaving routine implementation decisions flexible. A prompt-writing request asks for a prompt; do not execute it, create a separate task or invoke another agent unless requested.

Read AGENTS.md and verify the actual checkout before naming paths. Vite determines the renderer root; frontend/observatory/ is not present in every checkout. Existing implementation is evidence to inspect, not a reason to claim a reported bug is already fixed without verifying the behavior.

For UI integration, use the applicable approved design and design-system guidance. For a new visual exploration, preserve the user's freedom to explore alternatives and distinguish concept delivery from integration.

For monitoring/backend changes, include only relevant identity, outage, platform and measurement invariants. Consult the applicable failure history in memory-bank/ai-mistakes.md when needed.

Describe checks for the behavior being changed, using package.json and docs/development/workflow.md. Use project-aware typecheck commands rather than bare tsc against the solution. Rendered checks apply to UI implementation; prototype-only work needs artifact review. Do not require an unavailable MCP, external AI CLI or subagent.

Carry forward the session's authorization for reversible changes and the Git cycle where relevant. For tracked source work use an appropriate codex/ feature branch/worktree without disturbing dirty parallel work. Do not add routine plan/push approval questions, arbitrary limits on steps/files, a mandatory prompt formula, or automatic recurring monitoring. Preserve explicit boundaries for releases and protected files from AGENTS.md.
