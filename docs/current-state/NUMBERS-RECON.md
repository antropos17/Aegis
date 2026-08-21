# NUMBERS-RECON — reading path of every number on the main screen

Read-only reconnaissance. No source file and no test file was touched; the only path
this document adds is itself.

**Repo root:** `X:\dev\project\AEGIS`
**Recon date:** 2026-08-05
**Version:** `0.10.0-alpha` (`package.json`)
**Scope of "main screen":** the Shield tab (`App.svelte:316-317` → `ShieldTab.svelte`)
plus the three always-mounted chrome elements that sit on top of it — `Header`
(`App.svelte:292`), `Footer` (`App.svelte:336`) and the fixed `RiskIndex` dock
(`App.svelte:353-355`). `NetworkPanel.svelte` is named in the task and is analysed in
§7, but it is **not on the main screen** — it is mounted by the Activity tab.

---

## 1. Outcome

**Six numbers on the main screen are wrong** — they do not equal what their own code
intends given its inputs, or they are rendered beside numbers computed over a
different population with nothing distinguishing them. **Ten more are merely
mislabelled** — the value is exactly what the code computes, but the label names a
different quantity. The remaining eighteen of the 34 read as labelled.

Counted as *rendered values*, not as distinct defects: the four trend deltas are four
numbers on screen sharing one mechanism (W2), so a reader counting defects rather
than dials gets three, not six.

The three worst:

1. **`AVG RISK SCORE` is not a risk score.** It is the mean *anomaly* score — a
   behaviour-versus-baseline number from a different subsystem that shares no input,
   no formula and no scale semantics with the `riskScore` on the agent cards below it
   (`SummaryCards.svelte:24-28` reads `$anomalies`; `risk.ts:230` computes `riskScore`).
   The two can never be reconciled by looking at them.
2. **The agent card's badge scores one process while the chips beside it total all of
   them.** `AgentPanel.svelte:33-46` sums `fileCount`/`networkCount` across every
   instance of a name but keeps the *representative's* `riskScore` — so `FILES 812 /
   NET 40 / badge 8` describes two different populations in one row.
3. **`Events / min` freezes instead of decaying to zero.** The 60-second cutoff is
   computed with a non-reactive `Date.now()` inside `$derived.by`
   (`SummaryCards.svelte:30-35`), so on a machine that stops emitting file events the
   card holds its last non-zero reading indefinitely.

**One fact resolves the rest and the code cannot supply it:** whether the `152` on the
reported screen was the Header's `files` chip or a count of feed rows. The demo-build
mapping explains the `8` / `52` pair exactly but produces the *opposite* of the
reported `FILES 0` / `152` pair, so until that one reading is pinned down the two
halves of the report have two different explanations (§8). Everything else that could
not be determined from the code alone is in §9.

---

## 2. Method and the two definitions used

Every claim below is anchored to `file:line`. Two terms are used throughout and are
kept disjoint:

- **wrong** — either of two conditions:
  - *wrong by computation* — given its own inputs, the rendered value is not what its
    own code intends to produce;
  - *wrong by population* — the value is correct for its own inputs, but it is
    rendered **inside a composite** (one card, one row) whose other numbers are
    computed over a different population, with nothing on screen separating them. The
    composite is the unit the reader parses, so a number that is only true of a subset
    of what the composite claims to describe is not salvageable by relabelling it.
    **W3 is the only entry of this kind**; it is called out explicitly in §5 so the
    classification can be disputed on its own terms.
- **mislabelled** — the value is precisely what its code intends; the *label* names a
  different quantity than the one computed. Relabelling the field would fix it.

A number can be both; where it is, it is filed under **wrong**.

---

## 3. The stores everything reads from

| Store | Declared | Filled by | Shape / cap |
|---|---|---|---|
| `agents` | `ipc.ts:103` | `scan-batch` push, `ipc.ts:141` | One record **per process**, not per agent name |
| `events` | `ipc.ts:104` | `file-access` push, `ipc.ts:152-155` | File events only — **no** network rows. Cap: `[...arr.slice(-499), ...batch]` (`ipc.ts:154`), i.e. 499 + batch size |
| `stats` | `ipc.ts:105` | `scan-batch` (`:142`) and `stats-update` (`:156`), seeded by `getStats()` (`:165`) | Main-process counters, see below |
| `network` | `ipc.ts:106` | `network-update` push, `ipc.ts:157-160` | Whole set replaced each poll; capped at 500 |
| `anomalies` | `ipc.ts:107` | `scan-batch.anomalyScores`, `ipc.ts:144` | `Record<agentName, number>` |
| `resourceUsage` | `ipc.ts:108` | `scan-batch` (`:143`), seeded `:166` | **AEGIS's own main process** — `main.js:124-133` returns `process.memoryUsage()` / `process.cpuUsage()` |
| `tokenCosts` | `ipc.ts:113` | `token-costs` push, `ipc.ts:162` | One record per process *instance* |

`enrichedAgents` (`risk.ts:87-255`) is derived from `agents + events + anomalies +
network + falsePositives` and is the only place `riskScore` and `trustGrade` exist.

### 3.1 What `$stats` actually holds

`main.js:153-165`:

- `totalFiles: log.length` (`main.js:155`) — the **current length of the main-process
  activity ring buffer**, capped at 10 000 (`file-watcher.js:254-257`, `:407-410`,
  `:522-527`) and hard-trimmed to 1 000 when heap passes 512 MB
  (`main.js:439-443`). It is not a count of files, and it is not cumulative.
- `totalSensitive` (`main.js:156`) — a running counter incremented on push
  (`main.js:96`) and **decremented on eviction** (`main.js:105`). So it counts
  *sensitive events still retained*, not sensitive files ever seen, and it can go
  down without anything improving.
- `uptimeMs: Date.now() - scanner.monitoringStarted` (`main.js:158`) — sampled in the
  main process at the instant the batch was built, then frozen in the renderer until
  the next push.

### 3.2 What `$anomalies` actually holds

`scan-loop.js:285-286` builds `scores[a.agent] = anomaly.calculateAnomalyScore(a.agent).score`,
keyed by **agent name**. `anomaly-detector.js:48-84` computes a 0–100 weighted composite
over four behavioural dimensions (network / filesystem / process / baseline) and
returns **0 outright** until an agent has ≥3 recorded sessions
(`anomaly-detector.js:59`). It measures *deviation from that agent's own history*.

`risk.ts:220-230` computes `riskScore` from an entirely disjoint input set
(sensitive-file weights, config files, SSH/AWS files, connection count, flagged and
unknown endpoints, decayed file weight, unencrypted HTTP) via
`risk-scoring.js:55-88`. **The two numbers share no term.** `anomalyScore` is attached
to every enriched agent (`risk.ts:219`, `:246`) and is then **rendered nowhere on the
main screen** — while the average of the same map is rendered under a label that says
"Risk".

---

## 4. Inventory — every number on the main screen

Column *"moment"* is the instant in time the value describes. Column *"can differ from
its neighbour"* answers step 2 of the task. Rows marked `—` in the `#` column are
rendered things that are not numbers (badges, colours, an unrendered count); they are
kept for context and are **not** part of the 34. The `#` sequence skips 23 for that
reason — the identifiers are stable references, not a running tally.

### 4.1 Header — `Header.svelte`, always mounted, no `active` guard

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 1 | bare score, e.g. `92` | `:9-14` → `:34` | `$enrichedAgents` | `100 − mean(riskScore)` over **process instances** | live, last scan | Yes — inverted and mean-based, while `RiskIndex` (#23) is non-inverted and max-based over the same array |
| 2 | `N agents` | `:17` → `:37` | `$enrichedAgents` | count of **distinct names** | live, last scan | Yes — vs #5 (same quantity, but animated and tab-gated) |
| 3 | `N processes` | `:16` → `:42` | `$enrichedAgents` | `enrichedAgents.length` — **instances** | live, last scan | Yes — differs from #2 by the multi-process factor |
| 4 | `N files` | `:18` → `:47` | `$stats.totalFiles` | **length of the main ring buffer** (≤10 000, trimmable to 1 000) | main-process time of the last `scan-batch` / `stats-update` | Yes — the renderer feed below holds at most ~500 (`ipc.ts:154`), so this is routinely 20× the feed |
| — | `Scanning` / `Idle` | `:50-53` | `$scanActive` | boolean, not a number | live | — |

### 4.2 Summary cards — `SummaryCards.svelte`, **`active`-gated** (`:13-19`)

All five read from `localAgents/localEvents/localAnomalies/localStats`, which are
snapshots (§6), and four of the five are additionally routed through a 600 ms eased
counter animation (`:112-125`, `:127-138`) before reaching the DOM.

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 5 | `TOTAL AGENTS` | `:22` → `:160` (`displayAgents`) | `$agents` via `localAgents` | distinct **names** in the raw agent list | last scan received *while the tab was active*, then eased over 600 ms | Yes — same quantity as #2 but lags it by up to 600 ms on every scan, and by the whole inactive interval after a tab switch |
| 6 | `AVG RISK SCORE` | `:24-28` → `:172` | `$anomalies` via `localAnomalies` | **arithmetic mean of the anomaly scores** — one entry per agent name | last scan while active | Yes — shares no input with any `riskScore` on screen (§3.2) |
| 7 | `EVENTS / MIN` | `:30-35` → `:184` | `$events` via `localEvents` | file events whose `timestamp` was within 60 s **of the last recompute** — network rows excluded | the last time `localEvents` changed, *not* now | Yes — the feed below (§4.5) counts file **and** network rows |
| 8 | `SENSITIVE FILES` | `:37` → `:196` | `$stats.totalSensitive` | sensitive **events still retained** in the main ring buffer | main-process time of last stats push | Yes — decrements on eviction; the feed's `sensitive` badges are drawn from a different, smaller window |
| 9 | `SYSTEM UPTIME` | `:39-46` → `:208` | `$stats.uptimeMs` | ms since **`scanner.monitoringStarted`** in the main process | **advances only on a stats push, never on its own.** `stats-update` is pushed on every deduped file event (`main.js:399`) but coalesced to at most once per second (`main.js:186-189`, `mode: 'latest'`), and again on each scan tick (`scan-loop.js:380`, `:412`). So it ticks ~1 Hz under file activity and stalls until the next scan when the machine is quiet | Yes — Footer `UP` (#33) is a *different* clock on a *different* cadence, see below |
| 10-13 | four trend arrows + deltas | `:76-79` → `:164`, `:176`, `:188`, `:200` | the four values above | current minus a baseline snapshot | baseline is re-seeded **1 s after every (re)activation** (`:64-69`) and every 30 s thereafter (`:57-62`) | Yes — see §5, W2 |

### 4.3 Radar — `Radar.svelte`

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 14 | dot **distance** from centre | `:41-42` | `$enrichedAgents` (live `$derived`, **not** snapshotted) | `0.2 + min(riskScore,100)/100 × 0.75`, one dot per **name**, highest-risk instance wins (`:32-37`) | live — the derived recomputes even when the tab is hidden; only the draw loop stops (`:173`, `:211-214`) | Yes — the dot set is live while `SummaryCards`/`AgentPanel` around it are snapshots |
| — | dot **colour** | `:76-80` | `trustGrade` | banded by `getTrustGrade` (`risk-scoring.js:98-106`: 10/20/30/40/55/70) | live | Yes — `TrustBadge` and `RiskIndex` band the *same* score with `getRiskInfo` (`trust-badge-utils.ts:46-73`: 35/66). A score of 60 is grade **D → red dot** on the radar and **"Medium" → amber** in the badge and the dock |

### 4.4 Agent cards — `AgentPanel.svelte` (**`active`-gated**, `:12-15`) → `AgentCard.svelte`

`AgentPanel.svelte:33-46` groups the snapshot by name and produces, per group:
`rep` = the highest-`riskScore` instance (`:34-36`), `fileCount`/`networkCount` =
**sums over every instance** (`:39-40`), `_processCount` = instance count (`:41`),
`_instances` = the full list (`:44`).

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 15 | badge score (top-right) | `AgentCard.svelte:169` → `TrustBadge.svelte:49` | `agent.riskScore` | `calculateRiskScore` for **the representative instance only** (`risk.ts:230`), minus 20 if the name is a recorded false positive (`risk.ts:231`) | snapshot | **Yes — from the chips in the same row** (#17, #18), which are group totals. See §5, W3 |
| 16 | `PID` | `AgentCard.svelte:182` | `agent.pid` | pid of the representative instance | snapshot | — |
| 17 | `PROC` | `AgentCard.svelte:186` | `_processCount` | number of instances folded into this card | snapshot | — |
| 18 | `FILES` | `AgentCard.svelte:192` | `agent.fileCount` | **not a count.** A sum of *time-decay weights* — 1.0 / 0.5 / 0.1 by age (`risk-scoring.js:15-20`) — over events that survived a 30-second per-path dedup (`risk.ts:185`), excluding `selfAccess` and `unattributed` rows (`risk.ts:115-116`, `:178`), summed across instances, then `Math.round`ed for display | snapshot | Yes — vs `Activity (N)` on the same expanded card (#21) and vs the feed |
| 19 | `NET` | `AgentCard.svelte:198` | `agent.networkCount` | connections **currently reported** by the last poll for this agent, summed over instances (`risk.ts:211`). Not cumulative, no dedup | snapshot | Yes — the network set is replaced wholesale each poll (`ipc.ts:157-160`) |
| 20 | `TOKENS` + `$` | `AgentCard.svelte:205-207` | `$tokenCosts` (**live**, not snapshotted) | one record, matched by `instanceId` when both sides have one, else by pid (`:87-91`) — **the representative's only**, never the group's | live | Yes — sits on a card whose other chips are group totals and are frozen |
| 21 | `Activity (N)` (expanded) | `AgentCardDetails.svelte:65` ← `AgentCard.svelte:79` | `$eventsByPid` (**live**, `events-index.ts:17-39`) | raw event count for the representative pid, **hard-capped at 50** (`events-index.ts:36`), no decay, no 30-s dedup | live | Yes — routinely disagrees with `FILES` (#18) on the same card in both directions |
| 22 | `Risk: N` per-PID tooltip | `PidList.svelte:59` | `_instances[].riskScore` | per-instance score | snapshot | Consistent with #15 by construction (#15 is the max of these) |
| — | risk bar fill | `AgentCardDetails.svelte:36` | `agent.riskScore` | same value as #15 | snapshot | — |
| — | sparkline | `AgentCard.svelte:35`, `:172-176` | `agent.riskHistory` | **nothing ever writes `riskHistory`** — the only four references in `src/` are these two reads. `riskHistory.length > 1` is never true, so the sparkline never renders | — | — |

### 4.5 Feed — `FeedFilters.svelte` + `ActivityFeed.svelte` (both **`active`-gated**)

`FeedFilters` on the Shield tab renders **no counts** — the pills are states only
(`FeedFilters.svelte:59-66`, `:72-81`). The agent dropdown is populated from
`$enrichedAgents` names (`:22`).

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| — | *(the row count itself is never rendered)* | `ActivityFeed.svelte:144-156` | `cachedEvents` + `cachedNetwork` | the list is file events **plus** network rows, merged (`:105-142`), deduped by `_key` (`:134-141`), filtered, then **`.slice(0, 200)`** (`:155`). No count appears anywhere in the component, so this is not one of the 34 — but the ceiling is recorded because any external count of "how many events the feed holds" is bounded by it | snapshot | The 200-row ceiling is silent: nothing on screen says truncation happened |
| 24 | row clock, e.g. `14:23:07` | `:220` ← `:72-81` | `now` | absolute wall time of the event; the *format* switches on `now - ts`, and `now` advances **only every 30 s** while active (`:32-38`) | up to 30 s stale | — |
| 25 | `×N` repeat badge | `:238-240` | `ev.repeatCount` | main-process dedup count, passed through untouched | event time | — |

### 4.6 Risk-index dock — `RiskIndex.svelte`, always mounted, **never `active`-gated** (`App.svelte:353-355`)

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 26 | `N agents` | `:44` → `:80` | `agents.length` | **process instances** — the prop is `$enrichedAgents` verbatim | live | Yes — the word "agents" here means what the Header calls "processes" (#3), not what the Header calls "agents" (#2) |
| 27 | headline index | `:53` → `:99` | `max(riskScore)` | worst single instance, deliberately (`:49-52`) | live | Yes — vs Header shield score (#1), which is `100 − mean` |
| 28 | `High` / `Med` / `Low` counts | `:59-63` → `:107` | `getRiskInfo(s).level` per instance | instance counts banded at 35 / 66 (`trust-badge-utils.ts:46-73`) | live | Yes — these sum to #26 (instances), never to #2 (names) |

### 4.7 Footer — `Footer.svelte` + `FooterMiniCharts.svelte`, always mounted, live

| # | On screen | Component:line | Reads | What the value actually is | Moment | Can differ from neighbour |
|---|---|---|---|---|---|---|
| 29 | `CPU n%` | `FooterMiniCharts.svelte:51` → `:71` | `$resourceUsage` | **AEGIS's own main process**, delta-based (`main.js:124-133`). Nothing to do with the monitored agents | resampled on the 1 s tick (`tick.ts:18-31`), but the underlying value only changes on `scan-batch` | — |
| 30 | `MEM n MB` | `FooterMiniCharts.svelte:59` → `:72` | `$resourceUsage.memMB` | AEGIS main-process RSS | same | — |
| 31 | `HEAP n MB` | `Footer.svelte:24-28` → `:58` | `$resourceUsage.heapMB` | AEGIS main-process `heapUsed`; the effect **returns early unless `u.cpuUser` is truthy** (`:26`) | same | — |
| 32 | `SCAN ns` | `Footer.svelte:30-39` → `:63` | `getSettings()` | configured scan interval, **read once at mount** — a later settings change is not reflected until reload | mount time | — |
| 33 | `UP hh:mm:ss` | `Footer.svelte:17-18` → `:68` | `tick` | ms since `appStart`, captured when the **Footer module evaluated** — i.e. renderer load | ticks every 1 s | **Yes — from `SYSTEM UPTIME` (#9)**, which measures the main process's monitoring start. Different origins, different tick rates, both on screen at once |
| 34 | `TOKENS n $x` | `Footer.svelte:9-10` → `:75` | `$tokenCosts` | sum over **all** instance records | live | Yes — the per-card figure (#20) is one instance's |
| 35 | `PERM n` | `Footer.svelte:7` → `:86` | `$stats.permissionDeniedScans` | consecutive permission errors; **rendered only when `> 5`** (`:80`) | last stats push | — |

---

## 5. The six wrong numbers

### W1 — `Events / min` never decays (`SummaryCards.svelte:30-35`)

```js
let eventsPerMin = $derived.by(() => {
  const cutoff = Date.now() - 60_000;
  return localEvents.filter(...).length;
});
```

`Date.now()` is not reactive state. The only tracked dependency of this `$derived.by`
is `localEvents`, and `localEvents` is only reassigned when the `$events` store pushes
(`:13-19`). On a machine that stops emitting file events, the derived never re-runs,
the cutoff never advances, and the card holds its last non-zero value **for as long
as the quiet lasts**. Nothing else on the card forces a recompute: `uptimeStr` reads
`localStats`, and the 30-second trend interval (`:57-62`) writes `prevEpm` but never
reads `eventsPerMin` in a way that invalidates it.

Same class of defect, opposite direction: because the cutoff is evaluated at push
time, an event that was 59 s old when the last batch landed still counts three minutes
later.

### W2 — every trend arrow collapses to flat 1 second after each tab return (`SummaryCards.svelte:55-74`)

The snapshot effect is `active`-gated. Leaving the tab tears it down (`:70-73`,
clearing both the 30-second interval and the seed timeout); returning re-runs it,
which re-arms the **1-second seed** at `:64-69`. That seed overwrites
`prevAgentCount / prevRisk / prevEpm / prevSensitive` with the *current* values.

Consequence: one second after every return to the Shield tab, all four deltas are
zero and all four arrows render `―` (`:88`). The design intent stated in the code —
*"compare current vs 30s-ago snapshot"* (`:48`) — is only honoured if the user stays
on the tab for a full 30 s without leaving. Between the tab switch and the seed
firing, the baseline is whatever was current *before* the user left, which may be
minutes old — so for that one second the arrows overstate the change instead.

### W3 — the badge scores one process, the chips beside it total all of them (`AgentPanel.svelte:33-46`)

*Classified **wrong by population**, not by computation — see §2. The badge value is
exactly `rep.riskScore`, which is what the grouping code intends. What is not
salvageable by relabelling is that this value and the two chips next to it describe
different sets of processes, and the card presents them as one agent's row. A reader
who rejects that second condition should move this entry to "mislabelled" and read the
counts as 5 wrong / 11 mislabelled.*

```js
const rep = instances.reduce((best, cur) =>
  (cur.riskScore || 0) > (best.riskScore || 0) ? cur : best);
return { ...rep,
  fileCount:    instances.reduce((s, a) => s + (a.fileCount || 0), 0),
  networkCount: instances.reduce((s, a) => s + (a.networkCount || 0), 0), ... };
```

`riskScore` arrives on the spread of `rep` and is **not** recomputed from the summed
inputs. `calculateRiskScore` is not additive — every factor is individually capped
(`risk-scoring.js:65-74`: 40 / 5 / 10 / 20 / 5 / 20 / 15) — so summing the inputs and
re-scoring would not give the sum of the scores either. The card therefore renders,
in one row, a risk computed over one process's evidence and file/network totals
computed over N processes' evidence, with nothing marking which is which.

Where it bites hardest: four idle instances plus one risky one show the risky score
next to a file total dominated by the idle four. Reverse case: five instances each
scoring 8 show a badge of **8** beside a `FILES` chip five times any one of them.

### W4-W6 — the four trend deltas, counted individually

`agentTrend`, `riskTrend`, `epmTrend`, `sensitiveTrend` (`SummaryCards.svelte:76-79`,
rendered at `:164`, `:176`, `:188`, `:200`) are four separately-rendered numbers, all
carrying the W2 defect, and `epmTrend` additionally inherits W1 on both of its terms.

**Wrong count = 6:** `Events / min`, the four trend deltas, and the agent-card badge.

---

## 6. The `if (!active) return` guards — what actually freezes, and for how long

The guard appears in `AgentPanel.svelte:12-15`, `SummaryCards.svelte:13-19` and
`:55-74`, `NetworkPanel.svelte:18-26`, `ActivityFeed.svelte:22-38`, and
`FeedFilters.svelte:16-19`. All follow one shape:

```js
$effect(() => {
  if (!active) return;
  localAgents = $enrichedAgents;
});
```

**Mechanism.** A Svelte 5 `$effect` subscribes only to the reactive values it actually
*reads during that run*. When `active` is false the function returns before
`$enrichedAgents` is dereferenced, so on that run the store is **not** a dependency —
only `active` is. Store pushes arriving while the tab is hidden therefore do not
re-trigger the effect, and `localAgents` keeps whatever landed last while the tab was
visible.

**Duration.** Exactly the length of the inactive period, and no longer. `active` *is*
tracked on every run, so the moment it flips back to true the effect re-runs, reads
the store, and resynchronises within the same flush. The freeze is not persistent
state and does not survive into the visible view — a returning user sees current data
immediately.

**The one window where a frozen value is genuinely on screen.** `App.svelte:410-419`
delays `visibility: hidden` on the outgoing panel by `var(--tab-dur)`, wired from
`TRANSITION_DURATION_MS = 220` (`tab-transitions.ts:35`, `App.svelte:303`). During
that fade the panel is still painted while `active` is already false. So a store push
landing inside that **220 ms** window updates the live components (Header, Footer,
RiskIndex, the Radar dot set) and not the fading ones. That is the whole of it.

**The guard is not the main source of skew.** Two larger, always-on effects sit
underneath it:

- **Live-vs-snapshot pairs render side by side permanently.** `Header` (#1-#4),
  `RiskIndex` (#26-#28), `Footer` (#29-#35), `Radar`'s dot set (`Radar.svelte:28-56`),
  `AgentCard`'s token chip (`AgentCard.svelte:87-91`) and its `Activity (N)`
  (`AgentCard.svelte:79`) are all **ungated** and update on every push, while the
  cards and the feed around them go through the guarded snapshot.
- **The 600 ms counter animation.** `SummaryCards.svelte:112-125` eases the four
  numeric cards toward their targets over 600 ms. So after *every* scan — no tab
  switch involved — the Header's agent count (#2, a plain `$derived`) and the card's
  agent count (#5) disagree for up to 600 ms, by construction.

---

## 7. `NetworkPanel.svelte` — off the main screen, one defect worth recording

Mounted by the Activity tab, not by `ShieldTab.svelte`. It renders **no risk score
anywhere** — no `TrustBadge`, no `riskScore` reference. Its numbers are:

- **Class pill counts** (`:114-118` → `:136`). `counts` is tallied over
  `cachedNetwork` **before** the dedup at `:103-110`, while the rows beneath are
  rendered from `sorted`, which drops exact `pid-remoteIp-remotePort-state`
  collisions. **The pill counts can therefore exceed the number of rows visible under
  them.** They are also computed pre-`agentFilter`, so selecting one agent narrows the
  list while the pills keep fleet-wide totals.
- `counts.all` (`:115`) is computed and never rendered — `:136` suppresses the count
  for `cls.value === 'all'`.

---

## 8. The four figures quoted in the task

Stated plainly: **the quoted numbers cannot be attributed to a specific code path
without knowing which build produced them**, and the task did not say. Both readings
are set out; §9 records this as undetermined.

`isDemoMode` is `import.meta.env.VITE_DEMO_MODE === 'true' || !window.aegis`
(`ipc.ts:135`). In demo mode the stores are driven entirely by `demo-data.js`, not by
any of the main-process paths traced above.

**If the screenshot is the demo build**, three of the four figures land exactly on
demo constants:

- `demo-data.js:44-51` — `buildAnomalies` uses `base = { calm: 8, elevated: 35,
  critical: 68, reset: 4 }[scenario.name]` and assigns
  `base + randInt(-8, 8) + i * 4` per agent, where `i` is pool order.
  `DEMO_AGENTS_POOL[0]` is **Claude Code** (`demo-pools.js:6`), so in the `calm`
  phase its anomaly score is `8 ± 8` — a literal **8** at the midpoint.
- The mean of that same map is what `AVG RISK SCORE` renders (#6). Across the
  `elevated` phase (7 agents, base 35) the mean is `35 + mean(0..6)×4 ≈ 47`; across
  `critical` (12 agents, base 68) it is `≈ 90`. **52 sits just above the elevated
  mean.** Since the scenario advances every 25 s (`demo-pools.js:79-83`) and
  `SummaryCards` is snapshot-gated (§6), a card holding an `elevated`-phase average
  beside a card showing a `calm`-phase agent is exactly the shape the task describes.
- `demo-data.js:59` seeds `totalFiles = 142` and increments it once per emitted file
  event (`:118`). **152 is that counter after ten events.** But that counter is read
  by the **Header's `files` chip (#4)** — nothing else. At that same moment the
  renderer's `events` array holds only those ten rows, so the feed would show ~10,
  not 152.

**Where the demo reading stops.** It explains the `8` / `52` pair exactly, and it does
**not** explain the `FILES 0` / `152` pair — it produces the reverse of the reported
wording (a large `files` number in the Header, a small feed). So one of two things is
true, and the code cannot decide between them:

- the `152` was the **Header's `files` chip**, in which case the demo mapping is
  complete and the report's phrasing attached that figure to the wrong element — the
  real disagreement being #4 (ring-buffer length) against #18 (`FILES 0`, a decayed
  weight sum), two numbers that share a word and nothing else; or
- the `152` was an actual **count of feed rows**, in which case the demo mapping does
  not apply to that half at all and the live-build reading below is the operative one.

Pinning down which element carried the `152` resolves it. Nothing in the source can.

**If it is the live Electron build**, the same disagreement has a different mechanism
and needs no demo data: the `8` is a `riskScore` (`risk.ts:230`) rendered by
`TrustBadge` (`AgentCard.svelte:169`) or the `PidList` tooltip (`PidList.svelte:59`);
the `52` is the anomaly mean (`SummaryCards.svelte:24-28`); a `FILES 0` is a decayed
weight sum that rounded to zero because every surviving event carried the 0.1 weight
or because attribution dropped them (`risk.ts:115-116`); and the feed count is a
merged file+network list capped at 200 (`ActivityFeed.svelte:155`).

On the naming in the task: **the Network panel renders no risk score at all**, so the
`8` did not come from there — `AgentCard`'s badge and the `PidList` tooltip are the
only two places a per-agent risk number appears. Likewise `FeedFilters` on the Shield
tab carries no counts, so a `FILES 0` is the agent card's chip (#18), not a filter
pill.

---

## 9. Not determined from the code alone

- **Which element on the reported screen carried the `152`** — the Header's `files`
  chip (#4) or a count of feed rows. This is the one fact that resolves §8, and the
  code cannot supply it.
- **Which build produced the quoted figures** — demo (`demo-data.js`) or live
  Electron. `VITE_DEMO_MODE` is a build-time env var and `window.aegis` presence is a
  runtime fact; neither is readable from source. §8 gives both mappings rather than
  picking one.
- **Whether `FILES 0` on a card is decay, dedup or attribution.** All three paths can
  drive `fileCount` to zero — 24-hour-old events weighted 0.1 (`risk-scoring.js:18`),
  the 30-second per-path dedup (`risk.ts:185`), and the `unattributed` /
  `selfAccess` skips (`risk.ts:115-116`). Distinguishing them needs the live event
  payloads, not the code.
- **Whether the pid-based event match ever silently fails.** `risk.ts:169` takes the
  pid path when the agent has a `cwd`, otherwise the name path. If the main process
  emits events with a pid that no longer matches a live agent record, `FILES` reads 0
  while the feed still shows the rows. Confirming that requires a running instance.
- **Real magnitude of the `AgentPanel` grouping skew (W3).** It depends on how many
  processes per name a real machine runs and how unevenly risk is distributed among
  them. The mechanism is certain; the size is not.
- *(determined, recorded here for completeness)* The per-pid `resource-usage` push has
  **no subscriber**. `scan-loop.js:315` sends it and `preload.js:88-91` exposes
  `onResourceUsage`, but no file under `src/renderer/` calls it — `$resourceUsage` is
  fed only by `scan-batch.resourceUsage` (`ipc.ts:143`) and the one-shot
  `getResourceUsage()` (`ipc.ts:166`), both of which carry AEGIS's own process figures
  (`main.js:124-133`). So the Footer's CPU / MEM / HEAP (#29-#31) can never show a
  monitored agent's usage: the only channel that carries per-agent numbers is dropped
  on the floor.
- **Whether any of this is already covered by a test.** No test file was opened — the
  task forbade touching them, and reading them was not needed to trace a reading path.

---

## What happened (in plain language)

Think of a dashboard in a car where the speedometer, the odometer and the fuel gauge
were each wired up by a different person on a different day. Every needle is honest
about the wire behind it — but the one labelled "speed" is actually connected to the
engine-temperature sensor, the "miles" dial counts how many receipts are currently in
the glovebox rather than how far you drove, and two clocks on the same dash started
at different moments. I opened the dashboard, traced each wire back to what it is
really attached to, and wrote down where it goes — without unscrewing or rewiring a
single thing.
