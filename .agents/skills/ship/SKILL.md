---
name: ship
description: Full deploy pipeline. Use when user says ship, push, deploy, or code is ready.
disable-model-invocation: true
---

# Ship

One command — format, build, lint, commit, push, verify CI. No questions asked.

## Trigger

User says: "ship", "push it", "deploy", "/ship"

## Workflow

Execute ALL steps without stopping or asking questions.

### Step 0: Branch Check
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git branch --show-current"
- If on `master` → create a feature branch first: `git checkout -b feat/[short-name]`
- NEVER push features directly to master

### Step 1: Format
npm run format

### Step 2: Build
npm run build:renderer
- If FAILS → STOP. Show error. Do nothing else.

### Step 3: Lint
npm run lint
- Report result, continue either way.

### Step 3b: Svelte MCP Autofixer
For each changed .svelte file (from git diff --name-only), run Svelte MCP autofixer.
- If issues found → fix them before committing.

### Step 4: Commit + Push
powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git status --porcelain"
- If NO changes → skip to Step 5
- If changes exist:
  - git add -A
  - Generate commit message from git diff --cached --stat:
    - Only docs/ or *.md → docs: [description]
    - Only src/renderer/ → feat: [description] or fix: [description]
    - Only .github/ → ci: [description]
    - Mixed → chore: [description]
  - git commit -m "[generated message]"
  - Push to feature branch (NEVER master):
    powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git push origin HEAD"
  - Create PR: `gh pr create --title '[commit message]' --base master`

### Step 5: Verify CI
gh run list -L 1 --json status,conclusion,name,createdAt
- Report CI status

### Step 6: Report
Print:
SHIPPED
Commit: [hash] [message]
Files: [count] changed
CI: [status]

## Rules
- NEVER ask for confirmation
- NEVER pause between steps
- If something breaks — fix it and continue
- Only STOP if build:renderer fails
