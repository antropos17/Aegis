---
name: pr-monitor
description: Monitor and triage incoming PRs for Aegis. Use when checking PR status, reviewing contributor PRs, or running /loop PR monitoring tasks.
---

# PR Monitor — Aegis

## Workflow
1. `gh pr list --repo antropos17/Aegis --state open` — список открытых PR
2. Для каждого PR:
   - `gh pr checks $NUMBER` — CI статус
   - `gh pr diff $NUMBER --stat` — scope (файлы, строки)
   - `gh pr view $NUMBER` — описание, автор, labels

## Triage Rules
- >300 lines в одном файле → flag для ручного review
- Touches src/main/ → verify: CJS only, no import/export, .js only
- Touches src/renderer/ → verify: Svelte 5 runes, no legacy $:
- Touches rules/*.yaml → verify: _schema.json compliance
- New dependency → `npm audit` на этот пакет
- Touches tests/ → run `npx vitest run` на затронутые файлы

## Size Labels
- size/S: <50 lines changed
- size/M: 50-200 lines
- size/L: >200 lines

## Report Format
```
PR #N by @author — title
CI: ✅/❌ | Size: S/M/L | Area: main/renderer/tests/docs
Concerns: [list or "none"]
Recommendation: MERGE / REVIEW NEEDED / CHANGES REQUESTED
```

## /loop Usage
```
/loop 30m check for new open PRs on Aegis. For each: run triage, show report.
/loop 5m watch CI on PR #N. Stop when checks complete.
```
