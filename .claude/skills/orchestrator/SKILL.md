---
name: aegis-orchestrator
description: Routes all AEGIS tasks. Triggers on: fix, bug, feat, add, create, refactor, ship, push, audit, check, style, layout, docs, readme.
---

# AEGIS Orchestrator

Central workflow router. Read this skill before starting any task.

## Step 1: Classify

| Type | Keywords | Action |
|------|----------|--------|
| BUG_FIX | fix, bug, broken, crash, error | Fix Workflow |
| FEATURE | add, create, implement, new | Feature Workflow |
| REFACTOR | refactor, simplify, clean, split | Refactor Workflow |
| SHIP | ship, push, deploy, release | Run /aegis-ship |
| AUDIT | audit, check, health, pre-push | Run /aegis-audit |
| UI | design, style, layout, CSS, component | UI Workflow |
| DOCS | docs, readme, changelog | Docs Workflow |

## Step 2: Pre-Flight (all except SHIP/AUDIT)

1. Read memory-bank/ai-mistakes.md
2. Read memory-bank/progress.md
3. Read memory-bank/architecture.md
4. Verify MCP tools: Context7 (fresh docs) and Svelte MCP (autofixer) are responding
5. Run: npm run build:renderer — MUST pass before any code change

## Step 3: Execute

- **BUG_FIX**: locate → fix → build → commit "fix: description"
- **FEATURE**: read ARCHITECTURE.md → implement → update preload.js if new IPC → build → commit "feat: description"
- **REFACTOR**: identify target → refactor → verify no behavior change → build → commit "refactor: description"
- **UI**: read tokens.css → use Svelte MCP (list-sections → get-documentation → svelte-autofixer) → implement with var() only → build → commit "style: description"
- **DOCS**: update .md files → commit "docs: description"

## Step 4: Post-Flight

1. npm run build:renderer (MUST pass)
2. Update memory-bank/progress.md
3. If new files → update memory-bank/architecture.md
4. If mistake made → add to memory-bank/ai-mistakes.md
5. If agent count or test count changed → sync in CLAUDE.md, aegis-context/SKILL.md, progress.md

## Rules

- NEVER change files not mentioned in the task
- Max 200 lines per file
- Svelte 5 runes only ($state, $derived, $effect)
- Main process: CommonJS. Renderer: ES modules.
- All IPC through preload.js contextBridge
- CSS: scoped in .svelte, use var() from tokens.css
- Do NOT add features not requested
