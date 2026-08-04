# STATE-RECON — verified snapshot

Read-only reconnaissance of the AEGIS repository. Facts only: every number below is
followed by the command that produced it. No code was changed, nothing was fixed,
deleted or refactored.

**Repo root:** `X:\Future\ESCAPE\AEGIS`
**Recon date:** 2026-08-04
**Shell:** Git Bash, `cd "X:/Future/ESCAPE/AEGIS"` before every command shown.

> **Working-tree caveat that applies to the whole document.** The tree was already
> dirty when this recon started: 19 modified tracked files and 4 untracked paths,
> from in-progress work on `feat/event-schema-v1`. Every count and every gate result
> here is a **working-tree** measurement, not a `HEAD` measurement. Where the tracked
> count differs from the working-tree count, both are given.

---

## 1. Git state

### Current branch

```
$ git rev-parse --abbrev-ref HEAD
feat/event-schema-v1
```

### Last 15 commits

```
$ git log --oneline -15
743e330 Merge pull request #187 from antropos17/docs/ipc-count-49
4362e6b docs: sync IPC and test counts after the audit-stats channel landed
f750481 Merge pull request #186 from antropos17/feat/audit-bounded-buffer
17d6ee5 feat(audit): bound the write buffer and make the loss it causes visible
456ce76 Merge pull request #185 from antropos17/docs/truth-sync
56167ad docs: correct the IPC tables, risk formula and platform claims against source
b500ee6 docs: re-derive every count from source and delete two claims that describe nothing
8ed4233 Merge pull request #184 from antropos17/fix/tsconfig-standalone
b3442e3 fix(tsconfig): split shared base out of root so the renderer is actually type-checked
22970e4 Merge pull request #183 from antropos17/docs/instance-id-sync
72054cc docs: sync test/module/signature counts after instanceId rollout
cd7a7bc Merge pull request #182 from antropos17/feat/token-tracker-instance-key
9549f59 feat(token): key cost records by instanceId so a recycled pid starts clean
ed5946a Merge pull request #181 from antropos17/feat/known-handles-instance-key
64640aa fix(watcher): key knownHandles by instanceId so a recycled pid starts clean
```

### Working tree

```
$ git status --short
 M .claude/rules/code-quality.md
 M .claude/skills/aegis-context/SKILL.md
 M .claude/skills/electron-main/SKILL.md
 M .claude/skills/testing/SKILL.md
 M AGENTS.md
 M CLAUDE.md
 M CONTRIBUTING.md
 M README.md
 M llms-full.txt
 M llms.txt
 M src/main/attribution.js
 M src/main/audit-drop-tracker.js
 M src/main/audit-logger.js
 M src/main/network-monitor.js
 M src/main/scan-loop.js
 M src/shared/types/events.ts
 M tests/main/file-watcher-attribution.test.js
 M tests/main/network-monitor.test.js
 M tests/main/scan-loop.test.js
?? .agents/
?? .codex/
?? src/main/audit-normalize.js
?? tests/main/audit-schema-v1.test.js
```

That listing is the state **before** this recon wrote anything. This document adds
exactly one further untracked path: `docs/current-state/STATE-RECON.md`.

### Version

```
$ node -p "require('./package.json').version"
0.10.0-alpha
```

### Build artifacts are ignored

Checked before running the build gates, so the gates could not add anything to
`git status`:

```
$ git check-ignore -v dist coverage
.gitignore:2:dist/	dist
.gitignore:4:coverage/	coverage
```

---

## 2. Verified counts

### 2.1 Agents and agent signatures

```
$ node -e "
const d=require('./src/shared/agent-database.json');
console.log('agents:', d.agents.length);
console.log('names(signatures):', d.agents.reduce((s,a)=>s+(a.names?a.names.length:0),0));
console.log('version:', d.version, 'lastUpdated:', d.lastUpdated);
"
agents: 110
names(signatures): 262
version: 2.1.0 lastUpdated: 2026-06-03
```

A "signature" here is one entry in an agent's `names[]` array — the process-name
strings the scanner matches against. 110 agents, 262 signatures.

### 2.2 Renderer: `.svelte` files, stores, utils

```
$ find src/renderer -name "*.svelte" | wc -l
47

$ find src/renderer/lib/components -name "*.svelte" | wc -l
46

$ ls src/renderer/lib/stores | wc -l
11

$ ls src/renderer/lib/utils | wc -l
16
```

47 `.svelte` files total = 46 under `lib/components/` + `src/renderer/App.svelte`.
Docs that say "46 components" are counting the `lib/components/` set, which matches.

Store files (`ls src/renderer/lib/stores`):
`acknowledged.ts`, `command-palette.svelte.ts`, `demo-data.js`, `demo-pools.js`,
`events-index.ts`, `ipc.ts`, `process-action.ts`, `risk.ts`, `theme.ts`, `tick.ts`,
`toast.ts`.

Util files (`ls src/renderer/lib/utils`):
`agent-crud-utils.ts`, `agent-stats-utils.ts`, `anomaly-toast-tracker.ts`,
`command-registry.ts`, `format-bytes.ts`, `fuzzy-search.ts`, `grouped-feed-utils.ts`,
`path-utils.ts`, `ring-buffer.ts`, `risk-ring-utils.ts`, `risk-scoring.js`,
`sparkline-utils.ts`, `tab-transitions.ts`, `threat-report.js`, `timeline-utils.ts`,
`trust-badge-utils.ts`.

### 2.3 Main-process modules

```
$ find src/main -name "*.js" | wc -l
46

$ find src/main -maxdepth 1 -name "*.js" | wc -l
37

$ find src/main/platform -name "*.js" | wc -l
7

$ find src/main/token-adapters -name "*.js" | wc -l
2
```

46 working-tree modules = 37 top-level + 7 `platform/` + 2 `token-adapters/`.

Tracked count is 45 — one module is untracked:

```
$ git ls-files "src/main/*.js" "src/main/**/*.js" | wc -l
45

$ git ls-files --others --exclude-standard src/main
src/main/audit-normalize.js
```

### 2.4 Tests

```
$ NO_COLOR=1 npx vitest run 2>&1 | tail -12
 Test Files  66 passed (66)
      Tests  1048 passed | 4 skipped (1052)
```

```
$ find tests -name "*.test.js" -o -name "*.test.ts" | wc -l
66

$ git ls-files "tests/**/*.test.js" "tests/**/*.test.ts" | wc -l
65

$ git ls-files --others --exclude-standard tests
tests/main/audit-schema-v1.test.js
```

66 test files in the working tree, 65 tracked; 1048 passing tests, 4 skipped,
1052 total. The one untracked test file is included in that run.

Distribution:

```
$ find tests -name "*.test.*" | sed 's|/[^/]*$||' | sort | uniq -c
     36 tests/main
      6 tests/main/platform
      2 tests/main/token-adapters
     16 tests/renderer
      4 tests/renderer/components
      2 tests/shared
```

### 2.5 IPC channels

**Preload — invoke (renderer → main, request/response):**

```
$ grep -o "ipcRenderer\.invoke('[^']*'" src/main/preload.js | sed "s/.*('//;s/'//" | sort -u | wc -l
40
```

**Preload — push subscriptions (main → renderer):**

```
$ grep -o "ipcRenderer\.on('[^']*'" src/main/preload.js | sed "s/.*('//;s/'//" | sort -u | wc -l
9
```

40 invoke + 9 push = **49 channels**, matching the CLAUDE.md claim.

**Main-side handlers — 40, and they match the preload set exactly.**

A single-line grep undercounts this to 39, because `ipc-handlers.js:211` wraps
`ipcMain.handle(` and its channel string onto separate lines. The multiline form is
the correct command:

```
Grep(pattern="ipcMain\.handle\(\s*\n?\s*'([^']*)'", path="src/main",
     multiline=true, output_mode="count")
src\main\ipc-handlers.js:40
```

Set-difference against the preload invoke list, using the single-line grep, isolates
exactly the one wrapped call — no other divergence exists:

```
$ grep -o "ipcRenderer\.invoke('[^']*'" src/main/preload.js | sed "s/.*('//;s/'//" | sort -u > /tmp/pre.txt
$ grep -rho "ipcMain\.handle(\s*'[^']*'" src/main --include=*.js | sed "s/.*'\([^']*\)'/\1/" | sort -u > /tmp/han.txt
$ comm -23 /tmp/pre.txt /tmp/han.txt     # in preload, not in the single-line handler grep
save-instance-permissions
$ comm -13 /tmp/pre.txt /tmp/han.txt     # handled but not exposed
(empty)
```

`save-instance-permissions` **is** handled — `src/main/ipc-handlers.js:211-217`:

```
$ grep -n "'save-instance-permissions'" src/main/ipc-handlers.js
212:    'save-instance-permissions',

$ awk 'NR>=211 && NR<=217 {print NR": "$0}' src/main/ipc-handlers.js
211:   ipcMain.handle(
212:     'save-instance-permissions',
213:     (_e, { agentName, parentEditor, permissions, cwd }) => {
214:       config.saveInstancePermissions(agentName, parentEditor, permissions, cwd);
215:       return { success: true };
216:     },
217:   );
```

**Does preload expose all of them? Yes — in both directions.**

- Every one of the 40 `ipcMain.handle` channels has a matching `ipcRenderer.invoke`
  wrapper in preload (the `comm -13` above is empty).
- Every one of the 9 preload `ipcRenderer.on` channels is actually emitted by main.
  All pushes go through the `sendToRenderer` helper (`src/main/main.js:174`) or a
  batcher built on it, so a plain `.send('...')` grep finds only one site:

```
$ grep -rhoE "\.send\(\s*'[^']*'" src/main --include=*.js | sed "s/.*'\([^']*\)'/\1/" | sort -u
toggle-theme

$ grep -rnoE "(sendToRenderer|send)\(\s*'[^']*'" src/main --include=*.js | sort -u
src/main/main.js:446:send('toggle-theme'
src/main/scan-loop.js:159:sendToRenderer('network-update'
src/main/scan-loop.js:294:sendToRenderer('scan-batch'
src/main/scan-loop.js:307:sendToRenderer('token-costs'
src/main/scan-loop.js:315:sendToRenderer('resource-usage'
src/main/scan-loop.js:48:sendToRenderer('scan-status'

$ grep -rnoE "createBatcher\(\s*'[^']*'" src/main --include=*.js
src/main/main.js:185:createBatcher('file-access'
src/main/main.js:186:createBatcher('stats-update'

$ grep -rn "rules:reloaded" src/main --include=*.js
src/main/file-watcher.js:632:    sendFn('rules:reloaded', { count: getAllRules().size, file: basename });
```

That accounts for all 9: `toggle-theme`, `network-update`, `scan-batch`,
`token-costs`, `resource-usage`, `scan-status`, `file-access`, `stats-update`,
`rules:reloaded`.

### 2.6 Detection rules

```
$ awk '/^  - id:/{c++} END{print c}' rules/*.yaml
73
```

Cross-checked by actually parsing the YAML rather than pattern-matching:

```
$ node -e "
const fs=require('fs'),path=require('path');
const yaml=require('js-yaml');
let t=0;
for(const f of fs.readdirSync('rules').filter(f=>f.endsWith('.yaml'))){
  const d=yaml.load(fs.readFileSync(path.join('rules',f),'utf8'));
  const n=(d.rules||[]).length; t+=n; console.log(f, n);
}
console.log('TOTAL', t);
"
ai-config.yaml 38
browser.yaml 9
certificates.yaml 4
cloud.yaml 3
crypto.yaml 1
devtools.yaml 4
secrets.yaml 8
ssh.yaml 6
TOTAL 73
```

73 rules across 8 YAML files. Both methods agree.

---

## 3. ProcessInstanceId migration status

### 3.1 What the migrated key looks like

`src/main/process-identity.js` is the single authority. `identify()` returns one of
three disjoint value spaces (`process-identity.js:126-145`):

| Space | Key form | `instanceIdSource` | When |
|---|---|---|---|
| 1 | `"<pid>:<epochMs>"` | `'os'` | pid > 0 with a readable OS birth time |
| 2 | `"0:<name>"` | `'synthetic'` | pid 0 (IDE-extension, WSL, local LLM runtimes) |
| 3 | `"<pid>:u"` | `'unknown'` | real pid, birth time unreadable |

`instanceId` is stamped in exactly one place — `enrichWithParentChains()` in
`src/main/process-utils.js:178-185`.

### 3.2 Modules that consume `process-identity`

```
$ grep -rln "process-identity" src/ tests/
src/main/file-watcher.js
src/main/process-identity.js
src/main/process-utils.js
src/main/session-tracker.js
src/main/token-tracker.js
src/shared/types/process.ts
tests/main/file-watcher.test.js
tests/main/process-identity.test.js
```

Confirmed migrated (keyed by `instanceId`, not a bare pid):

- **`src/main/session-tracker.js:60`** — `activeSessions`, JSDoc: *"Active sessions
  keyed by `instanceId|process`."* Key built at `session-tracker.js:83`.
- **`src/main/token-tracker.js:126`** — `records`, JSDoc: *"Accumulated cost records
  keyed by instanceId."* Key resolved at `token-tracker.js:194-195`.
- **`src/main/process-scanner.js:49`** — `knownHandles`. Declared here but **written
  only by `file-watcher.js`**, which is handed the same Map through
  `_state.knownHandles` (`file-watcher.js:95`). Its key comes from `handleKey()`
  (`file-watcher.js:341-352`), which returns `agent.instanceId` or
  `buildInstanceId(agent)` — never a bare pid. Writes/reads at `file-watcher.js:370`,
  `478`, and the eviction sweep at `599-609` compares against active `instanceId`s.
  Stated explicitly because ai-mistakes #19 is exactly this failure mode: no
  bare-pid write path into `knownHandles` exists.

### 3.3 Stores still keyed by a bare PID

Search that produced the candidate set:

```
$ grep -rnE "\.(set|get|has|delete)\(\s*(pid|p\.pid|proc\.pid|agent\.pid|a\.pid|entry\.pid|childPid|parentPid|ppid)\b" src/ --include=*.js --include=*.ts

$ grep -rnE "^(const|let)\s+_?[A-Za-z_]+\s*=\s*new (Map|Set)\(" src/main src/renderer --include=*.js --include=*.ts
```

**Scope note.** Only stores that survive across scan ticks are listed. Per-tick
transients (`file-watcher.js:477` `pidToAgent`, `network-monitor.js:174` `pidMap`,
`process-utils.js:172` `names`, the platform adapters' `procMap`/cwd maps,
`token-cost-collector.js:77` `identityByPid`) are rebuilt from the live process list
inside a single tick and then discarded, so a bare pid carries no identity across
process death — they are excluded.

Three cross-tick stores remain keyed by a bare PID:

| # | File | Variable | Declared | Bare-pid key sites |
|---|---|---|---|---|
| 1 | `src/main/process-utils.js` | `cwdCache` | `:214` | `:239` (`cwdCache.get(a.pid)`), `:250` (`cwdCache.set(pid, ...)`), `:255` (`cwdCache.get(a.pid)`) |
| 2 | `src/main/resource-monitor.js` | `_cache` | `:38` | `:228` (`_cache.delete(pid)`), `:250` (`_cache.get(pid)`), `:269` (`_cache.set(pid, ...)`) |
| 3 | `src/renderer/lib/stores/events-index.ts` | `eventsByPid` (inner `map`) | `:16` | `:27` (`map.get(pid)`), `:30` (`map.set(pid, list)`), `:36` (`map.set(pid, list.slice(0,50))`) |

Details:

1. **`cwdCache` — `src/main/process-utils.js:214`.** 60 s TTL
   (`CWD_CACHE_TTL`, `:215`). Keyed by `a.pid` with no name or start-time component,
   unlike its sibling `parentChainCache` in the same file. Sits directly next to the
   migrated code path: `annotateWorkingDirs()` receives agents that already carry
   `instanceId`.
2. **`_cache` — `src/main/resource-monitor.js:38`.** JSDoc states the key form
   outright: *"`@type {Map<number, {resource: Resource, timestamp: number}>` TTL
   cache, keyed by PID."* TTL is `RESOURCE_CACHE_TTL` (`:228`, `:251`).
3. **`eventsByPid` — `src/renderer/lib/stores/events-index.ts:16`.** A derived store
   grouping `FileEvent[]` into `Map<number, FileEvent[]>` by `evt.pid`. The typed key
   is `number`, so it cannot hold an `instanceId` string as-is. Upstream events do
   carry `instanceId` in Event Schema v1 (`src/main/audit-logger.js:223`), but
   `scan-loop.js:85`, `:146` and `:275` emit `instanceId: null` for file, network and
   synthetic-agent events, so the renderer has no instance key to group by for those
   paths.

### 3.4 `parentChainCache` — explicit verdict

**NOT migrated to `<pid>:<startTime>`.** It is keyed by a `<pid>|<lowercased name>`
composite, not by `instanceId`.

- Declared: `src/main/process-utils.js:31`.
- Key function: `_cacheKey(pid, name)` at `src/main/process-utils.js:51-53`, returning
  `` `${pid}|${typeof name === 'string' ? name.toLowerCase() : ''}` ``.
- Key sites: `:73` (`keyOf`), `:84`, `:91`, `:104`, `:138`, `:180`.

This is a documented design decision, not an oversight. The header comment at
`process-utils.js:34-50` states the reason: this cache is where `startTime` is
*read from* (`:136-138`), and `startTime` is the field `instanceId` is built from —
so it cannot be keyed by the value it produces. The name fold is the mitigation:
*"Folding the name in turns a recycled pid that belongs to a different executable
into a cache MISS."*

The comment also records the residual bound verbatim: *"a pid recycled by an
executable with the SAME name still hits inside the TTL"* (60 s,
`PARENT_CHAIN_TTL`, `:32`), partially covered by the `forceRefresh` flag that
`scan-loop` passes whenever the scanned pid set changed.

---

## 4. Debt items

### 4.1 `rules/custom/` directory — **MISSING** (and the false claim is out of the tracked tree)

```
$ ls -d rules/custom
ls: cannot access 'rules/custom': No such file or directory

$ ls rules
_schema.json  ai-config.yaml  browser.yaml  certificates.yaml  cloud.yaml
crypto.yaml   devtools.yaml   secrets.yaml  ssh.yaml
```

The directory does not exist. The README claim that ai-mistakes #20 flagged is gone
from the tracked docs — the only surviving copy is in a local worktree:

```
$ grep -rn "rules/custom" --include=*.md --include=*.js --include=*.ts --include=*.json . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=coverage
./.claude/worktrees/honest-buttons/README.md:151:- Extend or override via `rules/custom/` directory
./memory-bank/ai-mistakes.md:40:    "extend or override via `rules/custom/`" (no such directory; `loadRules(dir)` REPLACES
Binary file ./memory-bank/progress.md matches
```

And that worktree is not tracked, so the claim is not in the repository:

```
$ git ls-files .claude/worktrees | wc -l
0
```

The `memory-bank/` hits are the mistake log and progress notes describing the removal,
not a restatement of the claim.

### 4.2 `.claude/branch-guard.js` blocks edits to master — **WRONG PATH, mechanism EXISTS**

The path in the task does not exist. The actual file is one level deeper:

```
$ find .claude -name "branch-guard*"
.claude/hooks/branch-guard.js
.claude/worktrees/honest-buttons/.claude/hooks/branch-guard.js
```

The second is the untracked worktree copy. The hook is registered and does block:

```
$ node -p "JSON.stringify(require('./.claude/settings.json').hooks,null,2)"
{
  "PreToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/branch-guard.js\"",
          "timeout": 5
        }
      ]
    }
  ],
  ...
}
```

Exact scope of the block, from `decide()` (`.claude/hooks/branch-guard.js:76-105`):

- Branch is not `master` → allow (`:80-82`).
- `cwd` is not a git repo → allow (`:86-87`).
- Edited path is outside the repo root → allow (`:92-95`).
- Path is inside the repo but gitignored → allow (`:97-102`).
- Otherwise — a **tracked, in-repo file while on `master`** → block, exit code 2 with
  a stderr message (`:104`, `:130-135`).

Malformed or absent stdin fails open (`:113-124`).

### 4.3 Merge policy in AGENTS.md around lines 55-56 — **EXISTS, at lines 58-59**

The policy text is two lines below the range in the task:

```
$ grep -n "Merge commits only\|Direct commits to master\|branch-guard" AGENTS.md
58:- **Merge commits only.** Squash and rebase are disabled on the repository, so `gh pr merge <n> --merge --delete-branch` is the only available method and every merge lands as a two-parent commit. Squash the noisy commits on your own branch *before* opening the PR — the merge will not do it for you.
59:- **Direct commits to master are impossible, not merely discouraged.** `master` requires a pull request plus green `audit` / `build` / `lint` / `svelte-check` / `test`, with admin enforcement on, so a local commit on master cannot be pushed at all. `.claude/hooks/branch-guard.js` refuses edits on master before you reach that point.
```

What line 58 states: **merge commits only** — squash and rebase are disabled on the
repository, `gh pr merge <n> --merge --delete-branch` is the only available method,
every merge lands as a two-parent commit, and noisy commits must be squashed on the
branch before the PR opens.

What line 59 states: direct commits to `master` are impossible — PR required plus
green `audit` / `build` / `lint` / `svelte-check` / `test` with admin enforcement, and
the branch-guard hook refuses edits earlier in the chain. The hook path cited on
line 59 is correct and matches §4.2.

Lines 55-56 themselves are `**Prettier:**` and `**CSS:**` style bullets — not merge
policy.

### 4.4 Stale counts in `.claude/agents/`, `.prompts/02-coverage.md`, `aegis-context/SKILL.md` — **MIXED: one stale, one hedged, one corrected-but-uncommitted**

Sweep command:

```
$ grep -rnE "[0-9]{2,4} (agents|rules|signatures|tests|modules|components|stores|utils|channels|IPC|files)|[0-9]{3,4} (passed|tests)|(agents|rules|signatures|tests|channels|IPC)[^0-9]{0,12}[0-9]{2,4}" \
    .claude/agents .prompts .claude/skills/aegis-context
.claude/agents/test-auditor.md:26:yourself; do not trust "707 tests / 44 files" or any number from the docs.
.claude/skills/aegis-context/SKILL.md:26:- Renderer (Svelte 5): src/renderer/ — 46 components + 11 stores + 16 utils via IPC bridge
.claude/skills/aegis-context/SKILL.md:27:- Bridge: src/main/preload.js — contextBridge, 40 invoke + 9 push = 49 channels
.claude/skills/aegis-context/SKILL.md:28:- Data: src/shared/agent-database.json (110 agents / 262 name signatures)
.claude/skills/aegis-context/SKILL.md:29:- Rules: rules/*.yaml — 73 active rules across 8 categories, validated against rules/_schema.json
.claude/skills/aegis-context/SKILL.md:32:- Tests: 1048 pass, 4 skip (1052 total) across 66 files (Vitest, all ESM)
```

**`.claude/skills/aegis-context/SKILL.md` — counts are CORRECT, but uncommitted.**
Every figure on lines 26-32 matches §2 of this document: 46 components, 11 stores,
16 utils, 40 invoke + 9 push = 49, 110 agents / 262 signatures, 73 rules across 8
files, 1048 pass / 4 skip / 1052 across 66 files. The file appears as ` M` in
`git status --short`, so those corrections exist only in the working tree. The diff
against `HEAD` confirms the corrections are part of the uncommitted work, not
pre-existing:

```
$ git diff HEAD -- .claude/skills/aegis-context/SKILL.md
-- Main process (Node.js): src/main/ — 44 CJS modules (35 top-level + 7 platform/ + 2 token-adapters/)
+- Main process (Node.js): src/main/ — 46 CJS modules (37 top-level + 7 platform/ + 2 token-adapters/)
...
-- Tests: 1034 pass, 4 skip (1038 total) across 65 files (Vitest, all ESM)
+- Tests: 1048 pass, 4 skip (1052 total) across 66 files (Vitest, all ESM)
```

At `HEAD` the file claims 44 CJS modules and 1034/4/1038 across 65 files; the
working-tree version claims 46 and 1048/4/1052 across 66. Both new figures count the
two untracked files (`src/main/audit-normalize.js`,
`tests/main/audit-schema-v1.test.js`, §2.3 / §2.4), so the working-tree SKILL.md
matches the working tree exactly and the `HEAD` version matches `HEAD`. The other
lines quoted above (46 components, 49 channels, 110/262, 73 rules) are unchanged by
this diff, i.e. they were already correct at `HEAD`.

**`.claude/agents/` — no stale asserted count; two hedged example numbers.**

```
$ ls .claude/agents
architecture-mapper.md  auditor.md  consistency-reviewer.md  researcher.md
security-reviewer.md    shipper.md  test-auditor.md          ui-designer.md
```

- `test-auditor.md:26` is **not** a stale count. It reads *"Trust code over docs.
  Derive the real test count and the real source surface yourself; do not trust
  '707 tests / 44 files' or any number from the docs."* — an instruction to
  distrust, not a claim.
- `consistency-reviewer.md` cites `"107"` (agent signatures) at `:7` and `:34`, and
  `"68"` (sensitive rules) at `:8` and `:36`. Both are explicitly hedged — `(e.g.
  "107")`, `"107" (or whatever the docs say)`, `"68" (or whatever the docs claim)` —
  so they are illustrative placeholders, not asserted counts. Reality: 262
  signatures across 110 agents, and 73 active rules in `rules/*.yaml`.
- The `"68"` figure does still correspond to something real, but to the deprecated
  array, not the live ruleset — see §4.5. The instruction at
  `consistency-reviewer.md:35-36` ("count SENSITIVE_RULES / patterns in
  constants.js") points at a structure no runtime code reads.
- No other numeric claim appears in `.claude/agents/`; the only remaining digits are
  the `300`-line file-size targets in `auditor.md:17` and `ui-designer.md:17`.

**`.prompts/02-coverage.md` — STALE.** Line 10 states the test suite is
**707 tests across 44 files**. Actual: 1048 passing / 4 skipped / 1052 total across
66 files (§2.4). The file is not UTF-8 — its Russian text renders as `?` through both
`grep` and the Read tool — so only the ASCII figures are quoted here rather than the
surrounding prose. Two further factual notes in the same file, verified against
`package.json`: line 25 proposes adding a `test:coverage` script, which now exists
(`"test:coverage": "vitest run --coverage"`); line 38's verify step uses
`npx tsc --noEmit`, which CLAUDE.md line 25 records as checking nothing (the root
`tsconfig.json` is a solution file).

### 4.5 `SENSITIVE_RULES` in `constants.js` read at runtime — **MISSING (no runtime reader)**

```
$ grep -rn "SENSITIVE_RULES" src/ tests/ --include=*.js --include=*.ts
src/main/rule-loader.js:9: *   as SENSITIVE_RULES in constants.js: { pattern: RegExp, reason: string }.
src/shared/constants.js:167:const SENSITIVE_RULES = [
src/shared/constants.js:424:  SENSITIVE_RULES,
tests/shared/constants.test.js:3:  SENSITIVE_RULES,
tests/shared/constants.test.js:12:  describe('SENSITIVE_RULES', () => {
tests/shared/constants.test.js:14:      for (const rule of SENSITIVE_RULES) {
tests/shared/constants.test.js:22:      const agentConfigRules = SENSITIVE_RULES.filter((r) => r.category === 'agent-config');
```

Four reference classes, none of them a runtime read:

- `constants.js:167` — the definition.
- `constants.js:424` — the `module.exports` entry.
- `rule-loader.js:9` — a **doc comment only**, describing the contract the YAML loader
  reproduces. Not a `require`.
- `tests/shared/constants.test.js` — the test suite, which imports it directly.

No module under `src/` destructures it. The only `constants` requires in `src/main`
pull other names:

```
$ grep -rn "require('../shared/constants')\|require('./constants')\|from '.*constants" src/ --include=*.js --include=*.ts --include=*.svelte
src/main/config-manager.js:20:const { PERMISSION_CATEGORIES } = require('../shared/constants');
src/main/file-watcher.js:27:} = require('../shared/constants');
src/main/process-scanner.js:18:const { IGNORE_PROCESS_PATTERNS, EDITOR_HOSTS } = require('../shared/constants');
src/main/process-utils.js:16:const { EDITORS } = require('../shared/constants');
```

Size and deprecation marker (`src/shared/constants.js:164-167`):

```
$ node -e "const c=require('./src/shared/constants.js'); console.log(c.SENSITIVE_RULES.length)"
68
```

```js
// @deprecated — use rule-loader.js instead. Will be removed in v0.7.0-alpha.
// Kept for backward compatibility during migration.
/** @type {readonly BuiltinSensitiveRule[]} Rules that classify a file path as sensitive */
const SENSITIVE_RULES = [
```

68 entries. The stated removal target was `v0.7.0-alpha`; `package.json` reads
`0.10.0-alpha`.

---

## 5. Gates — raw output

All five run from `X:/Future/ESCAPE/AEGIS` against the dirty working tree described
at the top of this document, i.e. including the 19 modified and 4 untracked paths.

**Script substitutions, stated explicitly.** `package.json` has no `tsc main config` /
`tsc renderer config` script under those names; the real ones are
`typecheck:main` → `tsc --noEmit -p tsconfig.main.json` and
`typecheck:renderer` → `tsc --noEmit -p tsconfig.renderer.json`, and those exact
commands were run. `npm run build` maps to `electron-builder --publish never` (the
NSIS installer), while CLAUDE.md's documented pre-commit build gate is
`npm run build:renderer` (`vite build`) — both were run and both are shown.

### Gate 1 — `npx vitest run`

```
$ NO_COLOR=1 npx vitest run 2>&1 | tail -12
 ✓ |renderer| tests/renderer/risk.test.ts (7 tests) 11ms
 ✓ |renderer| tests/renderer/acknowledged.test.js (6 tests) 6ms
 ✓ |components| tests/renderer/components/Sparkline.test.ts (9 tests) 50ms
 ✓ |components| tests/renderer/components/SkeletonLoader.test.ts (5 tests) 225ms
 ✓ |components| tests/renderer/components/RiskRing.test.ts (10 tests) 293ms
 ✓ |components| tests/renderer/components/TrustBadge.test.ts (10 tests) 312ms

 Test Files  66 passed (66)
      Tests  1048 passed | 4 skipped (1052)
   Start at  01:32:16
   Duration  6.53s (transform 6.85s, setup 6.34s, import 11.81s, tests 7.88s, environment 15.58s)

EXIT=0
```

**Coverage of the gate:** 66 of 66 test files executed, 1052 test cases collected,
4 skipped. The suite is not empty and nothing was filtered out.

### Gate 2 — `tsc` main config

```
$ npx tsc --noEmit -p tsconfig.main.json
EXIT=0
```

**Coverage of the gate** (ai-mistakes #21 — a green `tsc` on an empty file set proves
nothing):

```
$ npx tsc --noEmit -p tsconfig.main.json --listFiles 2>/dev/null | grep -v node_modules | wc -l
56
```

56 non-`node_modules` files type-checked. The project is not empty.

### Gate 3 — `tsc` renderer config

```
$ npx tsc --noEmit -p tsconfig.renderer.json
EXIT=0
```

**Coverage of the gate:**

```
$ npx tsc --noEmit -p tsconfig.renderer.json --listFiles 2>/dev/null | grep -v node_modules | wc -l
44
```

44 non-`node_modules` files type-checked. This is the project that PR #184 fixed
after it had been checking 0 files; it is now non-empty.

### Gate 4 — `npx eslint src/`

```
$ npx eslint src/
X:\Future\ESCAPE\AEGIS\src\main\audit-logger.js
  103:5   warning  Unexpected console statement  no-console
  153:5   warning  Unexpected console statement  no-console
  368:13  warning  Unexpected console statement  no-console
  374:5   warning  Unexpected console statement  no-console
  429:5   warning  Unexpected console statement  no-console
  476:5   warning  Unexpected console statement  no-console
  581:5   warning  Unexpected console statement  no-console

X:\Future\ESCAPE\AEGIS\src\main\logger.js
   50:5   warning  Unexpected console statement  no-console
   73:5   warning  Unexpected console statement  no-console
  142:5   warning  Unexpected console statement  no-console
  165:13  warning  Unexpected console statement  no-console
  171:5   warning  Unexpected console statement  no-console
  206:5   warning  Unexpected console statement  no-console
  237:5   warning  Unexpected console statement  no-console

X:\Future\ESCAPE\AEGIS\src\main\rule-loader.js
   86:7   warning  Unexpected console statement  no-console
   92:7   warning  Unexpected console statement  no-console
  102:5   warning  Unexpected console statement  no-console
  115:9   warning  Unexpected console statement  no-console
  121:11  warning  Unexpected console statement  no-console
  140:11  warning  Unexpected console statement  no-console
  146:7   warning  Unexpected console statement  no-console

X:\Future\ESCAPE\AEGIS\src\renderer\App.svelte
  287:9  warning  Unexpected console statement  no-console

X:\Future\ESCAPE\AEGIS\src\renderer\lib\components\Timeline.svelte
  104:7  warning  Unexpected console statement  no-console

✖ 23 problems (0 errors, 23 warnings)

EXIT=0
```

0 errors, 23 `no-console` warnings across 5 files.

### Gate 5a — `npm run build:renderer` (CLAUDE.md's documented build gate)

```
$ NO_COLOR=1 npm run build:renderer

> aegis@0.10.0-alpha build:renderer
> vite build

01:32:30 [vite-plugin-svelte] no Svelte config found at X:/Future/ESCAPE/AEGIS/src/renderer - using default configuration.
vite v7.3.1 building client environment for production...
transforming...
✓ 231 modules transformed.
rendering chunks...
computing gzip size...
../../dist/renderer/index.html                                     0.39 kB │ gzip:  0.27 kB
../../dist/renderer/assets/dm-mono-400-latin-ext-C2zvOubV.woff2    9.55 kB
../../dist/renderer/assets/dm-mono-500-latin-ext-BtRyHRi6.woff2    9.62 kB
../../dist/renderer/assets/outfit-latin-ext-DdQaqQDo.woff2        14.81 kB
../../dist/renderer/assets/dm-mono-400-latin-4GdczIuU.woff2       14.82 kB
../../dist/renderer/assets/dm-mono-500-latin-DRMDZjhP.woff2       14.99 kB
../../dist/renderer/assets/dm-sans-latin-ext-BOFOeGcA.woff2       18.23 kB
../../dist/renderer/assets/outfit-latin-Bc-8i84L.woff2            32.29 kB
../../dist/renderer/assets/dm-sans-latin-Xz1IZZA0.woff2           36.93 kB
../../dist/renderer/assets/index-CR_pBaeL.css                    104.23 kB │ gzip: 14.63 kB
../../dist/renderer/assets/agent-database-DLClq9pP.js             47.90 kB │ gzip:  9.80 kB
../../dist/renderer/assets/index-Ozh5tBUp.js                     193.00 kB │ gzip: 63.76 kB
✓ built in 1.79s
EXIT=0
```

231 modules transformed — the build is not a no-op.

### Gate 5b — `npm run build` (electron-builder NSIS installer)

```
$ npm run build

> aegis@0.10.0-alpha build
> electron-builder --publish never

  • electron-builder  version=26.8.1 os=10.0.26200
  • loaded configuration  file=package.json ("build" field)
  • executing @electron/rebuild  electronVersion=33.4.11 arch=x64 buildFromSource=false workspaceRoot=X:\Future\ESCAPE\AEGIS projectDir=./ appDir=./
  • installing native dependencies  arch=x64
  • completed installing native dependencies
  • packaging       platform=win32 arch=x64 electron=33.4.11 appOutDir=dist\win-unpacked
  • searching for node modules  pm=npm searchDir=X:\Future\ESCAPE\AEGIS
(node:21220) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
  • duplicate dependency references  dependencies=["is-glob@4.0.3"]
  • updating asar integrity executable resource  executablePath=dist\win-unpacked\AEGIS - AI Monitoring & Threat Detection.exe
  • signing with signtool.exe  path=dist\win-unpacked\AEGIS - AI Monitoring & Threat Detection.exe
  • building        target=nsis file=dist\AEGIS - AI Monitoring & Threat Detection Setup 0.10.0-alpha.exe archs=x64 oneClick=true perMachine=false
  • signing with signtool.exe  path=dist\win-unpacked\resources\elevate.exe
  • signing with signtool.exe  path=dist\AEGIS - AI Monitoring & Threat Detection Setup 0.10.0-alpha.__uninstaller.exe
  • signing with signtool.exe  path=dist\AEGIS - AI Monitoring & Threat Detection Setup 0.10.0-alpha.exe
  • building block map  blockMapFile=dist\AEGIS - AI Monitoring & Threat Detection Setup 0.10.0-alpha.exe.blockmap
EXIT=0
```

All five gates exit 0. Output landed in `dist/`, which is gitignored (see §1), so no
build artifact appears in `git status`.

---

## 6. DONE-WHEN criterion 5 — not met, and it could not be

> *"`git status --short` shows exactly one new file and zero modified files"*

The **one new file** half is met: this recon added exactly one path,
`docs/current-state/STATE-RECON.md`.

The **zero modified files** half was already false before the recon began. The tree
carried 19 modified tracked files and 4 untracked paths on entry (§1), all from
in-progress work on `feat/event-schema-v1`. Reaching zero would require reverting
that work, which the task's own constraint — *change no code, fix nothing, delete
nothing* — forbids. This is a property of the starting state, not an artifact of the
recon.

---

## 7. Not determined

- **Whether the other 18 `M`-marked files agree with `HEAD`.** Everything in §2 was
  measured against the working tree. `.claude/skills/aegis-context/SKILL.md` was the
  one file step 4 named, and it *was* diffed against `HEAD` (§4.4). The remaining
  modified files — `CLAUDE.md`, `README.md`, `AGENTS.md`, `llms.txt`, `llms-full.txt`,
  the two other skill files, and the source/test files — were not diffed, so whether
  any count inside them drifted is unknown. `CLAUDE.md`'s working-tree numbers do
  match §2, but its `HEAD` version was not read.
- **Prose content of `.prompts/02-coverage.md`.** The file is not UTF-8; its Russian
  text decodes to `?` through both `grep` and the Read tool. Only the ASCII figures
  and command strings could be verified. The precise encoding was not identified.
- **Whether `cwdCache`, `resource-monitor._cache` and `eventsByPid` cause an
  observable defect.** §3.3 establishes the key form from source. No runtime
  reproduction was attempted — the task is read-only and forbids proposing a
  migration.
- **Whether the GitHub branch protection described in `AGENTS.md:59`** (required PR,
  green `audit`/`build`/`lint`/`svelte-check`/`test`, admin enforcement) is actually
  configured on the remote. Only the local hook was verified; confirming the remote
  ruleset would need a `gh api` call against GitHub, which is outside a read-only
  local recon.
- **Skipped tests.** Vitest reports 4 skipped; which files and why was not
  investigated, as the task asked only for the count.
