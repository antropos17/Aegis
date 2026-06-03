---
name: audit-check
description: AEGIS-specific pre-push / pre-release repo audit. Runs format:check, build:renderer, lint, agent-database count, README cross-check, git status, and tracked-internals check. Use when the user says "run audit", "check repo health", or "pre-push check" inside the AEGIS project.
---

# Audit Check Skill

## Overview
Полная проверка repo перед push или release.

## Workflow
1. npm run format:check — formatting OK?
2. npm run build:renderer — build OK?
3. npm run lint — lint OK?
4. node -e "const d=require('./src/shared/agent-database.json');console.log('Agents:', d.agents.length)" — agent count
5. grep -c "agent" README.md — verify README references
6. git status — clean working tree?
7. git ls-files | grep -E "^memory-bank/|^\.agent/" — no must-stay-untracked internals tracked? (.claude/agents/, .claude/skills/, .mcp.json are intentionally tracked — do NOT flag them)
8. Report pass/fail for each check

## Trigger
"Run audit" or "Check repo health" or "Pre-push check"
