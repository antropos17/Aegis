# AEGIS Correctness Audit (Read-Only)

**Audit date:** 2026-08-08 — branch `feat/identity-main`, version `0.10.0-alpha` at audit time.
**Re-verified against:** `master` @ `d027f0c`, 2026-08-13. This is the state in which the file
entered git, five days and several correctness blocks after the audit ran.

**Auditor stance:** external reader of a codebase I did not write. No production source was left
modified. One temporary break of `bindWatcherEvents` was applied, tests re-run, then the file was
restored.

## How to read this document

The audit is a dated snapshot; master moved under it. Rather than publish a snapshot whose
present-tense claims are now false, every finding below was re-checked against `d027f0c` and
carries one of three statuses:

| Status | Meaning |
|---|---|
| **OPEN** | Still present at `d027f0c`. The mechanism and the falsification test still apply. |
| **CLOSED** | Fixed in code or tests since the audit. Kept as a one-line record with the evidence that closes it — the full disposition lives in `memory-bank/progress.md`. |
| **BY DESIGN** | Behaviour unchanged, but the code now states the rationale in place. Not an unfixed defect; do not re-file it as one. |

Line numbers in OPEN findings were re-anchored at `d027f0c`. Line numbers inside CLOSED entries
were not re-anchored — they describe a tree that no longer exists and are kept only so the original
observation stays traceable.

**Gates:**

| When | Command | Result |
|---|---|---|
| 2026-08-08 (audit) | `npm test` | exit 0 |
| 2026-08-08 (audit) | `npm run lint` | 0 errors, 23 pre-existing `no-console` warnings |
| 2026-08-13 (re-verify) | `npm run test:coverage` | exit 0 |

Suite counts are deliberately not quoted: a hand-copied count is true only until the next merge and
nothing goes red when it stops being true (`memory-bank/ai-mistakes.md` #24). `tsc` / typecheck is
not evidence for `src/main/*.js` (`checkJs: false`).

**Ranking key:** wrong output (user sees an untrue number or label) → evidence loss → silent failure
→ inventory / doc drift.

---

## Method summary (as executed 2026-08-08)

1. Counted rules, agents, signatures, modules, IPC channels, components, tests by command.
2. Traced file events (chokidar + handle/RM scan → activityLog → dedup → IPC/audit → renderer stores
   → pixels) and network connections (OS table → DNS → classify → baselines/audit/IPC → risk).
3. Checked identity/attribution invariants against `process-identity.js`, `attribution.js`, maps in
   main and renderer.
4. Read audit logger flush, buffer cap, hash chain, and failure paths.
5. Sampled tests for vacuity; **proved** one class by removing `bindWatcherEvents` subscriptions
   (93 file-watcher tests stayed green), then restored the file.

---

## Ground truth (counts re-measured at `fa85837`, 2026-08-21)

The audit's original table compared documented figures against a 2026-08-08 tree and marked five
rows "match". Four of those figures have since moved. The table below is a fresh measurement, not
the audit's; each row carries the command that produced it. Every row except the attribution
evidence codes is now re-derived on each CI run by `npm run counts:check`, which fails the `test`
job when a tracked file declares a different number — those rows stop being a snapshot somebody
has to remember to redo. The evidence-code row is not covered and still is one.

| Quantity | Command | Measured |
|---|---|---|
| Agents | `node -p` over `src/shared/agent-database.json` | **110** |
| Name signatures | sum of `names[]` in the same file | **262** |
| Rules / YAML files | `- id:` matches in `rules/*.yaml`; `git ls-files 'rules/'` | **73** / **8** |
| main CJS modules | `git ls-files 'src/main/'` split by depth | **54** = 42 top-level + 10 `platform/` + 2 `token-adapters/` |
| Svelte components | `git ls-files 'src/renderer/lib/components/*.svelte'` | **47** (plus `src/renderer/App.svelte` → **48** tracked `.svelte` in total) |
| Renderer stores | `git ls-files 'src/renderer/lib/stores/'` | **13** files (4 of them demo-only) |
| Renderer utils | `git ls-files 'src/renderer/lib/utils/'` | **21** files |
| Shared types | `.ts` under `src/shared/types` | **8** |
| IPC surface | `ipcRenderer.invoke` / `ipcRenderer.on` in `src/main/preload.js` | **40 invoke + 9 push = 49** |
| Attribution evidence codes | `require('./src/main/attribution.js').EVIDENCE_CODES` | **7** |

At audit time these read 46 main modules, 47 components (against 46 documented), 13 stores, 16
utils. The main-module figure has moved again since (46 → 50 → 51) — see `ai-mistakes.md` #24,
which names an earlier version of *this file* among the eight places a dead count sat.

**Dead / half-wired production surfaces, re-checked at `d027f0c`:**

| Surface | Status | Evidence |
|---|---|---|
| `getRulesByCategory` / `categoryIndex` | **OPEN** | Defined and exported in `rule-loader.js:193,224`; zero callers under `src/` outside that file. `classifySensitive` still walks `getAllRules()`. |
| `resource-usage` push | **CLOSED** | Channel renamed `agent-resource-usage`, consumed in `stores/ipc.ts` and read at `AgentCard.svelte:106` strictly by `instanceId`. |
| `anomalyScoresByInstance` | **CLOSED** | `scan-loop.js:407` sends it; `stores/ipc.ts:48` types it and publishes `anomaliesByInstance`, which `risk.ts` reads instead of a name lookup. |
| `rules:reloaded` push | **OPEN** | Sent at `file-watcher.js:844`, bridged at `preload.js:72-75`; no renderer subscriber (F-E11). |
| `riskHistory` on agent cards | **OPEN** | Read at `AgentCard.svelte:37,200-202`; nothing in `src/` writes it — the sparkline never paints (F-S06). |
| `attachModels` (Ollama / LM Studio) | **CLOSED** | `enrichWithLocalModels` now runs at `scan-loop.js:346`, before the `scan-batch` send at `:402`; `attachModels` stamps identity at `:526-528`. |

Exported functions with no production caller: `getRulesByCategory` (rule-loader) is the one
confirmed case. A full unused-export graph was never machine-closed, at audit time or since.

---

# Findings

## Tier 1 — Wrong output (label or number is untrue) — **all CLOSED**

Every Tier-1 finding was fixed between 2026-08-08 and `d027f0c`. The originals are not reproduced
here: eleven present-tense "User sees:" blocks describing defects that no longer exist would be the
exact false-confidence class this audit was written to catch. `memory-bank/progress.md` carries the
per-finding disposition with the mutation that turns each new test red; the code carries the finding
IDs at the sites that changed.

| Finding | What was wrong | Closed by |
|---|---|---|
| F-W01 | "Avg Risk Score" averaged anomaly scores, not risk scores | `summary-metrics.ts:averageRiskScore` over `$enrichedAgents` — the same domain AgentCard uses |
| F-W02 | "Total Agents" read `a.name` off raw `DetectedAgent` (always `undefined` → always 1) | `summary-metrics.ts:countUniqueAgents`; SummaryCards now imports `$enrichedAgents` |
| F-W03 | Ollama / LM Studio never rode a `scan-batch` — attached after the send, wiped before the next | `enrichWithLocalModels` moved before the send (`scan-loop.js:346` vs `:402`) |
| F-W04 | "Events / min" froze — `Date.now()` is not reactive state | shared 1s clock `stores/tick.ts` + pure `eventsPerMinute(events, now, window)` |
| F-W05 | One card mixed instance risk with group file/network totals | `agent-panel-utils.ts` — representative-only metrics, no silent group sum |
| F-W06 | "Sensitive Files" counted retained sensitive **events**, not files | relabelled `Sensitive Alerts` (`SENSITIVE_SUMMARY_LABEL`); value semantics unchanged and now stated |
| F-W07 | "System Uptime" was monitoring-session age and stalled without stats pushes | relabelled `Monitoring Duration`, driven from `monitoringStarted` + the shared tick |
| F-W08 | Agent-card "FILES" was a decayed weight sum, not a file count | relabelled `File Act` (`FILE_ACTIVITY_CHIP_LABEL`) |
| F-W09 | Header (mean-complement) and RiskIndex (max) read as the same kind of number | Header states average health; RiskIndex states `Worst Risk` |
| F-W10 | Radar coloured dots from `getTrustGrade` while badges banded on `getRiskInfo` — score 60 was amber and red at once | every renderer colour decision bands through `getRiskInfo` via `pickByRiskBand`; pinned by `tests/renderer/components/Radar.test.ts` at 0/34/35/60/65/66/100 |
| F-W11 | RiskIndex caption said "N agents" over process instances | caption says `process` / `processes` |

---

## Tier 2 — Evidence loss

### F-E01 — per-PID `resource-usage` push had no renderer subscriber — **CLOSED**

The channel was renamed `agent-resource-usage` (the old name collided with `get-resource-usage`,
which means the app's *own* load) and now lands in a renderer store; `AgentCard.svelte:100-106`
consumes it strictly by `instanceId`, with no pid fallback.

### F-E02 — file events dropped when no agents were known yet — **CLOSED**

`handleWatcherEvent` no longer returns on an empty `latestAgents`; only `shouldIgnore`, pause and
the path debounce remain. Zero agents now yields an honest unattributed event
(`no-ai-agents-online`) instead of silence.

### F-E03 — cross-layer file dedup keyed on display name — **CLOSED**

`dedupFileEvent` (`scan-loop.js:69-75`) keys on the stamped `instanceId|file`; a null or empty
`instanceId` bypasses the bucket entirely rather than collapsing into a shared `''|path` key. Two
instances of one product name, and two unattributed events, now both survive.

### F-E04 — four independent event windows, none disclosed — **OPEN**

**User sees:** Risk, timeline and feed disagree with "how much happened", with no truncation banner.

**Where:** renderer ring `stores/ipc.ts:360` (`slice(-499)` + batch); network `:365` (500);
`ActivityFeed.svelte:155` (`slice(0, 200)`); main `activityLog` capped at 10 000 in `file-watcher.js`
(`:377`, `:550`, `:680`); OOM trim to 1 000 at `main.js:438-450`.

**Mechanism:** Multiple independent caps. Risk only ever sees the renderer's window. Sensitive
counters follow the main ring plus its eviction hook.

**Falsification:** A single durable window, or UI disclosure when a cap drops rows.

### F-E05 — `attachModels` synthetics had no `instanceId` — **CLOSED**

`attachModels` now calls `identify({ pid: 0, agent: name })` and stamps both `instanceId` and
`instanceIdSource` (`scan-loop.js:526-528`), mirroring `injectDetectedExternalAgents`. The
baselines/risk quarantine that made this visible was correct and is unchanged.

### F-E06 — Linux/Darwin supply no OS birth time → real agents fall back to `"<pid>:u"` — **OPEN**

**User sees:** After PID reuse on non-Windows, sessions, knownHandles and scores can continue under
a new process as if it were the old one (degraded identity).

**Where:** `platform/linux.js:247` and `platform/darwin.js:149` both document that
`getParentProcessMap` entries carry no `startTime`; `win32.js` supplies one.

**Mechanism:** Space-3 identity is honest but reuse-unsafe. The product claims instance identity
generally; the platform gap is silent to the user.

**Falsification:** `startTime` populated on linux/darwin and `instanceIdSource === 'os'` in
production scans there.

### F-E07 — audit buffer overflow can lose events with no on-disk marker if the process exits while the disk is still bad — **OPEN**

**User sees:** A later "valid" hash-chain file that is incomplete; `droppedEntries` resets on
restart.

**Where:** `audit-logger.js` — `BUFFER_CAP = 500` at `:40`, drop-oldest eviction at `:246-261`,
marker gated on the next **successful** flush at `:274-281`.

**Mechanism:** Evicted entries are counted in memory; the `buffer-overflow-drop` marker only reaches
disk on a flush that succeeds. `verifyChain` cannot detect records that were never sequenced.

**Falsification:** A forced full-disk session that exits before recovery leaves a durable loss
record.

### F-E08 — `verifyChain` does not detect truncation of trailing lines — **BY DESIGN**

Any prefix of a valid chain is a valid chain. This is stated outright in the code
(`audit-hashchain.js:68`) rather than left for a reader to discover, and the JSDoc carries the
asymmetry (valid ≠ complete). It remains a real trustworthiness limit of an append-only store — the
fix is an external length/seq watermark — but it is a documented property, not an unfixed bug.

### F-E09 — process-scan overruns drop entire ticks silently — **OPEN**

**User sees:** Frozen agent list / delayed enter-exit while the machine is busy; no "scan skipped"
signal anywhere.

**Where:** `scan-loop.js:280-281` (`if (processScanRunning) return;`), cleared at `:461`.

**Mechanism:** The re-entrancy guard discards overlapping interval fires without queueing or
counting them. Note the contrast with the filesystem and network sensors, which now hold
`sensor-health` records — the process scan has none.

**Falsification:** A skipped-tick counter or health record, or a queue that always runs the latest
scan.

### F-E10 — token costs silently absent on non-Windows — **OPEN**

**User sees:** Empty token footer/card despite Claude Code running (darwin/linux always; win32 when
`startTime` is unreadable).

**Where:** `token-cost-collector.js:75-76` keeps only agents where `typeof a.startTime === 'number'`;
the file header at `:16` states darwin/linux are always null.

**Mechanism:** No birth time → no procs → no feed read. One warning on win32 only, for Claude Code.

**Falsification:** Token records on linux with live Claude Code, or UI that states "tokens
unavailable on this OS".

### F-E11 — `rules:reloaded` is pushed with no renderer listener — **OPEN**

**User sees:** Rules change on disk, main reloads them, and any UI showing rules can stay stale.

**Where:** sent at `file-watcher.js:844`, bridged at `preload.js:72-75`; `grep` for
`onRulesReloaded` / `rules:reloaded` under `src/renderer` returns nothing.

**Mechanism:** Same class as F-E01 was — a bridge endpoint with no consumer. It is now the only
surviving instance of that class.

**Falsification:** A renderer handler that updates a rules store on push, or stop sending it.

### F-E12 — network rows carry the OS owner pid while attribution is unattributed — **BY DESIGN**

The audit filed this as an invariant violation and flagged its own uncertainty ("may be intentional
for network forensics"). At `d027f0c` the code answers it in place
(`network-monitor.js:452-466`): the unmatched branch yields `agent: ''` — never a synthesized
`PID <n>` label — and the comment states that `_getRawTcpConnections` is called *with* these agents'
pids, so every returned pid is in `pidMap` and the unmatched branch is unreachable in practice. It
is kept as a guard, not as a fallback that invents data, and `instanceId` comes from
`readInstanceId(agent)` on the same tick that built the map. Nothing here needs fixing; the
invariant wording is what should say "file path" where it says "all records".

---

## Tier 3 — Silent failure / invariant cracks

### F-S01 — vacuous tests: chokidar subscription could be deleted and file-watcher tests stayed green — **CLOSED**

The break/restore proof stands as executed: emptying `bindWatcherEvents` left 93 file-watcher tests
passing. `tests/main/file-watcher-subscription.test.js` now mocks `chokidar.watch`, runs production
`setupFileWatchers`, asserts every watcher registers `add` / `change` / `unlink`, and fires the
callbacks into the real handler. Production wiring was already correct — the gap was the gate, and
dropping a `watcher.on('change', …)` now turns that test red.

### F-S02 — `getRulesByCategory` fully tested, never used on a production path — **OPEN**

**User sees:** Nothing directly. The risk is false confidence that category indexing protects
classification latency.

**Where:** `rule-loader.js:193,224`; `classifySensitive` still walks `getAllRules()`.

**Mechanism:** Green unit tests for code the product never calls — vacuity at feature level rather
than assertion level, which is why no second break/restore was performed (the tests do exercise the
function body).

**Falsification:** A production caller routes through `getRulesByCategory` and a test fails when the
index is wrong.

### F-S03 — identity re-derivation fallbacks on hot paths — **CLOSED, with one documented degradation**

The silent fallbacks are gone. `file-watcher.js:477` (`handleKey`) and `session-tracker.js`
(`sessionKey`) now call `readInstanceId` only and skip an unstamped agent rather than rebuilding;
both cite `ai-mistakes.md` #19 in place. `AgentCard.svelte:94` matches on `instanceId` when both
sides carry one and states the pid path as the neither-side-keyed case.

What remains is deliberate: `token-tracker.js:193-201` (`recordKey`) still calls `buildInstanceId`
for bare-number callers, documented as "space-3 degradation by pid only — never invent birth-time
identity". That is an explicit degradation with a named space, not a silent rebuild.

### F-S04 — `pidMap` / `pidToAgent` are last-writer-wins for a shared pid — **OPEN**

**User sees:** Wrong agent name on a network or RM-holding event if two agent records share a pid.
All pure synthetics use **pid 0**, and there can be more than one (Ollama *and* LM Studio).

**Where:** `network-monitor.js:428-429`; `file-watcher.js:626-627`.

**Mechanism:** `Map.set(a.pid, a)` overwrites. Practical impact is currently limited — the TCP table
is queried with real pids, so pid-0 rows do not come back — but the structure still cannot represent
two agents on one pid, and F-W03's fix means those synthetics now reach the scan list.

**Falsification:** A map keyed by `instanceId` with OS pid → instance resolution, or an assertion of
at most one agent per pid in the scan list.

### F-S05 — sensor errors become empty results — **PARTIALLY CLOSED (main), OPEN (UI)**

**User sees:** "No file activity" / "no connections" when the sensor actually failed.

**Where:** `src/main/sensor-health.js` now exists and supplies `createSensorHealth` /
`createUnsupported` / `markHealthy` / `markDegraded`; `file-watcher.js:104-111` holds records for the
chokidar, handle and Restart-Manager sensors, and `network-monitor.js:34,73-79` holds one for the
network sensor. `docs/roadmap/sensor-health-degraded.md` is the design note.

**Mechanism:** Main can now distinguish quiet from dead. The renderer cannot: `grep` for
`sensorHealth` / `degraded` under `src/renderer` returns nothing, so a degraded sensor is still
indistinguishable from a quiet machine on screen. The process scan holds no record at all (F-E09).

**Falsification:** An explicit degraded state rendered in the UI when handle/RM/TCP enumeration
fails.

### F-S06 — `riskHistory` sparkline is dead UI — **OPEN**

**User sees:** No risk sparkline on cards despite a `Sparkline` component and a layout slot.

**Where:** `AgentCard.svelte:37` (`agent.riskHistory ?? []`), rendered at `:200-202` behind
`length > 1`; nothing in `src/` writes the field.

**Falsification:** A producer appends scores each scan and the sparkline renders.

### F-S07 — evidence code list is seven items, not six — **CLOSED**

`EVIDENCE_CODES` is still 7 (`rm-holder-pid`, `handle-scan-pid`, `os-tcp-owner-pid`,
`self-config-path`, `cwd-containment`, `no-owner-match`, `no-ai-agents-online`) — the code was never
wrong. The invariant text was: the attribution comment now describes a closed registry rather than
naming a fixed count, so the two cannot drift apart again.

---

## Tier 4 — Doc / inventory drift

The audit's four Tier-4 items were counts documented in one place and measured differently in
another. All four have since been either fixed or superseded, and re-listing the audit-time figures
would re-seed the drift. Current state at `d027f0c`:

- **Component / store / util counts.** `CLAUDE.md` no longer quotes a component count; it carries
  the command instead. Note that the command it carries,
  `git ls-files 'src/renderer/**/*.svelte' | wc -l`, returns 47 — one short of the 48 tracked
  `.svelte` files, because it misses `src/renderer/App.svelte`.
- **Skill test counts.** `.claude/skills/aegis-context/SKILL.md:32` still states "1075 pass, 4 skip
  (1079 total) across 68 files". That figure was stale when the audit found it and is staler now.
  It is a hand-maintained counter with no gate behind it (`ai-mistakes.md` #24) — the fix is to
  delete it, not to refresh it.
- **IPC narrative.** 40 invoke + 9 push = 49 bridge endpoints, unchanged. Two of the audit's three
  unconsumed push channels now have subscribers; `rules:reloaded` does not (F-E11).

---

## Path traces (condensed, re-checked at `d027f0c`)

### File event (chokidar)

1. `setupFileWatchers` → `bindWatcherEvents` → `handleWatcherEvent` (`file-watcher.js`).
2. Early exits: paused, ignore, path debounce. **An empty agent list is no longer an early exit**
   (F-E02) — it produces an unattributed event.
3. Owner via `findOwningAgent` (self-config → cwd) or unattributed evidence; `readInstanceId(agent)`
   only, never a rebuild (F-S03).
4. Push activityLog + counters; `recordFileAccess` unless unattributed.
5. `onFileEvent` → `dedupFileEvent` (**`instanceId|file`**, F-E03) → batcher `file-access` + audit +
   tray.
6. Renderer: `events` ring → `risk.ts` / `eventsByInstance` / ActivityFeed.

**Filters that still diverge:** main ring (10 000, OOM-trimmed to 1 000) vs IPC dedup vs renderer
window (≈500) vs feed (200) vs risk quarantine of unattributed — F-E04.

### File event (handle / RM)

1. Timer → `scanAllFileHandles` / `scanHotFileHolders`.
2. RM path maps holder pid → agent (dropping non-agents); `knownHandles` keyed by `handleKey`, which
   is `readInstanceId` and nothing else — an unstamped agent gets no dedup entry this tick.
3. Events enter activityLog **before** scan-loop dedup for audit/IPC.

### Network connection

1. `scanNetworkConnections(agents)` builds a **pid→agent** map from this tick's agents (F-S04 notes
   the shared-pid limit).
2. OS TCP rows; drop private IPs; IP allowlist checked **before** any DNS work; reverse DNS then
   forward-confirmed.
3. Verdict `allowlisted` | `unknown` | `flagged`; `flagged` keeps its original meaning, "not
   confirmed as an allowlisted endpoint", so `unknown` still sets it — an unidentified endpoint is
   never displayed as safe.
4. `recordNetworkEndpoint(instanceId, …)`; audit with `OS_TCP_OWNER_PID` or `NO_OWNER_MATCH`.
5. Renderer `network` replace; risk splits flagged vs unknown weights.

---

## Invariant checklist (at `d027f0c`)

| Invariant | Status |
|---|---|
| `instanceId` not bare pid on live identity maps | Held on the hot paths (F-S03 closed). One documented pid-space degradation in `token-tracker.recordKey`. Resource sampling is instance-keyed. |
| No silent owner fallback to "first agent" | Held — null owner → unattributed. |
| Three attribution statuses + closed evidence list | Held; the registry is 7 codes and is described as closed rather than counted (F-S07). |
| Unattributed: empty name + null pid | File path: held. Network: `agent: ''` with the OS pid retained on a branch that is unreachable in practice and documented as a guard (F-E12). |
| No numeric confidence on attribution | Held. |
| Durable disk state not keyed on `instanceId` | Held by design — baselines name-keyed, permissions instanceKey name/cwd. |
| Risk factor ceilings | Held (`risk-scoring.js` min ceilings; anomaly dimensions capped). |
| Event dedup | Held at instance granularity (F-E03 closed). |
| Audit hash-chain; no drop before confirmed write | Re-queue on flush failure held; cap eviction can still drop before a durable marker exists (F-E07). |
| Every IPC channel has a subscriber | **One violation:** `rules:reloaded` (F-E11). |
| Sensor failure is distinguishable from quiet | Main: held for FS + network sensors. **Renderer: no consumer** (F-S05). Process scan: no record (F-E09). |
| Demo only in renderer / not on a production path | Held — `import.meta.env.VITE_DEMO_MODE` is a build-time literal (`vite.config.js:25`), the default build drops the engine, and a missing bridge shows a banner rather than demo data. The audit cited `production-no-demo.test.ts`, which no longer exists; the demo surface is now covered by `tests/renderer/demo-data.test.js` plus the provenance marker in `demo-provenance.js`. |

---

## Vacuous / weak tests

| Test area | Why weak | Status at `d027f0c` |
|---|---|---|
| `file-watcher*.test.js` handler suite | Never required a chokidar subscription | **Closed** — `tests/main/file-watcher-subscription.test.js` asserts the bindings and fires them |
| `rule-loader` `getRulesByCategory` | No production caller | **Open** (F-S02). The unit tests do exercise the body; the vacuity is product wiring |
| `scan-loop` anomaly tests with Ollama | Injected Ollama via the scanner mock, not `attachModels`, so the suite could not catch F-W03 | **Superseded** — F-W03 and F-E05 are closed; a test that fixes the *ordering* rather than the symptom is still worth having |
| `llm-runtime-detector` unit tests | Prove HTTP probe helpers only; no `scan-batch` integration | **Open** |
| `main-watcher-startup` | Guards `setupFileWatchers` scheduling but mocks the function, so asserts no FS bindings | **Covered elsewhere** by the subscription test |

---

## What could not be determined (and why)

1. Whether chokidar watchers actually run in a **packaged** Electron build on this machine — the
   audit did not launch the GUI; code and unit tests only.
2. Real disk-full audit loss rates in the field — needs a controlled full-disk soak.
3. How often process-scan overruns occur under load — no metrics are emitted on skip (F-E09).
4. A complete unused-export graph for every main module — partial inventory only; no whole-program
   call graph was built.
5. Whether any external tooling consumes `anomalyScoresByInstance` or the resource channel outside
   this renderer — only `src/` was searched.
6. End-to-end correctness of Restart Manager / `handle.exe` on this Windows host — platform tests are
   unit-level with mocks. (The `bench/` harness added since the audit is the intended answer to this
   and to item 1, but it is Windows-only and never runs in CI.)
7. Exact user-visible Header vs SummaryCards desync duration after tab switches — logic is clear; not
   timed in a running UI.

---

## Ranked shortlist of what is still open

1. **F-E11** `rules:reloaded` pushed with nobody listening — the last unconsumed bridge endpoint.
2. **F-S05** sensor health exists in main but never reaches the UI, so a dead sensor still reads as
   a quiet machine.
3. **F-E09** process-scan overruns dropped silently and with no health record.
4. **F-E07** audit loss on a kill with no durable marker.
5. **F-E04** four independent event windows, no truncation disclosure.
6. **F-S04** pid-keyed maps cannot represent two agents on one pid, and pid-0 synthetics now reach
   the scan list.
7. **F-E06** linux/darwin have no OS birth time → degraded identity under PID reuse.
8. **F-E10** token costs silently absent on non-Windows.
9. **F-S06** `riskHistory` sparkline is dead UI.
10. **F-S02** `getRulesByCategory` tested but never called.

---

## Explicit non-findings (checked, not broken as described)

- **Network "PTR exists ⇒ safe / missing ⇒ hostile" inversion:** not present. Reverse DNS is
  forward-confirmed and a missing PTR yields `unknown`, which still sets `flagged` — never
  allowlisted.
- **Audit flush re-queue without advancing seq on failure:** implemented as designed in the `flush()`
  catch path.
- **C-01 first-agent blame on the chokidar path:** not present; the unattributed path uses an empty
  agent name and a null pid.
- **Demo pools in the production renderer bundle:** guarded by a build-time flag.

---

*Audit of 2026-08-08: no fixes proposed, no PR opened, one file written. Re-verified against
`master` @ `d027f0c` on 2026-08-13 before entering git — statuses, counts and line anchors above are
that re-verification, not the original snapshot.*
