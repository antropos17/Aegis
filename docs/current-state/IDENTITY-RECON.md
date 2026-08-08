# IDENTITY-RECON — where AEGIS keys an agent, and on what

Read-only reconnaissance of every place that builds or consumes an agent identity key,
in `src/main/` and `src/renderer/`. No source file was modified.

**Repo root:** `X:\Future\ESCAPE\AEGIS`
**Recon date:** 2026-08-06
**Branch / HEAD:** `fix/js-yaml-5` @ `a6dccc7`
**Working tree:** clean except one untracked file (`docs/current-state/NUMBERS-RECON.md`).
Every line reference below is a working-tree reference.

**Scope bound:** `src/main/`, `src/renderer/`, `src/shared/types/`, and `tests/`. Not
covered: `src/renderer/lib/stores/demo-*.js` (fabricated data, demo build only) and
`src/main/cli.js` (no renderer path). Both carry agent names but no identity key that any
production store reads.

---

## 0. Headline

**63 identity-key sites** — 14 in main (§3, one of which — §3.2 — is the `instanceId` stamp
itself rather than a consumer; §3.12 derives its key from §3.11) and 49 in the renderer
(§4.1 = 12, §4.2 = 4, §4.3 = 33). Of the six event kinds the main process emits,
**exactly one (`token-costs`) carries `instanceId` unconditionally**; one (`scan-batch`)
carries it for scanner-derived agents but not for the pid-0 synthetics injected after the
stamp; the remaining four carry none. The renderer's own key is
`instanceKey = name::cwd → name::parentEditor → name` (`risk.ts:68-72`), which is a
*different* key from `instanceId` in kind: it is derived from display attributes, not from
an OS observation. It was also the key events were correlated by, which is what collapsed
two projects into one; step 5 moved correlation onto `instanceId` and left `instanceKey`
as what it always was — the durable permissions key.

---

## 1. The canonical `instanceId`

### 1.1 Where it is produced

One stamp site, one derivation function.

| What | Where |
|---|---|
| Pure derivation | `src/main/process-identity.js:126-145` (`identify`), `:153-155` (`buildInstanceId`) |
| The only stamp onto a scanned agent | `src/main/process-utils.js:182-184`, inside `enrichWithParentChains` |
| Birth-time source | `src/main/platform/win32.js:108-112` (`startTime` from `Win32_Process.CreationDate`) |
| Ordering guarantee | `src/main/scan-loop.js:222` — `enrichWithParentChains` runs before `sessionTracker.reconcile` at `:226` |

### 1.2 Format and the three value spaces

`process-identity.js:126-145`:

| Space | Format | `instanceIdSource` | Condition |
|---|---|---|---|
| 1 | `` `${pid}:${startTime}` `` | `'os'` | `pid > 0` and `startTime` finite `> 0` |
| 2 | `` `0:${name}` `` | `'synthetic'` | `pid === 0` and a non-empty normalised name (`process` preferred over `agent`, lowercased, whitespace → `-`) |
| 3 | `` `${pid}:u` `` | `'unknown'` | everything else; an unusable pid normalises to `0`, giving `0:u` |

### 1.3 Degraded forms actually reachable today

| Degraded form | Cause | Verified |
|---|---|---|
| `<pid>:u` on darwin / linux, **always** | `platform/linux.js` and `platform/darwin.js` contain no `startTime` at all — the only `startTime` in `src/main/platform/` is `win32.js:80,84,111`. The claim in the `process-identity.js` header is confirmed against the platform files, not quoted from the comment. | `grep startTime src/main/platform/` → win32 only |
| `<pid>:u` on win32 | `Win32_Process.CreationDate` withheld (access denied); `win32.js:111` yields `null` | `process-utils.js:137` |
| `0:u` | pid-0 entry with no `process` and no `agent` name | `process-identity.js:144`, `tests/main/process-identity.test.js:102-110` |
| **absent entirely** | only if no stamp site ran (should not happen for scan-batch after attachModels fix) | historical gap: post-batch attachModels |

### 1.4 Same-name pid-reuse residue

`process-utils.js:51-53` folds the process name into the parent-chain cache key so a
recycled pid belonging to a *different* executable misses the cache. `scan-loop.js:222`
passes `forceRefresh` whenever the scanned pid set changed. The documented residual bound
is a same-name reuse on a tick where the pid set is unchanged (`process-utils.js:44-49`).

**`cwdCache` did not get this treatment** — see §3.3 and collision **C7**.

---

## 2. Event kinds: does `instanceId` reach the renderer?

Push channels are enumerated from `src/main/preload.js:28-97`. There is no separate
"process", "anomaly" or "resource" *object* channel beyond these.

| Event kind | Channel | `instanceId` | Evidence |
|---|---|---|---|
| **process** (agents) | `scan-batch` → `data.agents` | **present** for scanner agents, **absent** for injected pid-0 synthetics | stamp `process-utils.js:183`; send `scan-loop.js:294-299`; injection *after* the stamp `scan-loop.js:263`; detector literals `ide-extension-detector.js:152-159`, `wsl-detector.js:120-127` — neither file mentions `instanceId` |
| **file** | `file-access` (batched, `ipc-batcher.js`) | **absent** — not in the type, never set | type `src/shared/types/events.ts:50-77` has no `instanceId`; emitters `file-watcher.js:239-245`, `:391-402`, `:508-519` |
| **network** | `network-update` | **absent** | `network-monitor.js:364-366` emits `{agent, pid, parentEditor, …}` only |
| **anomaly** | *(no channel)* — rides inside `scan-batch` as `anomalyScores` + `anomalyScoresByInstance` | **present** in both maps; risk reads `anomalyScoresByInstance` via `anomaliesByInstance` store; name map kept for toasts/SummaryCards | `scan-loop.js` score block; `ipc.ts` sets both stores; `risk.ts` joins on `instanceId` |
| **resource** | `resource-usage` | **absent**, and the channel is **never subscribed** | shape `resource-monitor.js:23`, `:264-268` (pid only); send `scan-loop.js:313-315`; `preload.js:88-92` exposes `onResourceUsage`, and no file under `src/renderer/` calls it — the renderer's `resourceUsage` store holds the *app's own* memory/CPU from `main.js:124-133`, a different shape entirely |
| **token** | `token-costs` | **present, and it IS the key** | `token-tracker.js:104` (`CostRecord.instanceId`), `:126` (`Map` keyed by it), `:191-197` (`recordKey`); renderer type `ipc.ts:64-73` |
| **stats** | `stats-update` | n/a — aggregate counters, no per-agent identity | `main.js:136+`, `scan-loop.js:380` |
| **scan status** | `scan-status` | n/a — `{scanning: boolean}` | `scan-loop.js:48` |

### 2.1 Pid-0 synthetics and stamp order (updated)

`doProcessScan` order after the attachModels fix:

```
  enrichWithParentChains(agents)          ← stamp scanner agents (instanceId)
  injectDetectedExternalAgents(agents)    ← stamp IDE/WSL pid-0 (identify agent name)
  enrichWithLocalModels / attachModels    ← stamp Ollama/LM Studio pid-0; attach models
  sendToRenderer('scan-batch', { agents })
```

Historical defect (closed): attachModels ran *after* sendToRenderer, so local-LLM
synthetics never rode the structured clone and carried no instanceId. Injected IDE/WSL
agents now stamp at inject; local LLM stamps at attach before the batch.

### 2.2 Audit entries (renderer reads these via `get-audit-entries-before`)

`AuditEntry` carries `instanceId` as a top-level field (`src/shared/types/events.ts:197`,
written at `audit-logger.js:223`, back-filled from v0 `details` at `audit-normalize.js:60`).
Populated per type:

| Audit type | `instanceId` | Evidence |
|---|---|---|
| `agent-enter` / `agent-exit` | **real value** | `scan-loop.js:233`, `:250` (from `sessionTracker`) |
| `file-access` / `config-access` | **real value** when the event carries one, else `null` (step 3) | `scan-loop.js` `logAuditForFile` — `ev.instanceId ?? null` |
| `network-connection` | **real value** when the connection matched an agent, else `null` (step 3) | `scan-loop.js` `doNetworkScan` — `conn.instanceId ?? null` |
| `anomaly-alert` | **real value** (step 7) | `scan-loop.js` — `d.instanceId` from the per-instance deviation |
| audit drop marker | explicit `null` | `audit-drop-tracker.js:113` |

So `timeline-utils.ts` reads `entry.instanceId` (`:168`, `:182`) on a field that is now
non-null for four of the five audit types — only the drop marker, which nobody owns, keeps
an explicit `null` — and always `undefined` for live (non-historical) events, which never
had the field.

---

## 3. Identity key sites — main process (14)

| # | Site | Key expression | Class |
|---|---|---|---|
| 3.1 | `process-utils.js:51-53` `_cacheKey` | `` `${pid}|${name.toLowerCase()}` `` | ephemeral |
| 3.2 | `process-utils.js:180-184` | `identify(a)` → `a.instanceId`, `a.instanceIdSource` | **the stamp** |
| 3.3 | `process-utils.js:239-251, 254-259` `cwdCache` | **bare `a.pid`** — no name fold, no `forceRefresh` | ephemeral ⚠ **C7** |
| 3.4 | `session-tracker.js:60, 81-84` | `` `${instanceId}|${process.toLowerCase()}` `` | ephemeral ✅ migrated |
| 3.5 | `file-watcher.js:349-353` `handleKey` | `agent.instanceId` (fallback `buildInstanceId`) | ephemeral ✅ migrated |
| 3.6 | `token-tracker.js:126, 191-197` `recordKey` | `proc.instanceId` (fallback `buildInstanceId({pid,startTime})`) | ephemeral ✅ migrated |
| 3.7 | `scan-loop.js:56-73` `dedupFileEvent` | `` `${ev.agent}|${ev.file}` `` — display name | ephemeral ⚠ |
| 3.8 | `scan-loop.js` anomaly scores | `scoresByInstance[a.instanceId]`; `scores[a.agent]` kept as the max for the renderer | ephemeral ✅ migrated (step 7) |
| 3.9 | `config-manager.js` `getInstanceKey` → `shared/instance-key.js` `buildInstanceKey` | `` `${name}::${cwd}` `` → `` `${name}::${parentEditor}` `` → `name` | **durable** (settings.json) ✅ step 6 |
| 3.10 | `blocklist.js:124, 187-195` | `(canonical signature, pid \| null)` | **durable** (settings.json `watchlist`) |
| 3.11 | `baselines.js` `sessionData` | `instanceId` (bucket carries `agentName`) | ephemeral ✅ migrated (step 7); `baselines.agents` stays **durable** on the name |
| 3.12 | `anomaly-detector.js` | `instanceId` for the bucket, its `agentName` for the profile | derived from 3.11 ✅ |
| 3.13 | `ipc-handlers.js:400-401, 415, 430` | `agents.some(a => a.pid === pid)` — bare pid guard for kill / suspend / resume | ephemeral ⚠ |
| 3.14 | `resource-monitor.js:249-270` `_cache` | bare `pid`, 5 s TTL | ephemeral |

`get-all-permissions` (`ipc-handlers.js:188-198`) splits the persisted map on `'::'` — the
renderer therefore sees the durable key format directly.

---

## 4. Identity key sites — renderer (49)

### 4.1 `stores/risk.ts` — 12 sites

| # | Line | Key expression |
|---|---|---|
| 4.1.1 | `risk.ts` *(closed, step 6)* | was local `instanceKey()` → `buildInstanceKey` from `shared/instance-key.js` |
| 4.1.2 | *(closed, step 5)* | was `eventsByPid` keyed `ev.pid` → `eventsByInstance` keyed `ev.instanceId` |
| 4.1.3 | *(closed, step 5)* | was `eventsByName` keyed `ev.agent` → folded into `eventsByInstance` |
| 4.1.4 | *(closed, step 5)* | was `connsByPid` keyed `conn.pid` → `connsByInstance` keyed `conn.instanceId` |
| 4.1.5 | *(closed, step 5)* | was `connsByName` keyed `conn.agent` → folded into `connsByInstance` |
| 4.1.6 | `157` | `fpNames = new Set($fp.map(fp => fp.agentName))` |
| 4.1.7 | `164` | `const iKey = instanceKey(name, parentEditor, cwd)` |
| 4.1.8 | *(closed, step 5)* | was `hasCwd && raw.pid ? eventsByPid.get(raw.pid) : eventsByName.get(name)` → `eventsByInstance.get(raw.instanceId)` |
| 4.1.9 | *(closed, step 5)* | the name-branch `parentEditor` refinement is deleted — it existed only to patch that branch |
| 4.1.10 | *(closed, step 5)* | was `hasCwd && raw.pid ? connsByPid.get(raw.pid) : connsByName.get(name)` → `connsByInstance.get(raw.instanceId)` |
| 4.1.11 | *(closed, C2 renderer)* | was `$anomalies[name]` → `$anomaliesByInstance[instanceId]` (neutral 0 if key missing/null) |
| 4.1.12 | `231, 240` | `fpNames.has(name)`; published field `instanceKey: iKey` (type `src/shared/types/risk.ts:103`) |

### 4.2 Stores — 4 sites

| # | Site | Key expression |
|---|---|---|
| 4.2.1 | `stores/events-index.ts` *(closed, step 4)* | was `Map<number, FileEvent[]>` keyed `evt.pid` → `Map<string, FileEvent[]>` keyed `evt.instanceId` (guards: `attribution.status === 'unattributed'` skipped, missing key skipped) |
| 4.2.2 | `stores/ipc.ts` *(closed, step 8)* | was `focusedAgentPid: number` → `focusedAgentInstanceId: string \| null` |
| 4.2.3 | `stores/ipc.ts` *(closed, step 8)* | was `selectedAgentPid: number` → `selectedAgentInstanceId: string \| null` |
| 4.2.4 | `stores/acknowledged.ts:17` | `Writable<Set<string>>` of agent **display names** |

### 4.3 Components and utils — 33 sites

| # | Site | Key expression |
|---|---|---|
| 4.3.1 | `AgentPanel.svelte:24-32` | `byName: Map<string, EnrichedAgent[]>` keyed `a.name` |
| 4.3.2 | `AgentPanel.svelte:57` | `{#each grouped as agent (agent.name)}` |
| 4.3.3 | `AgentPanel.svelte` *(closed, step 8)* | was `bind:expandedPid={$selectedAgentPid}` → `bind:expandedInstanceId={$selectedAgentInstanceId}` |
| 4.3.4 | `AgentCard.svelte` *(closed, step 8)* | was `expandedPid === agent.pid` → `isAgentSelected(expandedInstanceId, agent)` |
| 4.3.5 | `AgentCard.svelte` *(closed, step 8)* | was `$focusedAgentPid === agent.pid` → `isAgentSelected($focusedAgentInstanceId, agent)` |
| 4.3.6 | `AgentCard.svelte:82` *(closed, step 4)* | was `$eventsByPid.get(agent.pid)` → `$eventsByInstance.get(agent.instanceId)` |
| 4.3.7 | `AgentCard.svelte:87-91` | `agent.instanceId && r.instanceId ? r.instanceId === agent.instanceId : r.pid === agent.pid` (token match; selection is not this path) |
| 4.3.8 | `AgentCard.svelte` *(closed, step 8)* | was `expandedPid = … agent.pid` → `toggleInstanceSelection(…)` |
| 4.3.9 | `AgentCard.svelte` *(closed, step 8)* | was `onViewDetails` → `agent.pid` → `toggleInstanceSelection(null, agent)` |
| 4.3.10 | `AgentActions.svelte` *(closed, step 10)* | was unified `agentKey` → `ackId` (instanceId) + `watchSig` (name) |
| 4.3.11 | `AgentActions.svelte` *(closed, step 10)* | `$acknowledgedAgents.has(ackId)` / `toggleAcknowledged(ackId)` |
| 4.3.12 | `AgentActions.svelte` | `blocklistAdd({ signature: watchSig, pid: null })` — durable name, intentional |
| 4.3.13 | `PermissionsGrid.svelte:55-57` | `seen.has(a.instanceKey)` |
| 4.3.14 | `PermissionsGrid.svelte:78-88` | `Object.keys(permissions)`; `key.split('::')[0]`, `[1]` |
| 4.3.15 | `PermissionsGrid.svelte:95` | `selectedKey.includes('::') && !!permissions[selectedKey]` |
| 4.3.16 | `PermissionsGrid.svelte:112, 126-133` | `allEntries.find(e => e.key === selectedKey)`; `saveInstancePermissions({agentName, parentEditor, cwd})` |
| 4.3.17 | `AgentStatsPanel.svelte` *(closed, step 8)* | was `focusedAgentPid.set(pid)` → `focusedAgentInstanceId.set(focusInstanceId(row))` |
| 4.3.18 | `AgentStatsPanel.svelte:97` | `{#each rows as row (row.name)}` |
| 4.3.19 | `agent-stats-utils.ts:34-41` | `byName: Map<string, EnrichedAgent[]>` keyed `a.name` |
| 4.3.20 | `grouped-feed-utils.ts:123` | `r.filter(ev => ev.agent === agentFilter)` |
| 4.3.21 | `grouped-feed-utils.ts:131-134` | `map: Map<string, FeedEvent[]>` keyed `ev.agent` |
| 4.3.22 | `grouped-feed-utils.ts:138` | `agents.find(x => x.name === name)` |
| 4.3.23 | `Radar.svelte:31-40` | `byName: Map` keyed `agent.name`, highest-risk wins |
| 4.3.24 | `Reports.svelte:35-55` | `byName: Map` keyed `a.name`, counts summed |
| 4.3.25 | `ThreatAnalysis.svelte:16-18` | `counts[a.name] = (counts[a.name] \|\| 0) + 1` |
| 4.3.26 | `Header.svelte:17` | `new Set($enrichedAgents.map(a => a.name)).size` |
| 4.3.27 | `FeedFilters.svelte:22` | `[...new Set(cachedAgents.map(a => a.name))]` |
| 4.3.28 | `Timeline.svelte` *(closed, step 9)* | was `` `${ts}\|${agent}\|${_type}` `` → `timelineDedupKey(ev, ordinal)` |
| 4.3.29 | `Timeline.svelte` *(closed, step 8+9)* | focus write: `focusInstanceId(dot)`; trajectory: instanceId agentKey |
| 4.3.30 | `timeline-utils.ts` | display `agent` / metadata `pid`; identity `instanceId` |
| 4.3.31 | `timeline-utils.ts` *(closed, step 9)* | was name `agentKey` → `clusterTrajectoryKey` (stamped instanceId) |
| 4.3.32 | `timeline-utils.ts` *(closed, step 9)* | `buildLinks` walks instanceId agentKey only |
| 4.3.33 | `App.svelte` *(closed, step 8)* | was `find(a => a.pid === pid)` → `resolveSelectedAgent(…, selectedAgentInstanceId)` |

`NetworkPanel.svelte:106, 155` keys connections on
`` `${c.pid}-${c.remoteIp}-${c.remotePort}-${c.state}` `` — a *connection* key, not an agent
key, so it is listed here for completeness but not counted among the 49.

---

## 5. Collisions and splits

Marked **collide** = two instances → one key; **split** = one instance → two keys across
ticks.

### C1 — CLOSED (step 5) — two projects, one risk history *(the reported case)*

The mechanism was: on Windows `getProcessCwds` returns `null` whenever the working
directory is not extractable, so `annotateWorkingDirs` (`process-utils.js:254-259`) sets
`cwd = null`; two Claude Code instances in different projects then both produced
`instanceKey === 'Claude Code'`, and the correlation selectors fell to the **name** branch,
so both agents received the *same* candidate event and connection lists — identical
`sensitiveFiles`, `riskScore`, `trustGrade`. One project's `.ssh` access raised the other
project's card.

`risk.ts` now correlates on the canonical `instanceId` alone, through one
`eventsByInstance` / `connsByInstance` pair, and derives no correlation key from name, cwd
or parentEditor. A record with no key is quarantined rather than name-matched, and stays
visible in the feed and Timeline. `instanceKey` (`:68-72`) is untouched and still
`name::cwd` — it is the durable permissions key, not a correlation key (§6 step 6), so two
cwd-less instances still share their saved permissions by design. **The anomaly term is
not covered by this fix** — see C2.

### S1 — split — the same instance, two keys across ticks

`risk.ts:69-71`. `cwdCache` has a 60 s TTL (`process-utils.js:215`) and a cwd read can
succeed on one tick and fail on the next. The key then flips
`Claude Code::X:\proj` → `Claude Code::VS Code` → `Claude Code`. Consequences: a second
entry appears in the PermissionsGrid dropdown (`PermissionsGrid.svelte:55-57`), and a
cwd-level permission saved under the first key stops resolving
(`config-manager.js:251-261`).

### C2 — CLOSED (step 7 main + renderer half) — the anomaly term was per-name by construction

The mechanism was: `risk.ts` read `$anomalies[name]`, and the main process built that map
as `scores[a.agent]` on top of `sessionData[agentName]`, so two instances shared one live
session bucket and one anomaly score. Even a perfect file/network key left this term shared.

**Main (`975ed1a`):** the live bucket keys on `instanceId` and carries its `agentName`; the
persisted profile (`baselines.agents`) stays on the name. `scan-batch` emits
`anomalyScoresByInstance` beside name-keyed `anomalyScores` (max over that name's instances).

**Renderer (this block):** `ipc.ts` stores the per-instance map in `anomaliesByInstance`;
`risk.ts` reads only `$anomaliesByInstance[instanceId]`. No name fallback, no pid fallback,
no re-derived key. Null/missing `instanceId` → neutral 0. The name-keyed `anomalies` store
remains for App.svelte toasts and SummaryCards.

### C3 — collide — deliberate per-name UI roll-up hides everything above

`AgentPanel.svelte:24-32` and `agent-stats-utils.ts:34-41` group by `a.name` and render one
card per name. `_instances` (`AgentPanel.svelte:44`) preserves the list and `PidList.svelte`
shows the pids, but the card body is the **representative** (`...rep`, highest risk):
`expandedPid` / `focusedAgentPid` target only `rep.pid`, and `AgentCard.svelte:87-91` resolves
the token record from `rep.instanceId` — so a second instance's tokens and costs are simply
not displayed. `Radar.svelte:31-40`, `Reports.svelte:35-55`, `ThreatAnalysis.svelte:16-18`,
`Header.svelte:17`, `FeedFilters.svelte:22` do the same by name.

This is intentional grouping, not a keying bug — but it is why C1 is invisible to the user.

### C4 — CLOSED (ack half, step 10) — acknowledgement was per-name; watchlist stays name

The mechanism was: one `agentKey` (display name, pid fallback) fed both
`toggleAcknowledged` and `blocklistAdd`, so acknowledging one Claude Code marked every
instance, and watchlist shared that key.

**Fix:** `acknowledgementInstanceId(agent)` = stamped `instanceId` only (session
`Set` in `acknowledged.ts`); `watchlistSignature(agent)` = display name only for
durable `blocklistAdd({ signature, pid: null })`. Same-name restart keeps watchlist,
loses acknowledgement. Null instanceId → ack button disabled / no-op.

### C5 — CLOSED (step 9) — timeline joins two instances into one trajectory

The mechanism was: `buildClusters` set `agentKey` to the display name, and `buildLinks`
drew paths on that key; `Timeline.svelte` deduped on `` `${timestamp}|${agent}|${_type}` ``.
Two same-name instances shared one path and one dedup bucket.

**Fix:** trajectory `agentKey` and cluster `instanceId` are the shared stamped
`instanceId` only (`clusterTrajectoryKey`); missing/mixed → null (visible, no path).
Dedup uses `timelineDedupKey` (instanceId segment, or unique ordinal when unowned so
nulls do not collapse). Live network events carry `conn.instanceId`. No name/pid
fallback.

### C6 — CLOSED (steps 4–5) — the event index was keyed on a recyclable pid

`events-index.ts` and `risk.ts` bucketed events by bare `ev.pid`. Windows recycles pids, so
a `FileEvent` stamped before the recycle landed in the new instance's card, while the
equivalent store in main had already moved to `instanceId` (`file-watcher.js:349-353`,
PR #180–182) — precisely the half-migration `memory-bank/ai-mistakes.md#19` warns about.

Both stores now key on `evt.instanceId`, and `AgentCard.svelte` reads
`$eventsByInstance.get(agent.instanceId)`. The pid-0 sub-case disappears with the pid: a
synthetic correlates on its own `0:<name>` key (value space 2) through the same single
lookup, with no special case. The `attribution.status === 'unattributed'` guard is kept in
both stores — redundant with the key check today, and retained because the two say
different things and are separately testable.

### C7 — collide — `cwdCache` is the one identity cache still on a bare pid

`process-utils.js:239-251`. `parentChainCache` was hardened to `` `${pid}|${name}` `` plus a
`forceRefresh` path (`:51-53`, `:82-86`) because a stale entry would serve a dead process's
`startTime`. `cwdCache` got neither: it is keyed on `a.pid` alone, has a 60 s TTL, and
`annotateWorkingDirs` accepts no `forceRefresh`. A pid recycled inside 60 s serves the dead
process's `cwd` — which is the field the renderer's `instanceKey` is built from, and the
field `attribution` uses for `CWD_CONTAINMENT` (`file-watcher.js:169`). This poisons the
input to C1's fix.

### C8 — latent, not live — the token-cost pid fallback

`AgentCard.svelte:89` falls back to `r.pid === agent.pid` when either side lacks an
`instanceId`. Today `token-cost-collector.js:74-77` only builds records for agents with a
numeric `startTime`, which on win32 means `pid > 0` *and* a stamped `instanceId`, so no
pid-0 `CostRecord` exists and the fallback is unreachable. It becomes reachable the moment
a pid-0 synthetic gains a token adapter. Recorded so a later change does not silently arm it.

---

## 6. Migration order

Two classes of key, and they migrate in opposite directions. **`instanceId` is per-boot** —
`` `${pid}:${startTime}` `` is a new string after every restart. Any key that is written to
disk therefore must **not** move to `instanceId`.

- **Ephemeral correlation keys** (event ↔ agent inside one session): §3.1, 3.3, 3.7, 3.13,
  §4.1.2–4.1.12, §4.2.1–4.2.4, and the component sites that consume them → these migrate to
  `instanceId`.
- **Durable config keys** (survive restart): §3.9 `agentPermissions`, §3.10 `watchlist`,
  §3.11 baselines, and their renderer mirrors §4.1.1/4.1.7/4.1.12 and §4.3.13–4.3.16 →
  these **stay on `name` + `cwd`**. The fix there is making `cwd` reliable (step 1), not
  swapping the key. Migrating them would orphan every saved permission on the next launch.

Each step below is independently shippable — the tree builds, tests pass, and the app is
correct with only steps `1..k` applied.

1. **`cwdCache` gets the `parentChainCache` treatment.** `process-utils.js:214-259`: key on
   `_cacheKey(pid, name)`, accept `opts.forceRefresh`, and pass `result.changed` from
   `scan-loop.js:260`. *Main only, behaviour-preserving* (removes a wrong-value case; adds
   no new value). Closes **C7**. Everything downstream that reads `cwd` — including step 6 —
   depends on this being correct first.

2. **Stamp `instanceId` on injected pid-0 synthetics.** Call `identify()` on each entry
   produced by `ide-extension-detector.js:152-159` and `wsl-detector.js:120-127` (or once at
   `scan-loop.js:263`, after `injectDetectedExternalAgents`). *Main only,
   behaviour-preserving* — the renderer ignores the new field until step 4. After this,
   **every element of `scan-batch.agents` carries `instanceId`**, which is the precondition
   for all renderer work. Verify with a test asserting the invariant over the whole batch,
   not over a sampled agent (`ai-mistakes.md#21`).

3. **Carry `instanceId` on `FileEvent` and `NetworkConnection`.** Add the field to
   `src/shared/types/events.ts:50-77` (`FileEvent`) and `:107+` (`NetworkConnection`), stamp it at the three
   `file-watcher.js` emit sites (`:239-245`, `:391-402`, `:508-519`) and at
   `network-monitor.js:364-366`, from the *matched agent object of the same tick* — never by
   re-resolving a pid later (`ai-mistakes.md#19`, and the reason `scan-loop.js:84` and `:145`
   currently write `null`). Then the audit `null`s at `scan-loop.js:85` and `:145` can become
   real values. *Main only, additive* — no renderer consumer yet. **This is the gate: without
   it the renderer has nothing to correlate events by.**

4. **DONE (`222502f`) — `eventsByPid` → `eventsByInstance`.** `events-index.ts` keys on
   `evt.instanceId`; `AgentCard.svelte` reads `$eventsByInstance.get(agent.instanceId)`.
   *Behaviour-preserving in the normal case, changes what the user sees after a pid recycle*
   (events no longer bleed into the wrong card). Closed **C6**.

5. **DONE (`222502f`) — `risk.ts` correlation switched to `instanceId`.** `eventsByPid` /
   `eventsByName` and `connsByPid` / `connsByName` became one `eventsByInstance` /
   `connsByInstance` pair, and the `hasCwd && raw.pid ? … : …` selectors became a direct
   `.get(raw.instanceId)`; both `parentEditor` refinements went with the name branch they
   patched. No name fallback was kept: a record with no `instanceId` is quarantined — it
   joins nobody and stays visible in the feed and Timeline, which read `$events` directly.
   `EnrichedAgent` now publishes `instanceId` beside the durable `instanceKey`.
   **Changed what the user sees** — two instances in different projects get different
   `riskScore` for the first time. Closed **C1** for file and network correlation; the
   anomaly term is step 7.

6. **DONE — durable `instanceKey` honesty / shared definition.** Single helper
   `buildInstanceKey(name, parentEditor, cwd)` in `src/shared/instance-key.js`. Main
   `config-manager.getInstanceKey` and renderer `risk.ts` both call it — byte-identical
   keys for settings.json. Contract: durable permissions/workspace scope only; not
   runtime `instanceId`; not watchlist name; PID never included; concurrent same-name
   with null cwd may share a key by design. Step 1 cwdCache honesty supports S1.
   **Do not** move PermissionsGrid or blocklist to `instanceId`.

7. **DONE (`975ed1a` + renderer half) — anomaly scores became per-instance end to end.**
   `baselines.js` keys `sessionData` by `instanceId` and stores `agentName` inside the
   bucket; `anomaly-detector.js` looks the bucket up by key and its profile up by that
   name. The persisted `baselines.agents` map stays keyed by **name**. `scan-loop.js`
   emits `anomalyScoresByInstance` beside name-keyed `anomalyScores` (max over instances).
   Renderer: `anomaliesByInstance` store + `risk.ts` join on stamped `instanceId` only;
   name map kept for toasts/SummaryCards. Closed **C2**.

8. **DONE — Selection and per-instance UI state.** `focusedAgentInstanceId` /
   `selectedAgentInstanceId` (`string | null`) replace the pid stores. Card expand,
   focus/scroll, stats row click, timeline focus write, and command-palette resolve use
   stamped `instanceId` only (`agent-selection.ts`). Process kill/suspend still pass the
   **resolved live record's pid** to main IPC (OS needs a pid); they never re-find by pid.
   Stale selection after the instance dies does not rebind on pid reuse. Main-process
   kill/suspend pid guards (`ipc-handlers.js`) are unchanged — out of renderer step 8.
   **Changes what the user sees.**

9. **DONE — Timeline identity (C5).** `agentKey` / cluster process identity is stamped
   `instanceId` only (`clusterTrajectoryKey`); no name fallback for historical rows —
   unowned events stay visible with `agentKey: null` and no path. Dedup is
   `timelineDedupKey` (instance segment, or unique ordinal when unowned). Live network
   events carry `instanceId`. Focus remains `focusInstanceId(dot)` (step 8). **Changes
   what the user sees** — two instances draw two paths. Closes **C5**.

10. **DONE — Acknowledgement per instance (C4 ack half).** `acknowledgementInstanceId`
    reads stamped `instanceId` only; session store keys match. Watchlist uses
    `watchlistSignature` (display name) + `pid: null` any-PID entry — durable by design,
    not migrated to instanceId. Null stamp → ack no-op / disabled. **Changes what the
    user sees.** Closes the acknowledgement half of **C4**.

11. **Per-name roll-up becomes a choice, not a default.** `AgentPanel.svelte:21-47`,
    `agent-stats-utils.ts:33-57`, `Radar`, `Reports`, `ThreatAnalysis`, `Header`,
    `FeedFilters` group by name today. Only after steps 5–8 does one-card-per-instance
    display distinct data. **Pure UX decision, changes what the user sees** — explicitly out
    of scope for a correctness migration, listed so it is not mistaken for a leftover.

**Deliberately excluded from the order:** `resource-usage` (§2, `preload.js:88-92` is not
subscribed by any renderer file — decide whether to wire or delete before keying it).

**attachModels (local LLM) — FIXED:** `enrichWithLocalModels` runs after
`injectDetectedExternalAgents` and **before** `scan-batch`. Synthetics are stamped with
`identify({ pid: 0, agent: name })` (space 2); existing agents keep a present stamp.
Post-send attach is gone so the UI/latestAgents receive models + instanceId.

---

## 7. Tests

### 7.1 Tests that encode the old key as expected behaviour

| Test | Line | What it pins | Step that breaks it |
|---|---|---|---|
| `tests/renderer/agent-stats-utils.test.js` | `24` | `instanceKey: 'TestAgent'` — the bare-name form of the ad-hoc key | 6 (shape only), 11 |
| `tests/renderer/risk.test.ts` | *(rewritten in step 5)* | fixtures used to be `{agent, pid, cwd}` with **no `instanceId`** and asserted correlation through the pid/name branch; every fixture now carries the key it is joined on | **5** — done |
| `tests/renderer/risk.test.ts` | *(rewritten in step 5)* | pid-0 synthetics and the unattributed-event guard are asserted via `instanceId` (`0:<name>`, and `null` for unattributed) | 4, 5 — done |
| `tests/main/config-manager.test.js` | `81-105` | `'Claude::VS Code'`, `'Claude::/project'` and the cwd → editor → agent → default chain | **none — this is the durable key and must keep passing.** A step-6 change that breaks it is a bug in the step. |
| `tests/main/ipc-handlers.test.js` | `42`, `183`, `338` | `'Claude::vscode'` split across `permissions` / `instancePermissions` | same — must keep passing |

### 7.2 Tests that must be extended

| Test | Why |
|---|---|
| `tests/main/process-utils.test.js:149-169`, `211-226` | Covers `parentChainCache` pid-reuse and the `instanceId` stamp. Step 1 needs the same two cases for `cwdCache`; there are none today. |
| `tests/main/process-identity.test.js` | Complete for the three value spaces. Step 2 needs a new assertion at the *batch* level (every agent in `scan-batch` has a non-empty `instanceId`), which belongs in a scan-loop test, not here. |
| `tests/main/file-watcher.test.js:362-388`, `440-445` | The `handleKey` migration template — mirror its structure for step 4's `eventsByInstance`. |
| `tests/main/audit-schema-v1.test.js:79-87`, `117`, `224` | Asserts `instanceId: null` for the types listed in §2.2. Step 3 flips file and network to real values; these assertions must be updated deliberately, not deleted. Note `:79` passes `'0:Kilo Code'` verbatim — `identify()` would normalise it to `0:kilo-code`, so step 2 changes what a real detector emits even though this test (which injects the value) keeps passing. |
| `tests/renderer/acknowledged.test.js` | Keys are stamped instanceIds (step 10); `agent-action-keys.test.ts` pins the ack/watchlist split. |
| `tests/renderer/grouped-feed-utils.test.ts` | Groups by `ev.agent`; unaffected until step 11, then must be rewritten. |

### 7.3 Missing coverage that the migration needs

- No test asserts that **every** agent in a `scan-batch` payload carries `instanceId`
  (step 2's gate).
- No test covers the `resource-usage` channel end-to-end — which is how it stayed
  unsubscribed.
- ~~No renderer test constructs two instances of the *same* agent and asserts distinct risk
  scores.~~ Written red before step 5, unskipped and green with it: `risk.test.ts`
  "C1: two Claude Code instances in different projects get separate risk histories". Its
  sensitivity was proven by injecting a shared key and watching it go red. The missing-key
  quarantine has its own five cases in the same file.

---

## What happened (in plain language)

Imagine a building where the guard writes down visitors as "Ivan from the third floor". Two
different Ivans, both without a floor number on their badge, end up as one line in the
logbook — and everything one of them did gets blamed on the other. AEGIS already has proper
badge numbers for processes; they just never got handed to the part of the app that draws
the screen. I walked the whole building and wrote down all 63 places where a name is used as
if it were a badge number, which ones can safely switch to the badge, and which ones must
keep using the name because the badge is reissued every morning.
