# Block B — Sensor Health / DEGRADED

**Status (as of 2026-08-25):** design document, largely implemented since it was written.
**Closed:** B1 (`src/main/sensor-health.js`), B2 (chokidar / handle / Restart Manager), B3
(process enumeration and the secondary detectors), B4 (network + the ETW schema freeze), B5
(`src/main/observation-gap.js` — the OS suspend / resume gap), B6 (`stats.appHealth` on the
existing stats payload) and B7 (footer chip + population-gated empty states). **Open:** B8 (the
cross-sensor umbrella suite). Per-slice detail is in §10.

*Correction, 2026-08-23.* Until this edit the header read "the process-scan record and the
renderer surfacing (B3 remainder, B6–B7) are not built", and every word of it was already false:
the process record landed in `7461209` (2026-08-09) and B6/B7 in `fa4b923`, `933abd9` and
`2c52200` on 2026-08-21, the same day the line was dated. It is recorded rather than quietly
deleted, because a stale status line is what sends the next reader to rebuild what already
exists — which is precisely what it did.  
**Branch context:** `feat/identity-main` @ `6494710` (Block 0 closed)  
**Date:** 2026-08-09 (status refreshed 2026-08-23)  
**Invariant:** *No evidence* must not automatically mean *clean*. Lost events are irrecoverable — never fabricate replacements.

This document reconstructs **live** sensing architecture from `src/`. Design leads from external recon (osquery publisher health, ETW loss counters, Electron `powerMonitor`) are **leads**, not claims that AEGIS already implements them.

---

## 1. Verified current architecture

### 1.1 Observation pipeline (main)

```
staggeredStartup / startScanIntervals / startWarmup
  ├─ doProcessScan (~scanIntervalSec, default 10s)
  │    scanner.scanProcesses → enrich identity/cwd → session reconcile
  │    → inject IDE/WSL + local LLM synthetics → anomaly → scan-batch IPC
  ├─ doNetworkScan (30s steady; 60s warmup; also on agent set change ≥15s)
  │    network.scanNetworkConnections → network-update IPC + audit
  ├─ doFileScan (≥30s / 3× process interval)
  │    watcher.scanAllFileHandles → dedup → fileAccessBatcher + audit
  └─ doHotReadScan (~10s, win32 RM only if isHotReadScanActive)
       watcher.scanHotFileHolders → same pipeline

setupFileWatchers (once after ready-to-show)
  chokidar roots (sensitive dirs, agent config, project, ~/.env*)
  → bindWatcherEvents(add|change|unlink) → handleWatcherEvent
  → activityLog + onFileEvent → dedup → batcher

setupRulesWatcher (rules YAML hot-reload — not agent evidence)
```

### 1.2 Pause semantics

| Action | Effect |
|--------|--------|
| Tray **Pause Monitoring** | `monitoringPaused = true`; `stopScanIntervals()`; chokidar still subscribed but `handleWatcherEvent` returns early |
| Tray **Resume** | `startScanIntervals()` again |
| Settings apply | restarts intervals if not paused |

Pause stops **polling intervals** and **drops live FS events**. Watchers are not closed. No “paused ≠ healthy observation” health flag is published to the renderer beyond tray tooltip `[PAUSED]`.

### 1.3 No ETW / osquery / powerMonitor today

| Technology | In `src/` product code? | Notes |
|------------|-------------------------|--------|
| **ETW** | **No** | Roadmap / README / master-plan only |
| **osquery** | **No** | Recon inspiration only |
| **Electron `powerMonitor`** | **Yes** (since B5, 2026-08-25) | Subscribed in `main.js` after `app.ready`; the gap machine is `src/main/observation-gap.js` (§10 B5). "No" until then |
| chokidar FS watch | Yes | File write evidence |
| Polling process/network/handles | Yes | Primary sensors |

---

## 2. Sensor inventory

| Sensor ID | Implementation | Source / API | Cadence / lifecycle | Evidence produced | Detectable failures (today) | Surfaced to UI? |
|-----------|----------------|--------------|---------------------|-------------------|-----------------------------|-----------------|
| **S-PROC** | `process-scanner.js` + `scan-loop.doProcessScan` | Platform `listProcesses` (tasklist/CIM/ps) | Interval; reentrancy guard | Agent list, enter/exit, scan-batch | EPERM/EACCES → empty + `reliable:false`; other errors log + empty tick | Partial: `stats.permissionDeniedScans` if >5 consecutive; Header **Scanning/Idle** only |
| **S-NET** | `network-monitor.js` + `doNetworkScan` | Platform TCP table (PS / lsof) | 30s (60s warmup); skip if no agents or scan in flight | `NetworkConnection[]`, audit `network-connection` | `.catch` logs error; leaves last connections until next success | No health; empty vs fail not distinguished on channel |
| **S-FS-CHOKIDAR** | `file-watcher.setupFileWatchers` + `handleWatcherEvent` | chokidar `add`/`change`/`unlink` | Persistent watchers once started | `FileEvent` (created/modified/deleted), inferred/unattributed | Pause swallows; no `watcher.on('error')`; missing dirs skipped | No |
| **S-FS-HANDLE** | `scanAllFileHandles` / `scanFileHandles` | handle.exe or modules; errors → `[]` | With file scan interval | `FileEvent` `accessed` / confirmed PID | Per-PID `catch → []`; binary missing short-circuits | Log only; probe sets internal flags |
| **S-FS-RM** | `scanHotFileHolders` / RM holders | Restart Manager (win32) | ~10s hot + full cycle | `FileEvent` `holding` | RM unavailable; single-flight skip; catch logs | Startup probe logs once; **not** on IPC |
| **S-IDE-EXT** | `ide-extension-detector.js` | FS walk of editor extension dirs | Background cache | Synthetic agents (pid 0) | Silent `.catch` empty cache | Appears as missing agents only |
| **S-WSL** | `wsl-detector.js` | WSL enumeration | Background cache | Synthetic agents | Silent catch | Same |
| **S-LLM** | `llm-runtime-detector.js` | HTTP probe Ollama/LM Studio | Each process scan | Synthetic local-runtime agents + models | Probe fail → no synthetic | Missing model agents |
| **S-TOKEN** | token-tracker / adapters | Claude JSONL tails | With process scan | Token/cost records | Birth-time drop warn; empty honest | Token UI empty |
| **S-RES** | `resource-monitor.js` | Platform resource fetch | After process scan FAF | Per-PID CPU/RAM map | `.catch` log; no update | Stale/empty resources |
| **S-AUDIT** | `audit-logger` + `audit-drop-tracker` | Disk append + buffer | On event | JSONL records | Buffer eviction → `buffer-overflow-drop` markers + `droppedEntries` | AuditLog UI when drops >0 |
| **S-RULES** | `setupRulesWatcher` | chokidar on `rules/` | Lifecycle of rules watch | Rule hot-reload only | Not agent evidence | N/A for agent evidence health |

**Not sensors:** SummaryCards, RiskIndex, tray color (risk-derived), kill/suspend/resume (actuators).

---

## 3. Current health model

### 3.1 What exists (fragmented)

| Signal | Location | Meaning |
|--------|----------|---------|
| `scanActive` | IPC `scan-status` | At least one process/file scan in `updateScanStatus` — **busy indicator**, not sensor integrity |
| Header “Scanning” / “Idle” | `$scanActive` | Same |
| `firstScanDone` | First `scan-batch` | UI empty-state vs skeleton — not sensor health |
| `permissionDeniedScans` | `getStats()` | Consecutive EPERM/EACCES on process list; Footer if >5 |
| `monitoringPaused` | main + tray | Operator disabled polling / FS emit |
| `liveDataUnavailable` | renderer no preload | Desktop bridge missing — “not running”, not DEGRADED |
| `isReadDetectionAvailable` / RM probe | win32 only | Internal + one-shot log; **not** in stats/IPC |
| Audit `droppedEntries` | audit getStats | Persistence loss, not live sensor loss |
| Session `reliable: false` | process scan → session-tracker | Prevents false agent-exit; **UI still gets empty agent list** |

### 3.2 What does not exist

- No per-sensor status object (`HEALTHY` / `DEGRADED` / …)
- No `lastSuccessAt` / `lastAttemptAt` / `consecutiveFailures` per sensor
- No published lost-event counters for FS/network (only audit buffer drops)
- No global DEGRADED tray/renderer state for observation integrity
- No `powerMonitor` suspend/resume handling — *closed by B5 (2026-08-25): `stats.observationGap`,
  a sibling of `appHealth`, see §10*
- No ETW session / EventsLost / BuffersLost
- No osquery-style publisher table

**Conclusion:** Health signals are **fragmented and incomplete**. There is **no** central sensor-health model to extend — Block B must introduce a minimal domain model. Prefer attaching it to existing `getStats()` / `stats-update` rather than inventing a parallel IPC family unless capacity forces it.

---

## 4. Block-B findings (false-clean / integrity gaps)

### B-S01 — Process scan EPERM → empty agent fleet

| | |
|--|--|
| **Source** | `process-scanner.scanProcesses` + `doProcessScan` → `setAgents([])` |
| **Failure** | EPERM/EACCES (or “access is denied”) |
| **Behavior** | `reliable: false`; session reconcile no-ops; **agents array empty still sent** |
| **False confidence** | Dashboard: zero agents = “nothing running”. Session tracker is honest; **UI is not**. |
| **Severity** | High |
| **Slice** | B1 + B3 + B6 + B7 |

### B-S02 — Process scan hard failure → log only

| | |
|--|--|
| **Source** | `doProcessScan` outer `catch` |
| **Failure** | Non-permission throw |
| **Behavior** | Log error; leave previous `latestAgents` until next success (or initial empty) |
| **False confidence** | Stale agents look live; or empty stays empty without DEGRADED |
| **Severity** | High |
| **Slice** | B3 |

### B-S03 — File handle scan: per-agent catch → `[]`

| | |
|--|--|
| **Source** | `file-watcher.scanFileHandles` `catch (_) { return []; }` |
| **Failure** | handle spawn/error/timeout |
| **Behavior** | Empty handles for that PID — same as “no open files” |
| **False confidence** | No `accessed` events = clean FS posture for that agent |
| **Severity** | High |
| **Slice** | B2 |

### B-S04 — Read-detection unavailable not in UI

| | |
|--|--|
| **Source** | `probeReadDetection` / `isReadDetectionAvailable` |
| **Failure** | No handle.exe and no RM (win32) |
| **Behavior** | One log warn; holding/accessed paths disabled or empty |
| **False confidence** | Chokidar-only writes may still fire; hold/read blind spot invisible |
| **Severity** | High (Windows secret dirs) |
| **Slice** | B2 + B6 + B7 |

### B-S05 — File/network/hot scan failures → log, empty interval

| | |
|--|--|
| **Source** | `doFileScan` / `doHotReadScan` / `doNetworkScan` `.catch` |
| **Failure** | Any thrown error |
| **Behavior** | Log; no events/update; next tick looks like quiet machine |
| **False confidence** | Events/min → 0; risk file activity decays; “calm” |
| **Severity** | High |
| **Slice** | B2, B3, B4 |

### B-S06 — Chokidar has no error subscription

| | |
|--|--|
| **Source** | `bindWatcherEvents` only `add`/`change`/`unlink` |
| **Failure** | Watcher error, EMFILE, root deleted, native crash |
| **Behavior** | Unknown; no health transition |
| **False confidence** | Silence after watcher death |
| **Severity** | High |
| **Slice** | B2 |

### B-S07 — Pause looks like clean zero activity

| | |
|--|--|
| **Source** | `monitoringPaused` + stopped intervals + early return in handler |
| **Failure** | Operator pause (intentional) vs crash |
| **Behavior** | No events; Monitoring Duration still advances (`now - monitoringStarted`) |
| **False confidence** | Duration and quiet UI suggest ongoing clean watch unless tray `[PAUSED]` noticed |
| **Severity** | Medium (intentional DISABLE should be explicit `DISABLED`, not DEGRADED) |
| **Slice** | B1 + B5 + B7 |

### B-S08 — Network scan skipped when agents.length === 0

| | |
|--|--|
| **Source** | `doNetworkScan` early return |
| **Failure** | Coupled to process list empty (including B-S01) |
| **Behavior** | No network observation attempt |
| **False confidence** | No connections = safe network; actually never scanned |
| **Severity** | Medium–High (amplifies B-S01) |
| **Slice** | B3 / B4 |

### B-S09 — Hot RM single-flight skip returns `[]`

| | |
|--|--|
| **Source** | `_rmScanInFlight` short-circuit |
| **Failure** | Overlapping full/hot tick |
| **Behavior** | Empty array (intentional cost guard) |
| **False confidence** | Mild: missed sample window, not permanent death |
| **Severity** | Low–Medium |
| **Slice** | B2 (document as degraded sample, not full OFFLINE) |

### B-S10 — No suspend/resume gap handling

| | |
|--|--|
| **Source** | Absence of `powerMonitor` |
| **Failure** | OS sleep while process “alive” |
| **Behavior** | Wall clock advances; intervals backlog/fire; rates and decays include sleep |
| **False confidence** | Events/min collapse; monitoring duration includes sleep; anomaly windows skew |
| **Severity** | Medium–High |
| **Slice** | B5 |

### B-S11 — Audit buffer loss is honest; live sensors are not

| | |
|--|--|
| **Source** | `audit-drop-tracker` vs live sensors |
| **Contrast** | Audit **does** mark irrecoverable loss on disk |
| **Severity** | Design asymmetry (positive precedent for B) |
| **Slice** | B1 pattern to mirror for sensors |

### B-S12 — IDE/WSL/LLM detector failures silent

| | |
|--|--|
| **Source** | extension/WSL/HTTP probes |
| **Behavior** | Empty cache / no synthetic |
| **False confidence** | Missing agent types treated as not installed |
| **Severity** | Medium |
| **Slice** | B3 (secondary sensors) |

---

## 5. Loss model

| Source | Loss reporting today | Cumulative? | Reset | AEGIS reads it? |
|--------|---------------------|-------------|-------|-----------------|
| Audit write buffer | `droppedEntries` + `buffer-overflow-drop` markers | Process lifetime total + pending window | Process restart; pending clears after successful flush | Yes (AuditLog) |
| Process EPERM | `permissionDeniedScans` consecutive | Resets to 0 on success | Yes | Footer if >5 |
| Handle/RM/chokidar/network | **None** | — | — | No |
| ETW EventsLost/BuffersLost | **N/A — ETW not implemented** | — | — | FUTURE PRODUCER |

### Irrecoverability rule (Block B contract)

```
If a sensor reports lossCount > 0 for an interval (or cumulative since last healthy):
  state ≠ HEALTHY
  do not synthesize missing observations
  do not “fill gaps” into risk/anomaly inputs
```

### ETW (future producer requirement)

When/if AEGIS attaches an ETW session (Phase C / later):

- Read session statistics (Microsoft ETW session stats: events lost, buffers lost — exact API binding TBD at implementation time)
- Map `loss > 0` → DEGRADED for that sensor
- **Do not** invent replacement events

**Current Block B must not claim ETW health exists.** Slice B4 covers **network poll** loss/failure first; ETW is a **future** extension of the same health fields.

### ETW health / loss schema freeze (B4 — documentation only)

**Live status (revalidated):** **No ETW implementation** in product `src/` — no OpenTrace/ProcessTrace, no EventsLost/BuffersLost readers, no native addon, no C# helper. Mentions remain roadmap/README/master-plan only.

**Frozen future producer contract** (B1 fields only; no runtime code until ETW lands):

| State | Meaning for an ETW session/provider |
|-------|-------------------------------------|
| **STARTING** | Session expected active but not yet proven operational |
| **HEALTHY** | Session/provider operational; no unresolved known event/buffer loss on this health-record lifetime |
| **DEGRADED** | Session operational but completeness impaired (e.g. newly observed EventsLost or BuffersLost &gt; 0) |
| **FAILED** | Session/provider cannot continue valid observation |
| **UNSUPPORTED** | Platform/environment cannot support producer by design |
| **DISABLED** | Intentionally disabled |

**Loss invariants (irrecoverable):**

1. EventsLost and BuffersLost are **observation loss**, not generic command errors.
2. Any positive newly observed loss → health **must not remain HEALTHY** (use `addLoss` / DEGRADED per B1).
3. Lost observations are irrecoverable; later successful callbacks **must not** clear residual `lossCount` or fabricate replacement events.
4. Do not synthesize network/process/file evidence for lost ETW records.
5. B1 `lossCount` is cumulative for **one health-record lifetime**.

**EventsLost / BuffersLost aggregation — UNKNOWN until producer selected:**

- Source fields **must be retained separately** at the producer boundary (do not drop either counter).
- Mapping into a single B1 `lossCount` must use a **mathematically justified non-overlapping** count.
- Do **not** sum EventsLost+BuffersLost until Windows API semantics for the chosen session model are verified (risk of double-count).
- `detail` / side fields may preserve both counters even when only one contributes to `lossCount`.

**Session lifetime / reset:**

- ETW health-record lifetime = **one ETW session instance**.
- A **new session** → `createSensorHealth` (fresh record, lossCount 0).
- Ordinary successful session callbacks do **not** clear residual loss.
- If OS counters are cumulative per session, the adapter must track **deltas or authoritative totals without double-counting** the same lost unit twice.

**Sensor IDs:** Runtime IDs (`etw-network`, `etw-process`, …) **deferred** until producer scope is chosen. Do not invent multiple IDs in advance.

**No ETW product code in B4.**

---

## 6. Suspend / resume audit

### 6.1 Current support

**None** in product code. No `powerMonitor` import. — *True when written; since B5 (2026-08-25)
`main.js` subscribes `powerMonitor` `suspend` / `resume` after `app.ready` and
`src/main/observation-gap.js` holds the gap machine. The live contract is in §10 B5.*

(Note: IPC `suspend-process` / `resume-process` are **agent process control**, not OS sleep.)

### 6.2 Time-sensitive systems vs sleep

| System | Behavior across OS sleep | Classification |
|--------|--------------------------|----------------|
| **Events/min** | Window `[now-60s, now]` in wall clock; sleep empties window | Temporarily distorted / self-correcting after wake+events |
| **Monitoring Duration** | `now - monitoringStarted` includes sleep | Semantically wrong as “observation time” |
| **File activity decay** | `getTimeDecayWeight` uses wall age | Sleep ages events as if observation continued |
| **Risk fileCount / recency** | Same decay | Distorted |
| **Anomaly session windows** | Wall-time sessions | Distorted if sleep mid-session |
| **Scan intervals** | Node timers; may fire burst on wake | Unknown / implementation-dependent |
| **Sensor freshness** | No lastSuccess — N/A | Missing |
| **Pause (operator)** | Distinct from OS sleep | Need DISABLED vs DEGRADED |

### 6.3 Required Block-B semantics (design only)

On `suspend` (when wired):

- Mark observation gap: sensors not credited with healthy empty ticks during sleep
- Optionally freeze or annotate time-based rates until first post-resume success

On `resume`:

- Force sensor re-probe / next scan marked post-gap
- Do **not** score the sleep gap as “zero agent activity” for anomaly

Do **not** redesign every wall-clock metric in B5 — prioritize sensor health + explicit gap flag.

---

## 7. Target health contract (minimum)

### 7.1 States (use only these)

| State | Meaning |
|-------|---------|
| **STARTING** | Sensor not yet completed first successful attempt this process life |
| **HEALTHY** | Last attempts succeed; no known loss; results are trustworthy empty or non-empty |
| **DEGRADED** | Running but incomplete observation (partial failure, loss > 0, capability missing while monitoring expected) |
| **FAILED** | Consecutive failures exceed threshold; no usable recent observation |
| **DISABLED** | Operator pause or config-off — silence is intentional |
| **UNSUPPORTED** | Platform/capability never available (e.g. RM on non-win32) |

`OFFLINE` not required if FAILED covers it.

### 7.2 Fields (per sensor)

```
sensorId: string
state: STARTING | HEALTHY | DEGRADED | FAILED | DISABLED | UNSUPPORTED
lastAttemptAt: number | null   // ms epoch
lastSuccessAt: number | null
lastError: string | null       // short message, no secrets
consecutiveFailures: number
lossCount: number              // 0 when sensor cannot report loss
detail?: string                // e.g. "read-detection unavailable"
```

### 7.3 Transition rules (summary)

- Success with `lossCount === 0` → HEALTHY (from STARTING/DEGRADED/FAILED)
- Success with `lossCount > 0` → DEGRADED
- Failure → increment consecutiveFailures; after N → FAILED (N TBD, e.g. 3)
- Capability probe fail while monitoring on → DEGRADED or UNSUPPORTED
- Operator pause → DISABLED for polled sensors; chokidar emit gated
  - **As of 2026-08-21 this line is superseded and NOT implemented.** `monitoringPaused`
    is an operator-control dimension orthogonal to health: nothing calls `markDisabled`
    on pause, and the app-level model never reads the flag. Writing operator intent into
    a leaf record would drop those sensors out of `participatesInGlobal` and push the
    aggregate toward `AGGREGATE_NONE`, so pause would have changed the health model
    rather than sat beside it. The flag travels as `stats.monitoringPaused`, a sibling of
    `stats.appHealth`.
- OS suspend gap → do not advance “healthy empty” streaks (B5)
  - **As of 2026-08-25, implemented — and NOT as a leaf state.** No tick runs while the OS
    sleeps, so the leaves and `lastSuccessAt` never move during a gap by construction; the one
    place a sleep could be credited as an observation is the tick whose provider `await`
    straddled it, and that tick's session reconcile is frozen (`gapStraddled`, the third freeze
    cause beside `reliable: false` and `identityDegraded`). The gap itself is
    `stats.observationGap`, a sibling of `appHealth` like `monitoringPaused`, cleared only by
    the first tick whose reconcile was not frozen. See §10 B5.

### 7.4 Aggregate monitoring health

```
global = worst of active sensors (FAILED > DEGRADED > STARTING > HEALTHY)
DISABLED sensors excluded from worst-of
UNSUPPORTED excluded or shown separately
```

---

## 8. Data flow (proposed)

```
sensor attempt result
  → sensor-health module (main, pure transitions + store)
  → merge into getStats() as stats.sensorHealth { byId, global }
  → existing stats-update batcher / get-stats IPC
  → renderer $stats
  → minimal UI (Footer/Header/tray)
```

**Prefer extending `getStats()`** — already carries `permissionDeniedScans`, uptime, etc.  
Avoid a new push channel unless stats cadence is insufficient for FAILED (stats already push on file events and scans).

Audit drops remain on **audit** stats path (already honest).

---

## 9. Minimal UI requirement

| Current | Risk |
|---------|------|
| Header green-ish shield / “Idle” | Can look calm with dead sensors |
| Footer perm warn only if >5 | Only process EPERM |
| Tray color from risk, `[PAUSED]` | Pause ≠ DEGRADED |
| Bridge banner | Only no preload |

**Minimum Block B UI (B7):**

1. Persistent indicator when `global ∈ {DEGRADED, FAILED}` (Footer chip or Header badge) — not only toast  
2. Tray tooltip append e.g. `DEGRADED: process-scan`  
3. Do **not** redesign dashboard  

**Monitoring** Settings toggle today = interval/config, **not** sensor integrity. Keep labels distinct: “Paused” vs “Degraded observation”.

---

## 10. Implementation slices

### B1 — Sensor-health domain model (main) — **CLOSED** (`273dedc`)

- **Closes:** foundation for all B-S*  
- **Files (likely):** new `src/main/sensor-health.js` (+ tests); wire init from main  
- **Invariants:** pure transitions; no synthetic events; DISABLED ≠ DEGRADED  
- **Tests:** state machine table; lossCount>0 never HEALTHY  
- **Stop:** model + unit tests only; no sensor hooks yet  

### B2 — File observation health (chokidar + handles + RM) — **CLOSED**

- **Live contract:** leaves `fs-chokidar` / `fs-handle` / `fs-rm` in `file-watcher.js`; the
  chokidar state is derived from the watch-root plan registry (`996629b`), and `fs-rm` is
  UNSUPPORTED on a platform with no Restart Manager.
- **Closes:** B-S03, B-S04, B-S06, B-S05 (file/hot), B-S09  
- **Files:** `file-watcher.js`, platform probe surface, sensor-health hooks  
- **Invariants:** handle `[]` after error → DEGRADED/FAILED not silent clean; chokidar `error` registered; read-detection capability reflected  
- **Tests:** inject getFileHandles throw; mock watcher error; mutation remove error handler  
- **Stop:** FS sensors report health; still may not ship UI  

### B3 — Process / polling scanner health — **CLOSED**

- **Closes:** B-S01, B-S02, B-S08 (partial), B-S12  
- **Files:** `process-scanner.js`, `scan-loop.js` (`7461209`, `28f77b1`); `ide-extension-detector.js`,
  `wsl-detector.js`, `llm-runtime-detector.js` and the leaf registration in `main.getAppHealth`
  (the B-S12 remainder, 2026-08-23)  
- **Live contract — the `process` leaf** (`process-scanner.js`, one persistent record, never
  recreated per poll): a valid enumeration → HEALTHY, and an empty AGENT fleet read out of a
  process table that WAS enumerated is a confirmed clean fleet — agent cardinality is not health.
  EPERM/EACCES → FAILED (`permission-denied`), compatibility shape stays `{agents: [], reliable:
  false}`. A non-permission throw → FAILED via `noteProcessScanHardFailure`, called from the
  scan-loop catch that encloses ONLY the provider call, so a downstream pipeline throw writes no
  leaf. An enumeration that returns WITHOUT an error and carries no process at all → DEGRADED
  (`empty-process-table`): a live OS lists at least the process doing the asking, so that is an
  unread table, and a zero-agent fleet derived from it is the B-S01 false-clean by another route.
  `reliable` is compatibility metadata and is true exactly when the leaf is HEALTHY.  
- **Live contract — secondary detectors (B-S12):** four further leaves, deliberately NOT folded
  into `process`. That leaf's state drives `populationReliable`, the gate every pid-scoped sensor
  reads before observing, and a failed WSL probe says nothing about whether the pid list can be
  trusted (cf. ai-mistakes #29).
  `ide-extension`: process list unreadable → FAILED; a RUNNING editor whose extensions dir fails
  to read for any reason other than ENOENT/ENOTDIR → DEGRADED (those two stay a definite absence);
  otherwise HEALTHY.
  `wsl`: non-win32, no `wsl.exe`, or a `wsl.exe` that RAN and reported no distribution →
  UNSUPPORTED (out of the worst-of — the binary ships in System32 on stock Windows, and holding
  every such machine DEGRADED would be a warning that is always on); a probe that produced no
  verdict at all — a timeout kill, a spawn failure — → DEGRADED and, unlike before, **not cached**,
  so the next 60 s cycle asks again; WSL present but its process list unreadable or empty →
  DEGRADED; a list that was read → HEALTHY.
  `llm-ollama` / `llm-lmstudio`: one record per PROBE, because the two run concurrently under one
  `Promise.all` and a shared record would let the definite answer overwrite the uncertain one.
  ECONNREFUSED and a completed response that is not this runtime's JSON are definite negatives
  (HEALTHY — port 1234 collides with stock dev servers); a timeout or a broken transport is no
  observation (DEGRADED).  
- **Invariants:** an unreliable empty scan must not present as a healthy zero-fleet without
  DEGRADED; a hard failure marks FAILED; no `addLoss` caller anywhere in this slice (no
  quantitative loss counter exists for these sensors, so the cumulative-loss invariant is held by
  the B1 model, not by new code); operator pause is not a health state (§7.3).  
- **Tests:** `process-scanner-health.test.js`, `scan-loop-provider-health.test.js`,
  `detector-health.test.js`. Mutations, each run red and reverted: drop the empty-table rung → 3
  red; drop the ide-extension DEGRADED write → 3 red; collapse an llm timeout into a definite
  answer → 3 red; restore the cached `false` on a transient WSL probe failure → 1 red.  

### B4 — Network (and future ETW) health — **CLOSED** (implementation)

- **Closes:** B-S05 (network), B-S08 remainder  
- **Files:** `network-monitor.js`, `scan-loop.doNetworkScan`, platform `getRawTcpConnections`  
- **Live contract:** sensorId `network`; valid empty TCP → HEALTHY; provider throw → FAILED; confirmed-zero skip → HEALTHY (agent-scoped); process-unavailable skip → DEGRADED  
- **ETW:** schema freeze only (see §5); **no ETW implementation**  
- **Tests:** `network-monitor-health.test.js` + platform reject paths

### B5 — Suspend / resume observation gap — **CLOSED** (2026-08-25)

- **Closes:** B-S07 (clarity vs pause), B-S10  
- **Files:** `src/main/observation-gap.js` (new, pure: no Electron, no timers, injected clock
  and an injected `{on}` for `powerMonitor`); `main.js` (subscription after `app.ready`, the
  `observationGap` sibling on BOTH `getStats` branches, the `observation-gap` audit record on
  resume); `scan-loop.js` (straddle witness + first-tick tag); `session-tracker.js`
  (`gapStraddled`); `src/shared/types/events.ts`, `src/shared/ecs-normalizer.js`,
  `docs/ECS-MAPPING.md` (the audit type and its `host` / `info` route)  
- **Live contract — the representation.** `stats.observationGap` =
  `{ state: NONE | SUSPENDED | RESUMED, suspendedAt, resumedAt, gapMs, clearedAt, suspendCount,
  totalGapMs }`, a SIBLING of `appHealth` and `monitoringPaused`, never inside either. Not a
  sensor-health leaf: a leaf names one sensor's observation and joins the worst-of, and no sensor
  is broken by a sleep. Not an app-health reason: that module derives from a snapshot with no
  stored machine and no clock, and a gap is a stored event with two ends. `suspendedAt` is
  `null` and `gapMs` is `null` when the resume arrived without a seen suspend — the flag still
  arms; a gap of unknown length is still a gap.  
- **Live contract — the rule.** No tick runs while the OS sleeps (Node timers do not fire),
  so the leaves and `lastSuccessAt` never move during a gap by construction; the ONE place a
  sleep could be credited as an observation is the process tick whose provider `await`
  straddled it. scan-loop takes a SNAPSHOT of `suspendCount` before `scanner.scanProcesses()`
  and compares it with one taken after `enrichWithParentChains` — never a live read, which
  would also freeze the honest first tick after resume — and a count that moved freezes the
  session reconcile (`gapStraddled`, handled exactly like `reliable: false` and
  `identityDegraded`: no enter, no exit, no aging) with a `scan/session-freeze
  reason: suspend-straddle` log line. `process-scanner` takes its `now` BEFORE its await, so
  the leaf a straddled tick writes carries the pre-sleep `lastSuccessAt` / `populationAsOf`;
  pinned by test. RESUMED clears to NONE from the first tick whose reconcile was not frozen
  and from nothing else — a permission-denied enumeration, a degraded identity or a straddle
  after resume leaves it armed. Post-resume ticks log `postGap: { suspendedAt, resumedAt,
  gapMs, cleared }`.  
- **Live contract — the record.** One `observation-gap` audit record per resume (not per
  suspend: the 5 s flush may not run before the OS freezes, and it would only reach disk after
  the resume anyway): `action: os-resume`, no agent, `pid` / `instanceId` / `attribution`
  `null`, `details: { cause: os-suspend, suspendedAt, resumedAt, gapMs, suspendCount,
  monitoringPaused, activeSessions }`. It is written from the resume handler, so it sits in the
  JSONL AHEAD of any `agent-exit` a post-sleep reconcile goes on to write after `grace` misses;
  the exit still names the last PRE-sleep sighting. `monitoringPaused` on the record is B5's
  answer to B-S07: a pause across a sleep leaves the flag armed (no tick runs), and the record
  says why the silence continued.  
- **Invariants:** sleep gap not counted as healthy empty observation; pause stays orthogonal
  (§7.3) and is not read by the gap machine; nothing fabricated — the flag explains a hole, it
  never fills one.  
- **Tests:** `observation-gap.test.js` (the machine, `attach` on an `EventEmitter`, the record
  builder), `scan-loop-observation-gap.test.js` (real scan-loop / scanner / session-tracker under
  fake timers: clear, straddle in the enumeration, straddle in the identity stamp, EPERM and
  identity-degraded leave it armed, `observation-gap` before `agent-exit`, absent collaborator),
  `main-observation-gap-stats.test.js` (the sibling on the pre-load branch, `appHealth` key set
  unchanged), `session-tracker.test.js` (+2), `app-health.test.js` N4 (an injected gap is not an
  input), `ecs-normalizer.test.js` (+1). Fake timers only — **no real sleep**.  
- **Residuals, on the record (not rewritten, per the stop line):** monitoring duration and
  `uptimeMs` still include the sleep (`totalGapMs` rides beside them for a future UI slice);
  events/min, file decay, baseline session windows and open sequence windows age across a sleep
  — an expiry is not a credit, and extending a window would be fabrication (§15.7); handle / RM
  / network scans that straddle a sleep stamp their records at write time, the existing
  contract (`docs/ECS-MAPPING.md` §5); `latestNetConnections` holds pre-sleep sockets for at most
  one network interval; intervals are not stopped on suspend and not restarted on resume, so
  the design does not depend on U2. `lock-screen` / `shutdown` are not subscribed.  

### B6 — IPC / stats propagation — **CLOSED** (`fa4b923`)

- **Live contract:** `main.getStats()` carries `stats.appHealth` (state, reasons, the full
  capability contract, `sensors.byId` / `raw` / `effective` / `projections`, `watchPlan`) on the
  EXISTING stats payload — no new channel. `monitoringPaused` rides beside it, never inside it.
  A leaf added to `getAppHealth`'s `records` array reaches the renderer with no renderer change.
- **Closes:** delivery of B1–B5 to renderer  
- **Files:** `main.getStats`, types, preload if needed (prefer same stats channel), `ipc.ts` types  
- **Invariants:** no new channel unless proven necessary  
- **Tests:** getStats shape; stats-update payload  

### B7 — Minimal DEGRADED UI — **CLOSED** (`2c52200`, `933abd9`)

- **Live contract:** the footer chip names the degraded and failed sensors from
  `sensors.effective.degradedSensorIds` / `failedSensorIds` — sensor IDS, generic, so a new leaf
  appears there without a renderer edit — and the empty agent states gate on
  `appHealth.populationState === 'FAILED'`, the enum, never on the collapsed boolean.
- **Closes:** false confidence visuals  
- **Files:** Footer and/or Header, tray-icon tooltip  
- **Invariants:** DEGRADED/FAILED visible without opening AuditLog  
- **Tests:** component/store pure helper for badge text  

### B8 — Integration / non-vacuous failure suite

- **Closes:** cross-sensor regressions  
- **Tests:** multi-sensor worst-of global; mutation proofs per critical registration  
- **Stop:** Block B complete checklist  

**Order:** B1 → B2 ∥ B3 → B4 → B5 → B6 → B7 → B8  
(B2/B3 can parallel after B1; B6 needs at least one of B2–B4 hooked.)

---

## 11. Test / mutation strategy

| Pattern | Example |
|---------|---------|
| DI failure | `_setDepsForTest({ getFileHandles: async () => { throw new Error('x') } })` |
| Unreliable scan | mock `listProcesses` reject EPERM |
| Chokidar error | fake watcher emit `error` after B2 registers handler |
| Loss | set lossCount in health store; assert state ≠ HEALTHY |
| Suspend | mock `powerMonitor.on` callbacks |
| Mutation | remove health update line → test fails |
| Forbidden | real `sleep`, real OS ETW without mock, flaky wall-clock |

---

## 12. Future dependencies

| Block | Relationship |
|-------|----------------|
| **Block C resource metrics** | Resource monitor is a sensor (S-RES); health model should accept it without schema break. Freeze `sensorId` + stats.sensorHealth shape. |
| **Block D bounded pipeline** | Dropped/backpressure events should update loss or DEGRADED — same fields. Do not invent separate “pipeline health” without mapping. |
| **Identity UI roll-up** | Orthogonal; health is process-global, not instanceId. |
| **ETW/eBPF (Phase C/5)** | Future producer of lossCount; health contract ready before producer. |

---

## 13. Out of scope (this roadmap phase)

- Implementing any B1–B8 product code (this document only)
- ETW session creation
- osquery embedding
- Risk/anomaly formula changes
- Identity pipeline changes
- Full dashboard redesign
- Synthetic event generation
- Protected paths `docs/current-state/`, `docs/recon/`

---

## 14. Unresolved UNKNOWN

| ID | Question |
|----|----------|
| U1 | Exact N for consecutiveFailures → FAILED (propose 3; measure false positives later) |
| U2 | Node timer behavior after long Windows sleep (burst vs coalesce) — verify on target OS during B5. *B5 (2026-08-25): still unverified on the target OS, and the design no longer depends on it — whatever fires after resume, the flag clears from the first tick whose reconcile was not frozen, and a burst of ticks is a burst of real observations.* |
| U3 | Whether chokidar closes itself on fatal error or hangs silent — confirm with injected error in B2 |
| U4 | Exact Win32 ETW stats API binding when ETW lands (not Block B) |
| U5 | Should network still scan system-wide when agent list empty-but-DEGRADED? Product choice in B3/B4 |

---

## 15. Stopping conditions (Block B complete)

Block B is done when:

1. Every inventory sensor that can false-clean has health reporting or documented UNSUPPORTED/DISABLED  
2. Global DEGRADED/FAILED visible without log diving  
3. Loss never maps to HEALTHY  
4. Operator pause is DISABLED, not DEGRADED
   — **as of 2026-08-21, superseded by the orthogonality decision (see §7.3).** Pause is
   neither DISABLED nor DEGRADED: it is not a health state at all, and the stopping
   condition it must satisfy instead is that a paused AEGIS never reads as a clean one.  
5. Suspend/resume gap does not count as healthy empty observation
   — **as of 2026-08-25, held by B5 (§10): the straddled tick is frozen, the flag clears only
   from a reconciled tick, and the gap is a sibling of the health value, not a member of it.**  
6. Non-vacuous tests + mutation proofs for critical paths  
7. No fabricated events  

---

## 16. Next executable block

**Implement B8:** the cross-sensor umbrella suite (§10) — a multi-sensor worst-of global driven
through the real leaves, a mutation proof per critical health registration, and the Block B
stopping checklist (§15) walked with evidence. B5 landed 2026-08-25 (§10).

*Refreshed 2026-08-25:* this section pointed at B5 until B5 merged; it now points at B8, the
last open slice.

*Refreshed 2026-08-23.* This section said "Implement B1 only … do not start B2+ until B1 is
merged" for as long as B1 through B4, B6 and B7 were being merged past it. A "next block" line
that names a finished block is not merely stale, it is an instruction — keep it moving with §10
or delete it.
