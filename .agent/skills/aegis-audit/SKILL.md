# aegis-audit

Full repo health check with auto-fix. Run before push, release, or PR.

## Trigger

User says: "audit", "repo health", "pre-push check", "check everything", "/aegis-audit"

## Workflow

Execute each step sequentially. Track pass/fail for every check.

### Step 1: Format Check + Auto-Fix

```bash
cd "x:/Future/ESCAPE/AEGIS" ; npm run format:check
```

- If **passes** → report PASS
- If **fails** → run `npm run format` to auto-fix, then report FIXED

### Step 2: Build Renderer

```bash
cd "x:/Future/ESCAPE/AEGIS" ; npm run build:renderer
```

- If **passes** → report PASS
- If **fails** → report FAIL with error output. Do NOT continue to commit step.

### Step 3: Lint

```bash
cd "x:/Future/ESCAPE/AEGIS" ; npm run lint
```

- If **passes** → report PASS
- If **fails** → report WARN with issues found. List them for the user.

### Step 4: Agent Count Consistency

Verify the agent count in `src/shared/agent-database.json` matches all references:

```bash
cd "x:/Future/ESCAPE/AEGIS" ; node -e "const db=require('./src/shared/agent-database.json'); console.log(db.agents.length)"
```

Then grep for agent count references in README.md and CLAUDE.md:

```bash
grep -oP '\d+(?= agent)' README.md CLAUDE.md | sort | uniq -c
```

- If all counts match the actual JSON count → report PASS
- If mismatch → report MISMATCH with actual vs referenced counts. Offer to fix.

### Step 5: No Internal Files in Git

Check that memory-bank, .mcp.json, .claude/ config, and other internal files are not tracked:

```bash
cd "x:/Future/ESCAPE/AEGIS" ; git ls-files | grep -E "(memory-bank/|\.mcp\.json|\.claude/settings|\.agent/|node_modules/)" || echo "CLEAN"
```

- If CLEAN → report PASS
- If files found → report WARN and list them

### Step 6: Auto-Commit Fixes

If Step 1 produced auto-fixes (formatting changes):

```bash
cd "x:/Future/ESCAPE/AEGIS" ; git status --porcelain
```

- If there are changes from auto-fix → `git add -A ; git commit -m "chore: auto-fix formatting"`
- If no changes → skip

### Step 6b: Run Tests

```bash
cd "x:/Future/ESCAPE/AEGIS" ; npx vitest run
```

- If all pass → report PASS with test count
- If failures → report FAIL with failing test names

### Step 6c: Hardcoded Colors Check

Search for hardcoded rgba/hex in .svelte files (should use var() from tokens.css):

```bash
cd "x:/Future/ESCAPE/AEGIS" ; grep -rn "rgba\|#[0-9a-fA-F]\{3,8\}" src/renderer/lib/components/*.svelte | grep -v "var(" | grep -v "//" || echo "CLEAN"
```

- If CLEAN → report PASS
- If matches found → report WARN and list files with hardcoded colors

### Step 7: Summary Report

Print a table:

```
AEGIS Audit Report
==================
Format     : PASS | FIXED | FAIL
Build      : PASS | FAIL
Lint       : PASS | WARN (N issues)
Tests      : PASS (N tests) | FAIL
Agent Count: PASS | MISMATCH (actual N, refs say M)
Colors     : PASS | WARN (N hardcoded)
Git Clean  : PASS | WARN (N internal files tracked)
Auto-Commit: COMMITTED | SKIPPED | N/A
==================
Result: ALL CLEAR | ISSUES FOUND
```
