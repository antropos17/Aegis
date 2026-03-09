---
name: prompt-craft
description: Aegis prompt formula for Claude Code and Antigravity. Use when writing prompts, planning tasks, starting new work, or when the user says "write a prompt", "create a task", "plan work", or asks how to structure a request for an AI coding assistant. Also use proactively when decomposing a large request into atomic subtasks.
---

# Prompt Craft — Aegis Task Formula

A prompt in Aegis is not just a request — it is a **complete execution plan** that an AI coding assistant (Claude Code or Antigravity) can follow without ambiguity. A well-written prompt eliminates back-and-forth, prevents scope creep, and guarantees that every change is verified before it touches the codebase.

## The Formula

Every prompt follows this sequence:

```
BRANCH → TASK → STEPS → STOP → VERIFY → COMMIT
```

Each stage has a specific purpose:

| Stage | Purpose | What goes here |
|-------|---------|----------------|
| **BRANCH** | Isolation | Branch name following conventional prefix |
| **TASK** | Scope lock | One sentence — what changes, nothing else |
| **STEPS** | Execution plan | Numbered atomic actions, each independently verifiable |
| **STOP** | Guardrails | Explicit list of what NOT to do |
| **VERIFY** | Quality gate | Exact commands to run before committing |
| **COMMIT** | Closure | Commit message format and post-push actions |

The reason for this structure: AI assistants tend to drift — adding features nobody asked for, skipping verification, or committing broken code. Each stage acts as a fence that keeps the work within bounds. STOP is especially important because telling an AI what NOT to do is often more effective than listing everything it should do.

## Stage Details

### 1. BRANCH

Format: `prefix/short-description`

| Prefix | When to use |
|--------|-------------|
| `feat/` | New functionality |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring without behavior change |
| `perf/` | Performance improvement |
| `docs/` | Documentation only |
| `chore/` | Maintenance, dependency updates, data changes |
| `test/` | Adding or fixing tests |

Branch from `master` always. Never work directly on master.

Git command (Aegis uses PowerShell wrapper):
```
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git checkout master; git pull; git checkout -b feat/my-feature"
```

### 2. TASK

One sentence that answers: "What will be different after this prompt is executed?"

Good tasks are **atomic** — they change one logical thing. If you need the word "and" to describe the task, it is probably two tasks.

**Good:**
- "Add a refresh button to the AgentCard header"
- "Fix double-encoding of UTF-8 in export-report.js"
- "Update agent-database.json with 3 new agent signatures"

**Bad (too broad):**
- "Improve the agent monitoring system" — improve how? Which parts?
- "Fix bugs and add dark mode" — two tasks, split them
- "Refactor the renderer" — the entire renderer? Be specific

### 3. STEPS

Numbered list of atomic actions. Each step should be independently verifiable — if the process stops after step 3, steps 1-3 should leave the codebase in a valid state.

Guidelines for good steps:
- **Name the files.** "Edit src/renderer/lib/AgentCard.svelte" not "edit the component"
- **Be specific about the change.** "Add a button inside the .card-header div" not "add a button somewhere"
- **Include the why when it is not obvious.** "Use $derived instead of $effect because it is a computed value, not a side effect"
- **Keep each step small.** If a step takes more than 5 minutes of work, break it down further
- **Order matters.** Dependencies first — types before implementation, implementation before tests

### 4. STOP

This is the most underrated stage. AI assistants will happily "improve" adjacent code, add error handling nobody asked for, or refactor a function while fixing a typo in it.

Always include at minimum:
```
STOP:
- Do NOT modify files not listed in STEPS
- Do NOT add features beyond what TASK describes
- Do NOT refactor surrounding code
```

Add task-specific constraints as needed:
- "Do NOT change CSS outside of tokens.css variables"
- "Do NOT modify the IPC channel contract"
- "Do NOT update any badge counts or version numbers"

Refer to `memory-bank/ai-mistakes.md` for common Aegis-specific mistakes to guard against.

### 5. VERIFY

Run the verify loop (see code-quality rule) — this is the single source of truth for which commands to run.

Additional checks depending on the task:
- **Svelte files changed:** Run Svelte MCP autofixer on each changed .svelte file
- **Main process files changed:** Test on Windows (Electron main is CJS-only)
- **Types changed:** Verify no any types — tsc must pass clean
- **agent-database.json changed:** Verify count consistency across README, CLAUDE.md

Never skip verification. A prompt without VERIFY is incomplete.

### 6. COMMIT

Commit message follows conventional commits:

```
type(scope): description
```

Examples:
- `feat(renderer): add refresh button to AgentCard`
- `fix(scanner): prevent double-encoding in export`
- `docs(readme): update agent count badge to 110`

After push, start monitoring:
- `/loop 2m` — CI watcher (ci-monitor skill, watches GitHub Actions)
- `/loop 30m` — PR triage (pr-monitor skill, checks for new PRs)

Never push without user confirmation. The prompt should end with "Push?" or similar — let the human decide.

## Atomic Task Pattern

Large features must be decomposed into atomic subtasks. Each subtask gets its own prompt following the full formula.

**Decomposition rule:** If a task touches more than 3 files OR takes more than 6 steps, consider splitting.

**Example — "Add export functionality to AgentStatsPanel":**

This is too big for one prompt. Decompose into:

1. **Prompt 1** — `feat/export-types`: Add TypeScript types for export format in `src/shared/types/export.ts`
2. **Prompt 2** — `feat/export-util`: Create export utility in `src/renderer/lib/utils/export.ts`
3. **Prompt 3** — `feat/export-button`: Add export button to AgentStatsPanel component
4. **Prompt 4** — `test/export`: Add tests for export utility

Each prompt is independent. If prompt 3 fails, prompts 1-2 are still valid.

## SKIP Pattern

Before writing any prompt, check if the work is already done. This single step can save an entire session of wasted effort.

**How it works:** Before generating STEPS, search the codebase for evidence that the requested behavior already exists. If it does, report back to the user instead of generating a prompt.

**What to check:**
- **Feature requests:** Grep for related function names, component props, event handlers, or UI text
- **Bug fixes:** Try to reproduce the bug first — it may already be fixed on a different branch
- **Keyboard shortcuts:** Search the keydown handlers for the key combination
- **IPC channels:** Check preload.js for existing channel names
- **UI elements:** Search components for the element type (button, tooltip, modal)

**Example from real Aegis work:**

Request: "Add Escape key to close modals"
Check: Grep for `Escape` in src/renderer/
Result: Already handled in App.svelte (line 84), OptionsPanel.svelte (line 104), AgentFormModal.svelte (line 17)
Response: "SKIP — Escape to close modals is already implemented in 3 components. No prompt needed."

**When to partially SKIP:**

Sometimes a multi-part request is partially done. In that case, report what exists and generate prompts only for the missing parts. Example: "Add Ctrl+R, Ctrl+F, and Escape shortcuts" — if Escape is done, generate prompts only for Ctrl+R and Ctrl+F.

**SKIP output format:**
```
SKIP: [feature] is already implemented.
WHERE: [file:line] — [brief description of existing implementation]
VERIFIED: [how you confirmed it works]
```

## Git Rules (Aegis-specific)

These are non-negotiable in every prompt:

1. **PowerShell wrapper** — All git commands via:
   ```
   powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git ..."
   ```
   Never use && in PowerShell. Use ; to chain commands.

2. **Never push to master** — Always feature branch, always PR, always --no-ff merge.

3. **Never push without confirmation** — The prompt should pause and ask before pushing.

4. **Never add Co-Authored-By** — Aegis convention: no co-author headers in commits.

5. **GPG signing** — All commits are GPG-signed (configured in git config).

6. **Squash before PR** — If the branch has multiple small commits (especially docs), squash them into one meaningful commit before creating the PR.

## Complete Example

Here is a real prompt following the formula:

```
BRANCH: fix/sparkline-null-crash

TASK: Fix crash in Sparkline component when data array contains null values.

STEPS:
1. Read src/renderer/lib/components/Sparkline.svelte
2. In the points $derived block, filter out null/undefined values
   before computing the SVG path
3. Add a guard: if all values are null, render an empty SVG
   (no path element, keep the viewBox)
4. Read tests/renderer/Sparkline.test.js
5. Add test case: "renders without crash when data contains nulls"
6. Add test case: "renders empty SVG when all data is null"

STOP:
- Do NOT change the Sparkline visual appearance
- Do NOT modify the SVG viewBox dimensions
- Do NOT add error handling for non-array inputs (caller responsibility)
- Do NOT touch any other component

VERIFY:
Run verify loop (see code-quality rule)
Svelte MCP autofixer on Sparkline.svelte

COMMIT: fix(renderer): handle null values in Sparkline data array

After push:
/loop 2m — CI watch
```

## Prompt Generation

When asked to write a prompt, follow this process:

1. **Clarify the task** — Ask what needs to change (not how). One sentence.
2. **SKIP check** — Search the codebase for existing implementations. If already done, report SKIP instead of generating a prompt.
3. **Identify files** — Which files will be touched? List them explicitly.
4. **Check ai-mistakes.md** — Read memory-bank/ai-mistakes.md and add relevant STOP constraints.
5. **Write the formula** — BRANCH → TASK → STEPS → STOP → VERIFY → COMMIT.
6. **Validate atomicity** — If STEPS > 6 or files > 3, suggest decomposition.
7. **Present to user** — Show the complete prompt and ask for approval before execution.

## Anti-Patterns

| Bad prompt | Why it fails | Fix |
|-----------|-------------|-----|
| "Fix the bug" | No specifics — which bug? where? | Name the file, the symptom, the expected behavior |
| "Make it look better" | Subjective, no clear completion criteria | "Change card border-radius from 8px to 12px" |
| "Refactor everything" | Infinite scope, no STOP boundary | Pick one module, one pattern, one PR |
| "Do X, Y, and Z" | Three tasks in one — if Y breaks, X and Z are blocked | Three separate prompts |
| Steps without file names | AI guesses which files to edit | Always name the exact file path |
| Missing VERIFY | No verification syndrome | Always include the 4 verification commands |
| Missing STOP | AI adds bonus improvements | Always list what NOT to do |
