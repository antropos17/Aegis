INCOMPLETE

# Event Schema v1 — status of the uncommitted work on `feat/event-schema-v1`

> Read-only status report. No source file, test, or config was touched. Nothing was
> committed, stashed, checked out, reset, or cleaned. The only write this document made is
> this file itself.
>
> Branch: `feat/event-schema-v1`. `HEAD` = `743e330` (Merge pull request #187).
> Version: `0.10.0-alpha`.

## Verdict

**INCOMPLETE.**

The write path is fully converted and the read path is wired, but the schema change is not
finished end to end:

- `ARCHITECTURE.md:95` still documents the pre-v1 record shape and is not among the
  modified files, so the repository's architecture document now describes a format the code
  no longer writes.
- The read normalizer is on the live path, but every field it adds is discarded by the only
  consumer (§3).
- Several v1 invariants are stated in prose but not enforced or tested (§4).

It is **not** MIXED. Every modified file carries work that this block caused. Three doc
lines also absorb pre-existing truth-sync (`ipc-handlers.js 498 → 503`, `35 → 37` top-level
modules of which one predates this work) — but that correction sits on the *same line* that
v1 forced a rewrite of, so it is not separable drift; it is incidental truth-sync riding a
line this block had to touch anyway. See the "Note" column in §1.

## 1. The 19 modified files

| File | What changed | Event Schema v1? |
|---|---|---|
| `.claude/rules/code-quality.md` | Largest-file list: adds `audit-logger.js 600`, corrects `ipc-handlers.js 498 → 503` | Yes — `audit-logger.js` crossed 600 lines in this block (note: the `498 → 503` half is pre-existing truth-sync on the same line) |
| `.claude/skills/aegis-context/SKILL.md` | Module count `44 → 46`, test count `1034/1038/65 → 1048/1052/66` | Yes — both figures count `audit-normalize.js` and `audit-schema-v1.test.js` (note: `35 → 37` top-level includes one module that was already miscounted at `HEAD`) |
| `.claude/skills/electron-main/SKILL.md` | Module count `44 → 46` (`35 → 37` top-level) | Yes — same reason |
| `.claude/skills/testing/SKILL.md` | `65 files, 1034 pass, 4 skip (1038)` → `66 / 1048 / 4 / 1052` | Yes — the new test file adds 14 cases |
| `AGENTS.md` | Same largest-file line as `code-quality.md` | Yes — same reason |
| `CLAUDE.md` | Test count in Commands, largest-file line in rule 3, module count in Key Paths | Yes — same reason |
| `CONTRIBUTING.md` | `1034 tests across 65 files` → `1048 / 66` | Yes |
| `README.md` | Test count in badge, stat table, Stack line, FAQ (`1034 → 1048`, `65 → 66` files) | Yes |
| `llms.txt` | `1034 passing, 4 skipped across 65 files` → `1048 / 4 / 66` | Yes |
| `llms-full.txt` | Same line as `llms.txt` | Yes |
| `src/main/attribution.js` | New evidence code `os-tcp-owner-pid`; added to `EVIDENCE`, to `PID_EVIDENCE` (→ `confirmed`), and documented in the header | Yes — it is what lets a network-connection record carry a real attribution |
| `src/main/audit-drop-tracker.js` | `buildMarker(nowIso)` → `buildMarker(nowIso, schemaVersion)`; marker gains `schemaVersion`, `pid: null`, `instanceId: null`, `attribution: null` | Yes — the internally-generated record must carry the v1 field set too |
| `src/main/audit-logger.js` | `SCHEMA_VERSION = 1`; `log()` stamps `schemaVersion` and writes `pid` / `instanceId` / `attribution` top-level; `getEntriesBefore()` normalizes; `exportAll()` stays raw; exports `normalizeAuditEntry` + `SCHEMA_VERSION` | Yes — this is the core of the block |
| `src/main/network-monitor.js` | Unmatched connection now yields `agent: ''` instead of a synthesized `PID <n>` label (C-01) | Yes — a fabricated name beside an attribution status would dress a guess as a resolved owner |
| `src/main/scan-loop.js` | All five `audit.log()` call sites converted: identity and attribution moved out of `extra` to top level; `makeAttribution` used for network events; `attribution: null` for agent-enter/exit/anomaly | Yes — this is the producer side of the change |
| `src/shared/types/events.ts` | Adds `os-tcp-owner-pid` to `AttributionEvidence`; adds `AuditEventType`, `AuditRecordV1`, `AuditRecordV0`, `AuditRecord`, `NormalizedAttribution` | Yes |
| `tests/main/file-watcher-attribution.test.js` | Closed-list assertion updated from six to seven evidence codes | Yes |
| `tests/main/network-monitor.test.js` | `PID 999` expectation replaced with `agent === ''` plus a `pid === 999` assertion | Yes |
| `tests/main/scan-loop.test.js` | Four expectations rewritten from `extra: {attribution: '<status>'}` to top-level `pid` / `instanceId` / full `attribution` object | Yes |

Untracked files belonging to the block: `src/main/audit-normalize.js` (65 lines),
`tests/main/audit-schema-v1.test.js` (252 lines, 14 cases).

## 2. The v1 event shape

Written by `src/main/audit-logger.js:213-232` (`log()`), then `flush()`
(`audit-logger.js:280`) appends `seq` and `hash`. Typed as `AuditRecordV1` in
`src/shared/types/events.ts:134-151`.

| Field | Source in `log(type, details)` | Required on disk | Null / empty semantics |
|---|---|---|---|
| `schemaVersion` | constant `SCHEMA_VERSION = 1` (`audit-logger.js:54`) | Always present | Absent ⇒ v0 record — but only if the line parses and its hash verifies; a parse failure is a corrupt write, not a legacy record |
| `timestamp` | `new Date().toISOString()` | Always present | — |
| `type` | `type` argument | Always present | Not validated at runtime; the `AuditEventType` union (`events.ts:103-111`) is the enforced boundary for typed consumers only |
| `agent` | `details.agent \|\| ''` | Always present | `''` = unattributed or internally generated. Never fabricated (C-01) |
| `pid` | `details.pid ?? null` | Always present | `null` = no OS pid observed. `0` is a **real** value (synthetic / process-less agent), which is why `??` is used and not `\|\|` |
| `instanceId` | `details.instanceId ?? null` | Always present | `null` = no process identity at the call site. Never derived by joining on a name |
| `action` | `details.action \|\| ''` | Always present | — |
| `path` | `details.path \|\| ''` | Always present | — |
| `severity` | `details.severity \|\| 'normal'` | Always present | — |
| `riskScore` | `details.riskScore \|\| 0` | Always present | Documented as vestigial, always 0 in v1 — see gap 5 |
| `attribution` | `details.attribution ?? null` | Always present | `null` = the ownership question does **not apply**. Categorically different from `{status: 'unattributed'}` = question applies, owner unknown |
| `details` | `details.extra \|\| null` | Always present | Event-specific extras only; identity no longer lives here |
| `seq`, `hash` | added by `flush()` (`audit-logger.js:280`) | Always present | — |

Optional at the *call site*: `agent`, `pid`, `instanceId`, `action`, `path`, `severity`,
`riskScore`, `attribution`, `extra` — each has a default above. Only `type` is positional
and unavoidable. On disk every field is always present.

The loss marker (`buildMarker`, `audit-drop-tracker.js:106-126`) writes the same field set
with `agent: ''`, `pid: null`, `instanceId: null`, `attribution: null`, and receives
`schemaVersion` from its single caller `audit-logger.js:312` so the version constant lives
in one place.

**Where the normalizer is called from:** `src/main/audit-normalize.js:46`
(`normalizeAuditEntry`) has exactly one production call site —
`src/main/audit-logger.js:571`, inside `getEntriesBefore()`. It is also re-exported at
`audit-logger.js:598`, and imported directly by
`tests/main/audit-schema-v1.test.js:16`. `exportAll()` (`audit-logger.js:454`) deliberately
does **not** call it — the JSDoc directly above it, `audit-logger.js:443-453`, states why:
export is the forensic path and must show what is on disk.

## 3. Is the normalizer wired into the live path?

**Yes — it is on the live IPC read path, but its output is discarded by the only consumer.**

Evidence chain, file and line:

1. `src/main/audit-logger.js:571` — `results.push(normalizeAuditEntry(entry));` inside
   `getEntriesBefore()`. This is the call site, not a test hook.
2. `src/main/ipc-handlers.js:273` — `audit.getEntriesBefore(beforeTs, limit)` behind the
   `get-audit-entries-before` handler.
3. `src/main/preload.js:58` — `getAuditEntriesBefore` exposed over `contextBridge`.
4. `src/renderer/lib/components/Timeline.svelte:89` — `await
   window.aegis.getAuditEntriesBefore(oldest, HISTORY_BATCH)`, mapped through
   `auditToTimelineEvent` at `Timeline.svelte:95`.

So the normalizer runs in production whenever the Timeline scrolls back into history.

What it is **not** wired into:

- `audit-logger.js` write path — correct by design; the normalizer is read-side only.
- `scan-loop.js` — correct by design; it is a producer.
- `network-monitor.js` — correct by design; it never touches audit records.
- `exportAll()` / the ZIP export (`ipc-handlers.js:282`, `:368`) — deliberate, documented
  at `audit-logger.js:443-453`.

The consumer discards the result: `src/renderer/lib/utils/timeline-utils.ts:112-119`
declares its own local `AuditEntry` interface holding only
`{timestamp, type, agent, severity, action, path}`, and `auditToTimelineEvent`
(`timeline-utils.ts:122-143`) reads nothing else. `pid`, `instanceId` and `attribution` —
the three fields the normalizer exists to supply — are dropped on the floor.

## 4. What is missing for the block to be complete

1. **`ARCHITECTURE.md:95` documents the v0 record shape.** It states each entry is
   `{timestamp, type, agent, action, path, severity, riskScore, details, seq, hash}` — no
   `schemaVersion`, no `pid`, no `instanceId`, no `attribution`. The file is not among the
   19 modified. This is ai-mistakes #20's exact failure mode: a reader can act on it.
2. **The normalizer's output has no consumer.** `timeline-utils.ts:112-119` pins a local
   six-field `AuditEntry` that does not reference `AuditRecordV1` from
   `src/shared/types/events.ts`. Until it does, `normalizeAuditEntry` costs work on every
   history page and changes nothing a user can see.
3. **Historical timeline dots carry no pid.** `Timeline.svelte:253` and `:265` use
   `dot.pid` (tooltip text and `focusedAgentPid`), but `auditToTimelineEvent` never sets
   `pid`, so records that now *do* carry a top-level pid still produce pid-less dots.
4. **`instanceId` is hard-coded `null` for the two highest-volume event types.**
   `scan-loop.js:85` (file-access / config-access) and `scan-loop.js:146`
   (network-connection). Both are documented as deliberate — deriving an identity outside
   the tick that produced the event is the cross-tick pid-reuse trap of ai-mistakes #19 —
   but the field is therefore always null for those producers. Closing it needs
   `file-watcher.js` and `network-monitor.js` to stamp `instanceId` at the source.
5. **`riskScore` is documented as an invariant but not enforced.** `audit-logger.js:208`
   ("Vestigial; always 0 in v1") and `events.ts:145` ("always 0 in v1") both assert it,
   while `audit-logger.js:227` still writes `details.riskScore || 0`. Any caller passing a
   non-zero `riskScore` silently breaks the documented invariant. No test pins it.
6. **`buildMarker` has no guard on its new parameter.** `audit-drop-tracker.js:106` takes
   `schemaVersion` with no default and no validation. `JSON.stringify` drops `undefined`,
   so a caller that omits the argument writes a marker with no `schemaVersion` — a v0-shaped
   record produced by v1 code, silently. There is exactly one caller today
   (`audit-logger.js:312`) and no test that calls `buildMarker` directly.
7. **`permission-deny` is in the type union but emitted by nothing.** Declared at
   `events.ts:110`, consumed by the renderer at `timeline-utils.ts:98` and `:139`. No
   `src/` code path produces it, and `ROADMAP.md` does not mention it — so it is not a
   planned later block, it is a declared-but-unbuilt event type sitting inside the union
   this work introduced. The union comment explains the decision to keep it.
8. **No test asserts the full v1 field set of a written record.** `audit-schema-v1.test.js`
   checks individual fields (`schemaVersion`, `pid`, `instanceId`, `attribution`, `details`)
   but never the complete key list, so a field silently added or dropped by `log()` would
   not fail any test.
9. **No test covers `getEntriesBefore` returning a *v1* record through the normalizer.**
   `audit-schema-v1.test.js:157-188` exercises the v0 branch on the paginated path; the v1
   pass-through is only tested through the direct unit call at `:192-195`.
10. **Producers still emitting the old shape: none.** All five `audit.log()` call sites in
    `src/` (`scan-loop.js:79`, `:140`, `:230`, `:247`, `:268`) were converted, and
    `file-watcher.js` builds the full `{status, evidence[]}` object via `makeAttribution`
    (`file-watcher.js:230`, `:402`, `:519`) that `scan-loop.js:93` now forwards wholesale.
    There is no other producer. Listed here so the absence is on the record.
11. **Consumers still reading old field names: none.** No file under `src/renderer/` reads
    `details.pid`, `details.instanceId` or `details.attribution`. The two `?.attribution`
    reads (`events-index.ts:24`, `risk.ts:97`) are on live `FileEvent` objects, not audit
    records, and were already top-level. Listed here so the absence is on the record.

## 5. `.agents/` and `.codex/` — intentional

**Both are intentional. Neither was deleted, and neither belongs to Event Schema v1.**

`.codex/` — Codex-side agent fleet: eight `.toml` agent definitions mirroring the eight
`.claude/agents/*.md` (architecture-mapper, auditor, consistency-reviewer, researcher,
security-reviewer, shipper, test-auditor, ui-designer), plus `hooks.json` and
`hooks/branch-guard.js`.

`.agents/` — a Codex-targeted port of `.claude/skills/`: all eleven skills present, same
filenames. Not a byte copy — a deliberate adaptation. Three of eleven differ, and the
differences are the port itself:

- `aegis-context/SKILL.md:54,60` — `## Skills (.claude/skills/)` → `(.Codex/skills/)`;
  "prompt formula for Claude Code and Antigravity" → "for Codex and Antigravity".
- `audit-check/SKILL.md:18` — `.claude/agents/, .claude/skills/` → `.Codex/agents/,
  .Codex/skills/`.
- `prompt-craft/SKILL.md:3,8,108` — "Claude Code or Antigravity" → "Codex or Antigravity";
  "README, CLAUDE.md" → "README, AGENTS.md".

The other eight mirrors are byte-identical to the **working tree**, including
`electron-main/SKILL.md` and `testing/SKILL.md` which this block modified — so the mirror
was taken after those edits.

Fact, not inference: `.gitignore` ignores `.agent/` (singular, line 34). Neither `.agents/`
nor `.codex/` matches that pattern, which is why both appear as untracked rather than
ignored. Whether they are meant to be committed or added to `.gitignore` is a decision
nobody has recorded; this report does not make it.

## 6. Gates — raw output

The same five gates STATE-RECON.md §"Gate 1"–§"Gate 5a" runs, in the same order: `npm test`,
`tsc -p tsconfig.main.json`, `tsc -p tsconfig.renderer.json`, `npm run lint`,
`npm run build:renderer`. `npm run format:check` is deliberately not among them, matching
that precedent.

All five exit 0. Gate output landed in `dist/`, which `.gitignore` covers, so the build
added nothing to `git status`.

### Gate 1 — `npm test`

```
$ NO_COLOR=1 npm test
 ✓ |renderer| tests/renderer/threat-report.test.js (8 tests) 41ms
 ✓ |main| tests/main/cli.test.js (6 tests) 14ms
 ✓ |main| tests/main/process-scanner-eperm.test.js (7 tests) 16ms
 ✓ |main| tests/main/platform/index.test.js (3 tests) 5ms
 ✓ |renderer| tests/renderer/command-registry.test.ts (16 tests) 22ms
 ✓ |renderer| tests/renderer/agent-stats-utils.test.js (18 tests) 33ms
 ✓ |renderer| tests/renderer/format-bytes.test.js (25 tests) 14ms
 ✓ |main| tests/main/process-scanner.test.js (9 tests) 18ms
 ✓ |renderer| tests/renderer/risk-scoring.test.js (25 tests) 13ms
 ✓ |renderer| tests/renderer/fuzzy-search.test.ts (16 tests) 15ms
 ✓ |renderer| tests/renderer/anomaly-toast-tracker.test.js (12 tests) 12ms
 ✓ |renderer| tests/renderer/trust-badge-utils.test.js (17 tests) 10ms
 ✓ |renderer| tests/renderer/risk-ring-utils.test.js (12 tests) 9ms
 ✓ |renderer| tests/renderer/ring-buffer.test.js (7 tests) 12ms
 ✓ |renderer| tests/renderer/sparkline-utils.test.js (10 tests) 12ms
 ✓ |renderer| tests/renderer/grouped-feed-utils.test.ts (3 tests) 12ms
 ✓ |renderer| tests/renderer/toast.test.js (17 tests) 22ms
 ✓ |renderer| tests/renderer/demo-data.test.js (11 tests) 23ms
 ✓ |renderer| tests/renderer/risk.test.ts (7 tests) 13ms
 ✓ |renderer| tests/renderer/acknowledged.test.js (6 tests) 7ms
 ✓ |components| tests/renderer/components/Sparkline.test.ts (9 tests) 58ms
 ✓ |components| tests/renderer/components/SkeletonLoader.test.ts (5 tests) 223ms
 ✓ |components| tests/renderer/components/RiskRing.test.ts (10 tests) 298ms
 ✓ |components| tests/renderer/components/TrustBadge.test.ts (10 tests) 305ms

 Test Files  66 passed (66)
      Tests  1048 passed | 4 skipped (1052)
   Start at  01:46:41
   Duration  6.70s (transform 7.31s, setup 5.86s, import 13.01s, tests 7.41s, environment 16.44s)

EXIT=0
```

Output truncated to the tail; 66 of 66 test files ran, 1052 cases collected. The new file
`tests/main/audit-schema-v1.test.js` contributes 14 of them, which is exactly the delta the
doc counts in §1 claim (`1034 → 1048`).

### Gate 2 — `npx tsc --noEmit -p tsconfig.main.json`

```
$ npx tsc --noEmit -p tsconfig.main.json
EXIT=0
```

Coverage of the gate (ai-mistakes #21 — a green `tsc` on an empty file set proves nothing):

```
$ npx tsc --noEmit -p tsconfig.main.json --listFiles 2>/dev/null | grep -v node_modules | wc -l
56
```

56 non-`node_modules` files type-checked. `src/main/audit-normalize.js` is inside that set
via `allowJs`; note `checkJs: false` means its body is not type-checked, only its
participation.

### Gate 3 — `npx tsc --noEmit -p tsconfig.renderer.json`

```
$ npx tsc --noEmit -p tsconfig.renderer.json
EXIT=0
```

Coverage of the gate:

```
$ npx tsc --noEmit -p tsconfig.renderer.json --listFiles 2>/dev/null | grep -v node_modules | wc -l
44
```

44 non-`node_modules` files type-checked — the project PR #184 fixed after it had been
checking nothing.

### Gate 4 — `npm run lint`

```
$ NO_COLOR=1 npm run lint

X:\dev\project\AEGIS\src\main\audit-logger.js
  103:5   warning  Unexpected console statement  no-console
  153:5   warning  Unexpected console statement  no-console
  368:13  warning  Unexpected console statement  no-console
  374:5   warning  Unexpected console statement  no-console
  429:5   warning  Unexpected console statement  no-console
  476:5   warning  Unexpected console statement  no-console
  581:5   warning  Unexpected console statement  no-console

X:\dev\project\AEGIS\src\main\logger.js
   50:5   warning  Unexpected console statement  no-console
   73:5   warning  Unexpected console statement  no-console
  142:5   warning  Unexpected console statement  no-console
  165:13  warning  Unexpected console statement  no-console
  171:5   warning  Unexpected console statement  no-console
  206:5   warning  Unexpected console statement  no-console
  237:5   warning  Unexpected console statement  no-console

X:\dev\project\AEGIS\src\main\rule-loader.js
   86:7   warning  Unexpected console statement  no-console
   92:7   warning  Unexpected console statement  no-console
  102:5   warning  Unexpected console statement  no-console
  115:9   warning  Unexpected console statement  no-console
  121:11  warning  Unexpected console statement  no-console
  140:11  warning  Unexpected console statement  no-console
  146:7   warning  Unexpected console statement  no-console

X:\dev\project\AEGIS\src\renderer\App.svelte
  287:9  warning  Unexpected console statement  no-console

X:\dev\project\AEGIS\src\renderer\lib\components\Timeline.svelte
  104:7  warning  Unexpected console statement  no-console

✖ 23 problems (0 errors, 23 warnings)

EXIT=0
```

0 errors, 23 pre-existing `no-console` warnings across 5 files. None of them is new to this
block — `audit-logger.js`'s seven are all in `catch` blocks that predate v1.

### Gate 5 — `npm run build:renderer`

```
$ NO_COLOR=1 npm run build:renderer

> aegis@0.10.0-alpha build:renderer
> vite build

01:47:28 [vite-plugin-svelte] no Svelte config found at X:/dev/project/AEGIS/src/renderer - using default configuration.
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
✓ built in 1.36s
EXIT=0
```

## 7. Working tree after this report

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
?? docs/current-state/
?? src/main/audit-normalize.js
?? tests/main/audit-schema-v1.test.js
```

The same 19 modified files as before, unchanged. The one new file this report adds —
`docs/current-state/EVENT-SCHEMA-STATUS.md` — produces **no new line** in
`git status --short`, because `docs/current-state/` was already untracked and git collapses
an untracked directory to a single entry. It is visible only with `-uall`:

```
$ git status --short --untracked-files=all | grep docs/current-state
?? docs/current-state/EVENT-SCHEMA-STATUS.md
?? docs/current-state/STATE-RECON.md
```

## 8. Not determined

- Whether `.agents/` and `.codex/` are meant to be committed or added to `.gitignore`.
  Both are clearly intentional artifacts; the tracking decision is unrecorded anywhere in
  the repository, and this report does not make it.
- Whether the `1034 → 1048` doc figures were verified against a run or written by hand at
  the time of the edit. They match the run in Gate 1, so they are correct now; how they were
  arrived at is not recoverable from the working tree.
- Whether the `permission-deny` type was left in the union for a producer someone intends
  to write. `ROADMAP.md` contains no mention of it and the comment at `events.ts:95-98`
  gives only the renderer-compatibility reason, so no intent beyond that is recorded
  anywhere findable.
- Whether any pre-v1 daily audit file exists on this machine to exercise the normalizer
  against real v0 data. `%APPDATA%` was not inspected — reading a user's real audit logs was
  not part of the task.
