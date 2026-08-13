# External techniques worth stealing

**Recon date:** 2026-08-12
**Baseline re-verified against:** `master` @ `d027f0c`, 2026-08-13 — three baseline claims had gone
stale between the recon and this commit and are corrected below; each correction is marked
**[since recon]** where it changes what a section recommends.

Read-only recon against published specs and implementations. AEGIS baseline for comparison:
hash-chained daily JSONL (`src/main/audit-hashchain.js` key-sorted `canonical` + SHA-256, no stored
`prevHash`), bounded in-memory write buffer with drop-oldest + `buffer-overflow-drop` markers
(`audit-logger.js` / `audit-drop-tracker.js`), Event Schema v1 (`schemaVersion`, `pid`, `instanceId`,
`attribution`), `instanceId` as `<pid>:<startTimeMs>` (`process-identity.js`), polling scanners +
chokidar, per-instance resource sample (`resource-monitor.js` TTL cache keyed by `instanceId`, pid
carried for display only), rules as flat YAML without temporal join, a Windows-only scenario bench
with an independent oracle (`bench/`, `npm run bench:run`) but no offline replay of recorded sensor
fixtures, per-sensor health records in main (`sensor-health.js`) with no renderer consumer, no SQLite
index, no second sensor, no user-facing `verify` CLI (`src/main/cli.js` has `--scan-json`,
`--version`, `--help` only).

Findings only where an external approach is **stronger** than inventing our own. Confidence tags: **impl** = read implementation source; **docs** = read specification or authoritative docs; **desc** = secondary description only.

---

## 1. Audit schema alignment

### 1.1 RFC 8785 JSON Canonicalization Scheme (JCS)

- **Technique:** Canonicalize audit records with RFC 8785 before hashing so chain digests are interoperable and free of number/UTF-16 key-order edge cases.
- **Source:** [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (2020, standards-track); verified JS package [erdtman/canonicalize](https://github.com/erdtman/canonicalize) (npm `canonicalize`, listed in RFC Appendix G). MIT-ish OSS; still the reference for Node.
- **Where:** Spec §3–§3.2.3 (key sort by UTF-16 code units, ECMAScript number serialization / Ryū, no whitespace). Package entry: `canonicalize` export in `erdtman/canonicalize`.
- **Why it beats us:** Our `canonical()` in `audit-hashchain.js:36-40` only key-sorts and `JSON.stringify`s primitives. It does **not** implement JCS number rules or the UTF-16 key order the RFC mandates. Any external verifier (or a future signed-export tool) that uses real JCS will disagree with our hashes on non-integer numbers and certain keys.
- **Cost:** One tiny npm dep (`canonicalize`, pure JS, ~few KB) or a hand-port of the number path. No platform constraint. Migration cost is a **chain-format break** (re-hash from GENESIS with a schema version bump).
- **Trap:** JCS forbids non-I-JSON numbers (NaN, Infinity). Our events mostly use integers and ISO strings today; introducing floats (latencies, costs) without JCS will silently change digests. Also: AAT (below) hashes the **whole previous record including signature**; we hash event-without-seq/hash. Align the *exclusion set* before swapping the serializer.
- **Confidence:** docs (RFC) + docs (package README / Appendix G listing). Did not re-run RFC test vectors against our `canonical()`.

### 1.2 Agent Audit Trail (AAT) — draft-sharif-agent-audit-trail-00

- **Technique:** Session-scoped, hash-chained JSON audit records with mandatory identity/action/outcome fields, genesis + close records, optional ECDSA P-256, tombstones for erasure, JSONL as primary export.
- **Source:** [draft-sharif-agent-audit-trail-00](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/) (2026-03-29, IETF individual draft, expires 2026-09-29). Explicitly binds chaining to **RFC 8785** and maps EU AI Act Art. 12, ISO/IEC 42001, SOC 2, PCI DSS.
- **Where:** §3.1 mandatory fields (`record_id`, `agent_id`, `session_id`, `action_type`, `outcome`, `prev_hash`, …); §4.1 hash formula `prev_hash(N) = hex(SHA-256(JCS(record(N-1))))`; §6 session genesis/close; §7.3 tombstones; §8.1 JSONL primary.
- **Why it beats us:** We already reinvented per-file chains + JSONL + “verify re-derives from GENESIS.” AAT is a published field taxonomy and chain algorithm we can **map or export into**, instead of growing a private schema forever. Session close `session_hash` and orphaned-session recovery rules cover gaps our daily-file design does not name.
- **Cost:** Spec only (no library). Mapping layer from AEGIS v1 → AAT export shape; optional signing later. Stay **out of** AAT’s optional `risk_score` 0.0–1.0 until a ground-truth bench exists (project permanent ban on numeric confidence).
- **Trap:** Individual draft, not WG consensus — field names can still move. AAT’s `agent_id` is a **persistent URI across restarts**; our `instanceId` is **per-boot OS instance**. Do not conflate them: keep OS instance as evidence, map a durable agent URI only if we ever have one. AAT assumes the *agent* writes the trail; AEGIS is an *external* observer — action taxonomy (`tool_call`, `decision`, …) fits agent-native logs better than OS file/network events (OCSF is better for those).
- **Confidence:** docs (full draft text read).

### 1.3 OCSF for OS-level event field names (export / index, not write-path)

- **Technique:** Map process/file/network observations to OCSF classes for export and SQLite column names instead of inventing parallel vocabularies.
- **Source:** [ocsf/ocsf-schema](https://github.com/ocsf/ocsf-schema) (Apache-2.0, active, industry standard since ~2022; AWS Security Lake native).
- **Where:** Schema classes under `events/` (e.g. Process Activity, File System Activity, Network Activity) and attribute dictionary in the repo; consumer docs at schema.ocsf.io.
- **Why it beats us:** SIEM/export consumers already speak OCSF. Renaming `type: file-access` / `network-connection` into OCSF class UIDs + shared attributes (`process.pid`, `file.path`, `actor`, `time`) is cheaper long-term than a private SIEM mapping table.
- **Cost:** Mapping table only. Keep AEGIS JSONL as canonical write format; OCSF is an export/index projection. No runtime dependency required.
- **Trap:** OCSF is huge and versioned. Full conformance is not the goal — pick the 3–4 classes we emit. Do not force OCSF into the hash-chained write path (extra fields would churn the chain).
- **Confidence:** docs.

### 1.4 User-facing integrity verify (pattern already specified, not built)

- **Technique:** CLI/command that runs the same chain algorithm AAT §4.3 / our `verifyChain` and prints broken-at-seq + asymmetric semantics (valid ≠ complete; invalid ≠ tampered).
- **Source:** Our own `verifyChain` (`audit-hashchain.js:90-121`) already implements the core; AAT §4.3 is the public procedure; no better external CLI for *local* JSONL hash chains turned up.
- **Why it beats a greenfield:** Do not invent a new protocol — wire existing `verifyChain` to `cli.js` and document the two-way honesty already in the JSDoc.
- **Cost:** Thin CLI surface + docs. Already in-repo.
- **Trap:** Exposing “tampered” wording to users without the invalid≠tampered note reintroduces the honesty bug the JSDoc already fixed.
- **Confidence:** impl (our code) + docs (AAT).

---

## 2. Per-instance resource usage

### 2.1 Keep identity as (pid + start time); do not invent ProcessGuid

- **Technique:** Sysmon’s `ProcessGuid` exists because bare PID reuses; it is a domain-scoped GUID carried on every related event. The **problem statement** is the same as our `instanceId`.
- **Source:** Microsoft Sysmon (Sysinternals, long-lived, actively maintained). Docs: Process Create Event ID 1 field list on learn.microsoft.com / ultimatewindowssecurity encyclopedia.
- **Where:** Documented field `ProcessGuid` on Event ID 1; correlation via `ParentProcessGuid` on child events. Sysmon source is closed; behavior is field-level, not a library.
- **Why it beats a homemade GUID:** It does not. Our `buildInstanceId` (`process-identity.js`, spaces `pid:epochMs` / `0:name` / `pid:u`) already solves the same reuse class without a driver. **Finding is negative-space:** do not replace `instanceId` with a Sysmon-style GUID unless we *consume* Sysmon events (roadmap item 9).
- **Cost:** N/A.
- **Trap:** Community reverse-engineering of ProcessGuid bit layout is not a stable API. Never encode our own “looks like Sysmon GUID.”
- **Confidence:** docs.

### 2.2 Resource sample must key on instanceId, not bare pid — **[since recon: adopted]**

- **Technique:** osquery / agent monitoring tables bind process metrics to a process that can disappear between samples; differential + epoch markers prevent treating a recycled PID as continuous history.
- **Source:** osquery scheduled query **epoch** semantics (docs: logging / differential logs) — when epoch changes, treat as initial run, not a differential against the dead process.
- **Where:** osquery docs “Logging → Differential logs” (`schedule_epoch`); process tables are snapshot, not continuous counters without epoch.
- **Status on master:** **done — nothing left to steal here.** `resource-monitor.js` now documents `instanceId` as *the* key: the TTL `_cache` is keyed by `instanceId`, `pid` rides along for display and diagnostics only, and a target with `instanceId: null` is neither read from nor written to the cache. The pid-keyed `resource-usage` push it warned about was renamed to `agent-resource-usage` and now lands in a renderer store (`stores/ipc.ts`, consumed at `AgentCard.svelte` strictly by `instanceId`). The recon's original wording — cache and IPC payload keyed by bare pid — described the tree at recon time and is no longer true.
- **Cost:** Paid. The same-tick rule below still governs any new sampler.
- **Trap (still live):** GPU path via `nvidia-smi` only knows pid; join to instanceId **on the same scan tick** that produced the agent list (same-tick rule as network attribution), never by pid lookup later.
- **Confidence:** docs (osquery) + impl (`resource-monitor.js` header and cache, re-read 2026-08-13).

---

## 3. Health state machine (honest subsystem signals)

### 3.1 Treat sensor liveness as first-class data, not “no events means quiet”

- **Technique:** osquery exposes publisher/subscriber health via the `osquery_events` table and bounds event buffers with `events_max` / `events_expiry` so “empty” is distinguishable from “expired/dropped.”
- **Source:** [osquery](https://github.com/osquery/osquery) (Apache-2.0, 2014–, active). Docs: [Eventing / pubsub framework](https://osquery.readthedocs.io/en/stable/development/pubsub-framework/), process auditing flags.
- **Where:** Flags `--events_max`, `--events_expiry`; table `osquery_events` for publisher status (documented; implementation under `osquery/events/` in the C++ tree).
- **Why it beats us:** AEGIS “no file events” can mean quiet agent, dead chokidar, EPERM, or scan not scheduled. Without an explicit publisher state (running / degraded / lost-count / last-success), the UI cannot tell sleep from death. **[since recon: half-adopted]** `src/main/sensor-health.js` now exists and carries exactly this shape — `createSensorHealth` / `createUnsupported` / `markHealthy` / `markDegraded` — with records held for the chokidar, handle and Restart-Manager filesystem sensors (`file-watcher.js`) and for the network sensor (`network-monitor.js`). What is still missing is the half the finding is about: **no renderer file reads any of it**, so the UI still cannot tell a quiet machine from a dead sensor. Process-scan overruns (`scan-loop.js`) emit no health record at all.
- **Cost:** Pattern only — a small state machine per subsystem (process scan, file watcher, network, audit flush, token feed) with last-ok timestamp + error class + drop counters we already partly have on audit. Remaining work is the scan-loop record and an IPC surface + UI consumer, not the state machine.
- **Trap:** Copying osquery’s RocksDB event store is overkill. Steal the **signal model**, not the storage.
- **Confidence:** docs.

### 3.2 ETW session loss counters as ground truth for “sensor died silently”

- **Technique:** Windows ETW reports buffers/events lost when the consumer cannot keep up or buffers are undersized — first-class loss metrics, not log absence.
- **Source:** Microsoft ETW (OS built-in since Vista). Docs: “About Event Tracing” session statistics (buffers used/delivered, events and buffers lost).
- **Where:** Session statistics APIs / `EventTraceProperties` (Win32); observable as “events lost” in performance data collection.
- **Why it beats us:** If we later consume ETW (roadmap Phase C / second sensor), loss counters are the honest health input. Even without owning a session, any shadow consumer must surface lost-event counts or it lies.
- **Cost:** Read existing ETW stats only when we attach a session. No custom driver.
- **Trap:** Lost events are **unrecoverable** — you cannot reconstruct them. Health must go degraded; never invent filler events. Real-time sessions without a consumer also lose data.
- **Confidence:** docs.

### 3.3 Sleep / wake

- **Technique:** Subscribe to OS power broadcast (Windows `WM_POWERBROADCAST` / resume) and force “sensors re-arm + baselines freeze during sleep” rather than treating a multi-hour gap as agent idle.
- **Source:** Long-standing OS facility (not a product). Documented as Windows power management messages; used by every serious endpoint agent.
- **Where:** Win32 power events (docs); Electron/main can listen via native hooks or `powerMonitor` in Electron (`resume` / `suspend`).
- **Why it beats us:** Without sleep awareness, scan-gap timers and “last activity” heuristics mis-fire after lid-close. Electron already exposes `powerMonitor` — cheaper than inventing heartbeat math.
- **Cost:** Electron `powerMonitor` in main (already a dependency). Small handler: mark health, reset TTLs, do not score sleep gaps as anomalies.
- **Trap:** VM hosts and some “modern standby” paths deliver delayed or missing events. Treat as best-effort; still better than wall-clock only.
- **Confidence:** docs (Electron powerMonitor is well-known; not re-read API surface this pass).

---

## 4. Bounded, coalescing event pipeline

### 4.1 Vector disk buffer v2 — crash-safe segmented on-disk ring

- **Technique:** Segmented data files (≤128MB), memory-mapped ledger of reader/writer positions, CRC32C records, record IDs encoding event counts, delete-on-ack of whole files, modes block / drop_newest / overflow-to-next-stage, recovery that reconciles partial writes.
- **Source:** [vectordotdev/vector](https://github.com/vectordotdev/vector) `lib/vector-buffers` (MPL-2.0, actively maintained, production at scale).
- **Where:** Design + invariants in `lib/vector-buffers/src/variants/disk_v2/mod.rs` (module docs: data file limits, ledger layout, write/read/ack lifecycle). Writer: `.../disk_v2/writer.rs`. Reader: `.../disk_v2/reader.rs`. Ledger: `.../disk_v2/ledger.rs`. Recovery: `.../disk_v2/checkpoint_recovery.rs`. Topology policies: `lib/vector-buffers/src/topology/builder.rs` (`WhenFull::{Block, DropNewest, Overflow}`).
- **Why it beats us:** Our audit path is **memory-bounded** (`BUFFER_CAP = 500`) and loses on process kill before flush; markers only appear after a *successful* flush. Vector’s disk_v2 survives process death with ordered replay and known corruption handling. For the **pre-audit** event pipeline (file/network/process bursts → attribution → rules), this is strictly stronger than inventing another in-memory queue.
- **Cost:** Rust dependency or reimplementation of the *ideas* in JS (segmented files + ledger + CRC + drop policy). Full Vector is a large binary — do **not** embed Vector wholesale; reimplement the ~ledger+segments pattern in a small CJS module, or shell out only if we accept an external helper. Rough size if porting concepts: low thousands of lines, not 80k of writer.rs.
- **Trap:** Disk buffer is not a hash chain. Do not replace JSONL canonical store with Vector records. Endianness is host-local. Acknowledgement-before-delete means a bug in ack logic re-delivers (at-least-once) — rules must be idempotent. Kill mid-record is handled; dual-writer is not.
- **Confidence:** impl (read `disk_v2/mod.rs` design docs + topology builder source).

### 4.2 Differentiated drop policies per stage (Vector topology)

- **Technique:** Multi-stage buffer where early stages **overflow** into later stages; only the last stage may block or drop-newest. Enforced at build time.
- **Source:** Same Vector tree: `TopologyBuilder::build` in `lib/vector-buffers/src/topology/builder.rs` (`TopologyError::OverflowWhenLast`, `NextStageNotUsed`).
- **Why it beats us:** We have one drop-oldest policy for audit writes only. High-volume file events and low-volume anomaly alerts need **different** ceilings and drop rules; Vector’s stage model is the published way to compose that without silent policy bugs.
- **Cost:** Design pattern; implementable in JS with two queues (hot memory → optional disk → audit).
- **Trap:** “Drop oldest” on alerts is wrong; “drop newest” on file chatter may be right. Policy is per class, not global.
- **Confidence:** impl.

### 4.3 osquery events_max / events_expiry

- **Technique:** Hard row cap + time-to-live on buffered events; expiration is visible (removed rows / optimize path), not silent OOM.
- **Source:** osquery flags `--events_max`, `--events_expiry` (docs under process auditing / pubsub).
- **Why it beats unbounded Maps:** Live stores in AEGIS (`sessionData` Sets, feeds) still need explicit eviction policy; osquery’s two-knob model (count + age) is the boring correct default.
- **Cost:** Two constants + eviction on insert. No dependency.
- **Trap:** `events_expiry=1` after select (Palantir-style) means “query or lose.” Fine for ephemeral sensors; wrong for audit.
- **Confidence:** docs.

---

## 5. Trace replay bench

> **[since recon]** A bench now exists and this section must be read against it. `bench/`
> (`npm run bench:run`, `bench/run.js` + `bench/lib/{actor,catalogue,manifest,observed,sensor}.js`,
> scenario `S1-agent-lifecycle`, schema `bench/scenario.schema.json`) generates an expected-event
> catalogue as a by-product of running a deterministic script, confirms every row against an
> independent oracle, and only then compares it with what the AEGIS sensor recorded. It is
> Windows-only and never runs in CI. What it is **not** is the offline path §5.1 asks for: it
> drives a **live** sensor per run. Recorded-fixture replay through attribution → rules → scoring
> without a live run is still unbuilt.

### 5.1 Deterministic re-ingest of recorded events (pipeline-as-function)

- **Technique:** Record raw sensor observations (not scored outputs) and push them through attribution → rules → scoring offline. AgentSight’s SQLite session + `report` CLI is one realization: load saved DB, recompute summaries without live eBPF.
- **Source:** [eunomia-bpf/agentsight](https://github.com/eunomia-bpf/agentsight) (MIT, active 2025–2026).
- **Where:** `collector/src/cli_db.rs` — `load_agentsight_view`, `run_audit_query`, `run_export`, `SessionSummary::from_view` rebuilds metrics from stored rows; tests prove load does not create missing DBs and token priority across sources.
- **Why it beats us:** We still have no offline path: scoring only runs in the live scan loop, and the bench above drives that live loop rather than replacing it. A replay harness needs **immutable recorded inputs** + pure functions. AgentSight already separates sink (SQLite) from view materialization.
- **Cost:** Define a fixture format (JSONL of pre-attribution observations). Extract pure functions from scan-loop side effects. Do not take AgentSight’s TLS/eBPF capture (out of scope / wrong platform).
- **Trap:** Replaying *audit* JSONL only re-runs readers, not attribution — by then `instanceId` is already frozen. Replay must start from sensor-level fixtures. AgentSight confidence fields and SSL interception paths are not for us.
- **Confidence:** impl (`cli_db.rs` read).

### 5.2 Atomic Red Team / known-bad generators for expected event sets

- **Technique:** Drive a scripted action catalog with known expected observations; score detector output against the catalog (recall per class).
- **Source:** [redcanaryco/atomic-red-team](https://github.com/redcanaryco/atomic-red-team) (MIT, long-lived). Used industry-wide as a behavior generator, not as a security product to embed.
- **Where:** Atomics under `atomics/T####/` (YAML + scripts). Not a library — a test corpus.
- **Why it beats homemade scripts alone:** Shared, versioned actions with documented preconditions. For AI-agent scenarios we still need custom atomics (touch `.ssh`, open sockets, spawn known agent binaries), but the **runner + expected-result** pattern is free.
- **Cost:** External test dependency (optional CI job). Not a runtime dep.
- **Trap:** Atomic Red Team targets ATT&CK techniques, not AI agents. Map carefully; many atomics need elevation and will trip AV.
- **Confidence:** desc (standard industry knowledge; catalog structure not re-walked file-by-file this pass).

---

## 6. Windows ground-truth bench

### 6.1 Sysmon as independent oracle (read path only) — **[since recon: adopted]**

- **Technique:** Run Sysmon with a tight config; treat its Event Log as ground truth for process create/terminate, network connect, file create — compare AEGIS attribution and event presence against Sysmon in a metrics matrix.
- **Source:** Microsoft Sysmon (Sysinternals). Binary redistributable; config community examples exist (e.g. trustedsec SysmonCommunityGuide — documentation, not required at runtime).
- **Where:** Event IDs 1 (process create), 5 (terminate), 3 (network), 11 (file create) — field lists on Microsoft learn.
- **Status on master:** the comparison harness described as “ours to write” **is written**: `bench/` uses Sysmon (and Procmon) as the oracle, and `bench/README.md` states the two rules this finding implies — never diff two live streams (the catalogue is the fixed point; oracle and sensor are each scored against it), and a sensor is never its own oracle (nothing under `bench/` imports from `src/`; process-identity ground truth comes from Sysmon EID 1 ordinality). The recon's remaining value here is the rationale, not the recommendation.
- **Why it beats a self-referential bench:** Sysmon is kernel-backed and independent of Electron/chokidar/tasklist. Discrepancies are real signal (our miss or our duplicate), not two user-mode pollers agreeing.
- **Cost:** Dev/CI machine dependency on Sysmon install + admin. Harness reads Windows Event Log (PowerShell/`wevtutil`/node-windows). No driver written by us — **read side of the line**.
- **Trap:** Sysmon config volume can drop events if filters are wrong; silent filter ≠ ground truth. Clock skew between ETW/Event Log and our `Date.now()` must be normalized. ProcessGuid ≠ our instanceId — join on (pid, approximate start time) with documented tolerance.
- **Confidence:** docs.

### 6.2 Metrics matrix fields already implied by mature tools

- **Technique:** Report recall by event class, attribution precision, duplicate rate, latency percentiles, dropped/coalesced counts, sensor downtime — same family of stats ETW session stats + osquery drop flags + Vector discarded counters already name.
- **Source:** Composite of ETW lost counters (docs), Vector `buffer_usage` / discarded metrics (`lib/vector-buffers/src/buffer_usage_data.rs`, `internal_events.rs`), osquery events flags.
- **Why it beats inventing KPI names:** These quantities are what production pipelines already export; using the same vocabulary makes the bench comparable to external literature.
- **Cost:** Instrumentation + harness. No new algorithm.
- **Trap:** Numeric “confidence” on individual alerts remains banned; bench metrics are **aggregate** quality of the detector, not per-event scores in product UI.
- **Confidence:** docs + impl (Vector buffer usage module existence verified via tree listing).

---

## 7. SQLite as rebuildable index over hash-chained JSONL

### 7.1 AgentSight: SQLite session store + query CLI (index pattern)

- **Technique:** Materialize events into SQLite tables (`llm_calls`, `token_usage`, `audit_events`, …) for `report` / `token` / `audit` / `export` / `list` queries; treat DB as disposable projection.
- **Source:** agentsight (MIT). `collector/src/cli_db.rs`; sinks under `collector` (SqliteStore referenced throughout tests); CLAUDE.md documents `sinks/` SQLite row store + `report` subcommands.
- **Where:** `load_agentsight_view` / `run_audit_query` / `run_export` / `SessionSummary::from_view` in `cli_db.rs`; `SqliteStore::open` used in tests (insert SQL shows table shapes).
- **Why it beats us:** We plan “SQLite over JSONL” in the master plan; AgentSight already ships the CLI UX and schema separation (query path ≠ capture path). Steal **CLI verbs + rebuild-from-canonical** discipline, not their capture stack.
- **Cost:** `better-sqlite3` or `sql.js` in main/CLI. Rebuild job: stream JSONL → INSERT. On corruption, delete DB and rebuild (JSONL remains truth).
- **Trap:** AgentSight often treats SQLite as the live store during capture. If we write **only** to SQLite, we lose the hash chain. Dual-write without “JSONL wins” will fork truth. Their multi-source token priority (`response_usage` vs `agent_native_session`) is good engineering but orthogonal to AEGIS’s OS-only stance.
- **Confidence:** impl (`cli_db.rs`).

### 7.2 SQLite FTS5 `rebuild` for disposable text index

- **Technique:** External-content FTS5 table over path/action text; `INSERT INTO ft(ft) VALUES('rebuild')` reconstructs from content tables after bulk load.
- **Source:** SQLite FTS5 docs (sqlite.org/fts5.html) — public domain SQLite.
- **Where:** FTS5 section “The rebuild command.”
- **Why it beats a homemade search index:** Zero new algorithms; standard rebuild semantics match “JSONL canonical, DB disposable.”
- **Cost:** SQLite compile with FTS5 (default in most builds). Schema only.
- **Trap:** FTS is not integrity. Never hash FTS rows.
- **Confidence:** docs.

---

## 8. Sequence rules (join keys, windows, missing events, bounded state)

### 8.1 Sigma Correlation Rules Specification

- **Technique:** Meta-rules over base detections: `event_count`, `value_count`, `temporal`, `temporal_ordered`, plus metric aggregates; `group-by` join keys; `timespan`; field `aliases` across heterogeneous events; chainable correlations; bounded by timespan (state eviction = window end).
- **Source:** [SigmaHQ/sigma-specification](https://github.com/SigmaHQ/sigma-specification) — `specification/sigma-correlation-rules-specification.md` (v2.1.0, 2025-08-02). Community standard, actively maintained.
- **Where:** § Correlation Types (`temporal`, `temporal_ordered`, `event_count`, …); § Grouping; § Time Selection; § Field Name Aliases; example “Failed logins followed by successful login” multi-doc YAML.
- **Why it beats us:** Our `rules/*.yaml` are single-event matches. Building sequence logic from scratch will rediscover group-by, timespan, and ordered temporal — already specified with conversion caveats.
- **Cost:** Either implement a small Sigma-correlation subset in JS, or compile a fixed subset of correlation YAML → internal state machines. pySigma is Python — not a runtime dep for Electron unless we precompile.
- **Trap:** Spec itself warns: backends that cannot honor order produce false positives; static hour buckets produce false negatives. Missing-event is **not** first-class in Sigma correlation (that is EQL). Do not claim full Sigma compatibility if we only implement `temporal` + `group-by`.
- **Confidence:** docs (full correlation spec read).

### 8.2 Elastic EQL `sequence` with `by`, `maxspan`, and missing events

- **Technique:** Ordered sequences across event categories; join with `by field`; window with `maxspan`; negative clauses `![ ... ]` for missing events (requires maxspan).
- **Source:** Elasticsearch EQL syntax (Elastic license for the engine; language documented publicly). Docs: elastic.co EQL syntax — sequence, maxspan, missing events.
- **Where:** Language reference sections “Sequence,” “with maxspan,” “Missing events” (`!` clauses). Open-source historical EQL Python tooling exists separately; the *language design* is the steal.
- **Why it beats Sigma alone for our roadmap item:** Roadmap explicitly wants **missing-event support**. EQL is the widely documented syntax that has it. Sigma covers joins/windows/order; EQL covers “A then not B then C.”
- **Cost:** Implement a minimal interpreter over in-memory event streams (not Elasticsearch). Scope: ordered stages + join keys + maxspan + optional negative stage. Hundreds of lines if ruthlessly minimal.
- **Trap:** Running Elasticsearch is not on the table. Missing-event matching is expensive (state retention for the whole maxspan). Bound state per join key with hard eviction (max keys, maxspan) or OOM.
- **Confidence:** docs.

---

## 9. Second independent sensor (shadow mode)

### 9.1 Sysmon / ETW as shadow, AEGIS as primary (discrepancy report)

- **Technique:** Primary remains user-mode polling + chokidar. Shadow consumer reads Sysmon Event Log or a dedicated ETW session (kernel providers already in Windows). Diff: events only in shadow, only in primary, both, attribution mismatch. Emit discrepancy report, do not auto-merge into scoring until measured.
- **Source:** Sysmon + ETW (Microsoft). Same as §6.1; dual-use as bench oracle and runtime shadow.
- **Where:** Event Log channel `Microsoft-Windows-Sysmon/Operational`; ETW providers e.g. kernel process/network (documented provider names on Microsoft learn).
- **Why it beats a second user-mode poller:** Independence. Two tasklist scrapers share failure modes. Sysmon/ETW does not.
- **Cost:** Optional Windows-only module; admin for Sysmon. Shadow off by default. Discrepancy JSONL or SQLite table.
- **Trap:** **Writing** a minifilter or custom kernel driver is out of scope — only **read** existing providers. Sysmon may be absent; shadow must degrade to “unavailable,” not fake agreement. Volume can overwhelm without filters — start with process create/terminate only.
- **Confidence:** docs.

### 9.2 AgentSight multi-source priority (pattern only)

- **Technique:** Multiple observation sources for the same logical call; pick by documented priority (e.g. network-observed usage beats session-file estimate) and record which source won.
- **Source:** agentsight `cli_db.rs` test `token_queries_use_highest_priority_source_per_llm_call` (priority `response_usage` over `agent_native_session`).
- **Why it beats silent overwrite:** When shadow and primary disagree, store both and mark precedence — same pattern.
- **Cost:** Schema fields `source`, `priority` on discrepancy rows.
- **Trap:** Do not import AgentSight’s TLS interception (out of scope). Pattern only.
- **Confidence:** impl.

---

## 10. Recovery after an agent mistake

### 10.1 AAT tombstone records (chain-preserving correction)

- **Technique:** Replace a bad/privacy-sensitive record with a tombstone that keeps `record_id` / linkage metadata and documents deletion reason; store original hash so validators can accept the intentional chain break.
- **Source:** draft-sharif-agent-audit-trail-00 §7.3 Tombstone Records.
- **Where:** Spec §7.3 fields (`event: record_deleted`, `tombstone_hash`, …).
- **Why it beats “edit the JSONL” or “delete the day file”:** Edits break or silently rewrite history; day-file delete loses everything. Tombstones are the published recovery shape for append-only chains under GDPR-style constraints — and for “we logged the wrong attribution, here is the correction.”
- **Cost:** New event type + verifyChain exception path for tombstones. Spec is clear enough to implement without a library.
- **Trap:** Our current chain has **no** stored prevHash and assumes `seq === line index`. Tombstones must be **appended** corrections (pointer to bad seq) if we refuse in-place replace — prefer **compensating records** (`correction` / `retraction`) append-only, which fits our model better than AAT’s in-place replace. Say so in schema docs.
- **Confidence:** docs.

### 10.2 Vector checkpoint recovery after crash mid-write

- **Technique:** On open, reconcile reader/writer ledger against data files; truncate torn tails; count dropped events into buffer accounting rather than panicking or double-delivering blindly.
- **Source:** Vector `disk_v2` — `Buffer::from_config_inner` in `mod.rs` (calls `validate_last_write`, `reconcile_checkpoint_window`, `seek_to_next_record`); detailed recovery in `checkpoint_recovery.rs`.
- **Why it beats us:** Failed audit flush re-queues pristine memory entries (good) but a **killed process** loses the buffer. A durable pre-flush queue with torn-write recovery is how you survive “agent mistake” that takes down the host process mid-burst.
- **Cost:** Same as §4.1 if we adopt disk segments; otherwise document that recovery only covers flush failures, not kills.
- **Trap:** Recovery that rewrites history without a marker is indistinguishable from tampering. Always emit a loss/recovery marker into the hash chain when the durable queue detects truncation.
- **Confidence:** impl (mod.rs recovery flow).

### 10.3 AAT gap records on resume after crash

- **Technique:** If a session cannot produce continuous records, insert an explicit error/lifecycle recovery record documenting the gap rather than silently continuing the chain.
- **Source:** AAT §6.2 (no gaps; recovery record on crash), §6.3 orphaned sessions → synthetic close with `trigger: crash_recovery`.
- **Why it beats silent resume:** Our `seedFromTail` continues seq after restart with no breadcrumb that the process died. Operators cannot tell clean restart from crash hole.
- **Cost:** One `lifecycle`/`error` audit type on startup if unclean shutdown flag present.
- **Trap:** Without an unclean-shutdown flag (pid file / lock), you cannot know. Prefer lockfile or “session open without close” detection on next start.
- **Confidence:** docs.

---

## Roadmap items where nothing clearly beat our plan

| Item | Note |
|------|------|
| **User-facing verify command** | Algorithm is already ours (`verifyChain`); external world only reaffirms the procedure (AAT §4.3). Ship wiring, do not redesign. |
| **instanceId = pid + startTime** | Sysmon ProcessGuid solves the same problem differently; our OS-startTime binding is appropriate for a user-mode app that will not ship a driver. No superior portable substitute found. |
| **JSONL as canonical store** | Confirmed by AAT (JSONL primary) and by every serious “index is disposable” design. No finding says “replace JSONL with DB as truth.” |
| **Drop-oldest on audit buffer under full disk** | Operationally sound for a monitor; Vector offers alternatives but does not obsolete the policy choice we made. Markers for loss visibility are already better than most ship. |
| **Attribution evidence enums** | No external schema matched our `confirmed` / `inferred` / `unattributed` + evidence codes better than keeping them; OCSF can carry them as custom extensions if needed. |

---

## Roadmap items where our plan is clearly weaker than what exists

| Item | Gap | Steal |
|------|-----|-------|
| **Canonical hashing** | Homemade key-sort ≠ RFC 8785 | Adopt JCS (`canonicalize` or equivalent) on the next chain version |
| **Audit field taxonomy / regulatory mapping** | Private v1 schema only | Map/export toward AAT for agent-level semantics; OCSF for OS events |
| **Crash-safe event pipeline** | Memory buffer only; kill = silent loss beyond best-effort markers | Vector disk_v2 design (segmented files + ledger + CRC + policies) |
| **Sequence / correlation rules** | Flat YAML, no join/window/missing | Sigma correlation subset + EQL-style missing events |
| **Replay + ground-truth bench** | Live scenario bench built (`bench/`, Sysmon/Procmon oracle, Windows-only, never in CI); offline replay from recorded fixtures still unbuilt | AgentSight-style offline report path over recorded pre-attribution observations |
| **SQLite index + query CLI** | Planned, not built | AgentSight CLI verb set + rebuild-from-JSONL discipline |
| **Health / sleep / sensor death** | State machine built in main (`sensor-health.js`: FS chokidar/handle/RM + network); no scan-loop record, no renderer consumer, no sleep/wake handling | osquery-style publisher state for the remaining subsystems + ETW loss counters + Electron `powerMonitor` |
| **Second sensor** | Not started | Sysmon/ETW shadow + discrepancy report (read-only) |
| **Recovery after mistake / crash hole** | Resume chain with no gap record | AAT tombstone/compensating record + startup gap marker + durable queue recovery |

---

## Explicitly rejected (out of scope or not stronger)

- **Writing** filesystem minifilters / custom kernel drivers — rejected; reading Sysmon/ETW is fine.
- **TLS interception / HTTPS proxy** (AgentSight SSL path, MITM) — out of scope.
- **Reading foreign process memory** — out of scope.
- **Automatic containment / kill as a product feature** — out of scope (own-PID guards stay).
- **Per-event numeric confidence / risk fractions in product** (AAT optional `risk_score`, AgentSight `confidence` columns) — banned until ground-truth bench exists; bench aggregate metrics are allowed.
- **Community rule marketplaces** — out of scope.
- **Embedding full Vector or Elasticsearch** — too heavy; steal designs, not products.

---

*Generated as a recon-only deliverable. Single write path: this file. No code changes, no PRs.
Re-verified against `master` @ `d027f0c` on 2026-08-13 before it entered git; the corrections are
marked **[since recon]** in place rather than appended, so no superseded claim is left standing.*
