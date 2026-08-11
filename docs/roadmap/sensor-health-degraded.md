# Block B — Sensor Health / DEGRADED

**Status:** Roadmap only (no product implementation)  
**Branch context:** `feat/identity-main` @ `6494710` (Block 0 closed)  
**Date:** 2026-08-09  
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
| **Electron `powerMonitor`** | **No** | Not imported anywhere under `src/` |
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
- No `powerMonitor` suspend/resume handling
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

**None** in product code. No `powerMonitor` import.

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
- OS suspend gap → do not advance “healthy empty” streaks (B5)

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

### B1 — Sensor-health domain model (main)

- **Closes:** foundation for all B-S*  
- **Files (likely):** new `src/main/sensor-health.js` (+ tests); wire init from main  
- **Invariants:** pure transitions; no synthetic events; DISABLED ≠ DEGRADED  
- **Tests:** state machine table; lossCount>0 never HEALTHY  
- **Stop:** model + unit tests only; no sensor hooks yet  

### B2 — File observation health (chokidar + handles + RM)

- **Closes:** B-S03, B-S04, B-S06, B-S05 (file/hot), B-S09  
- **Files:** `file-watcher.js`, platform probe surface, sensor-health hooks  
- **Invariants:** handle `[]` after error → DEGRADED/FAILED not silent clean; chokidar `error` registered; read-detection capability reflected  
- **Tests:** inject getFileHandles throw; mock watcher error; mutation remove error handler  
- **Stop:** FS sensors report health; still may not ship UI  

### B3 — Process / polling scanner health

- **Closes:** B-S01, B-S02, B-S08 (partial), B-S12  
- **Files:** `process-scanner.js`, `scan-loop.js`  
- **Invariants:** unreliable empty scan must not present as healthy zero-fleet without DEGRADED; hard fail marks FAILED  
- **Tests:** EPERM path; setAgents empty + health DEGRADED; mutation drop reliable flag handling  

### B4 — Network (and future ETW) health — **CLOSED** (implementation)

- **Closes:** B-S05 (network), B-S08 remainder  
- **Files:** `network-monitor.js`, `scan-loop.doNetworkScan`, platform `getRawTcpConnections`  
- **Live contract:** sensorId `network`; valid empty TCP → HEALTHY; provider throw → FAILED; confirmed-zero skip → HEALTHY (agent-scoped); process-unavailable skip → DEGRADED  
- **ETW:** schema freeze only (see §5); **no ETW implementation**  
- **Tests:** `network-monitor-health.test.js` + platform reject paths

### B5 — Suspend / resume observation gap

- **Closes:** B-S07 (clarity vs pause), B-S10  
- **Files:** `main.js` + `powerMonitor`; sensor-health gap flag; optional rate freeze hooks  
- **Invariants:** sleep gap not counted as healthy empty observation; pause remains DISABLED  
- **Tests:** mock powerMonitor emit; fake timers — **no real sleep**  
- **Stop:** gap flag + tests; not every metric rewritten  

### B6 — IPC / stats propagation

- **Closes:** delivery of B1–B5 to renderer  
- **Files:** `main.getStats`, types, preload if needed (prefer same stats channel), `ipc.ts` types  
- **Invariants:** no new channel unless proven necessary  
- **Tests:** getStats shape; stats-update payload  

### B7 — Minimal DEGRADED UI

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
| U2 | Node timer behavior after long Windows sleep (burst vs coalesce) — verify on target OS during B5 |
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
5. Suspend/resume gap does not count as healthy empty observation  
6. Non-vacuous tests + mutation proofs for critical paths  
7. No fabricated events  

---

## 16. Next executable block

**Implement B1 only:** `sensor-health` domain model + unit tests + (optional) empty mount in main without changing sensor outcomes.

Do not start B2+ until B1 is merged/green on the feature branch.
