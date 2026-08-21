# AEGIS — RESEARCH-BASELINE V2 (2026-08-13)

Canonical. Replaces RESEARCH-BASELINE v1 entirely. Where AEGIS.md conflicts (npm start warning,
"AgentSight Linux-only paper", block order), THIS file wins; patch AEGIS.md accordingly.
Dated facts must be re-verified before load-bearing use. Delete v1.

---

## 1. POSITIONING

AEGIS is an independent, local, Windows-first observability layer that reconstructs what an
AI-agent process actually did on the machine from OS evidence alone — graded by provenance,
verifiable by anyone.

- Never claim "first", "only", "niche is empty". The niche is occupied.
- Closest competitors, three axes (all true simultaneously):
  - product surface: **Origin** (ex-Prelude, $45M total funding as of 2025-09, endpoint AI
    observability, TLS-layer semantic capture + OS effects, closed source);
  - open-source system-level: **AgentSight** (eBPF, MIT, shipped local-first tracer with
    sessions/reports/OTEL GenAI export; live capture Linux-gated, Mac partial, **no Windows**);
  - collection architecture: **Rustinel** (Win ETW / Linux eBPF, Sigma+YARA+IOC,
    ECS 9.4.0 NDJSON output, Apache-2.0, v1.2.0 2026-07).
- Complementary, not competitors: Pipelock (v3.3.0), Microsoft Agent Governance Toolkit
  (MIT, 2026-04), AgentWall, AgentBound, LlamaFirewall/NeMo, cooperative hook/transcript monitors.
- "No kernel driver, no cloud" is **table stakes**, not a differentiator — SACR describes Origin
  with exactly those words.
- Moat pillars: privacy (no prompt content ever captured or stored) · no MITM / no cert-store
  manipulation · provenance independent of prompt availability · smaller trust surface · works on
  agents that do NOT cooperate · attribution honesty (graded, no invented confidence) ·
  independently verifiable audit.
- **Retired argument:** ECH/DoH do NOT weaken competitors' semantic capture — sslsniff-style
  capture hooks SSL_read/SSL_write at the library boundary, before encryption. Never use ECH/DoH
  as a moat argument. (Their approach is itself blind on rustls and Go crypto/tls — matrix
  honesty note only, not our moat.)
- Do not call Origin/AgentSight "TLS-dependent" wholesale: TLS is needed for semantic intent
  only; they see OS effects independently.

## 2. TRUST & ATTRIBUTION CANON

- OS-truth first. The observed agent is never trusted to report its own actions.
- Attribution vocabulary: `confirmed` / `inferred` / `unattributed` + mandatory `evidence[]`
  (closed 6-code list, src/main/attribution.js). No numeric confidence before Bench.
- `inferred` requires at least two independent evidence families.
- `unattributed` events never affect an agent's risk and never enter its baseline.
- Cooperative telemetry (hooks, transcripts, MCP, SDK, OTEL) may ENRICH a record as an
  explicitly-typed lower trust class; it may never MANUFACTURE OS truth and never silently
  upgrades inferred into confirmed.
- Observation Point ≠ Decision Point ≠ Enforcement Point.

## 3. HARD CONSTRAINTS (unchanged)

No kernel driver / minifilter · no TLS interception in core · no ReadProcessMemory · no automatic
containment / Job Objects · no full Rust rewrite · no Rustinel fork · no copying competitor code ·
no native in-process module inside Electron main · no proprietary sequence-rule syntax where an
open standard fits · no numeric confidence before Bench · no unique/first/only marketing.
Permanently cut: Honey Workspace, Community Packs, Behavior DNA, Query Console, big MCP gateway.
UI cosmetics never proposed.

## 4. WINDOWS IDENTITY CANON — Generation v2 contract

**Frozen:** `instanceId = pid:startTime(ms)`, read-never-derive. startTime stays epoch
milliseconds — token-adapters/claude-code.js:119-122 compares in ms; 78 test literals in 14 files.
No migration in Block 1.

**Invariant (verbatim):**
> Generation witness is authoritative for cache-generation validation but does not change the
> current `instanceId` format. Therefore same-PID + same-millisecond distinct generations remain
> a known downstream identity bound even when a stronger witness can distinguish them.
> Generation v2 must not claim to eliminate that bound.

**Block 1 solves:** the CIM hot-path tax (measured 2026-08: N=32, 486 processes, p50 1284 /
p95 1459 / max 1657 ms per non-empty enrich pass) · stale parent-chain/CWD cache reuse ·
distinguishable PID reuse at generation-proof level · fail-honest fallback.
**Block 1 does NOT:** migrate instanceId, or claim runtime identity is fully fixed.

**Primitive chain (capability-gated at runtime, never build-number guessing):**
1. **Not wired as of 2026-08-13 (Block 1) — see the generation-witness status note below.** Sidecar
   snapshot via NtQuerySystemInformation `SystemBasicProcessInformation` — Win11 26100.4770+,
   per-process kernel `SequenceNumber` documented by Microsoft as the PID-reuse detector (instead of
   CreateTime); faster/lighter class, no processor wakes. External datapoint (2026-01): ~700x faster
   than WMI enumeration.
2. **The live witness path.** Same sidecar, class-5 `SystemProcessInformation` on all builds —
   CreateTime in 100ns ticks for every process in one snapshot, **no per-process handles** (the
   GetProcessTimes 26%-inaccessible problem does not apply here).
3. Existing CIM Win32_Process.CreationDate — emergency fallback only (sidecar dead).
4. Unknown birth time — fail-honest; never inherit a stale generation.

**Generation-witness status (2026-08-13, Block 1 as shipped in PR-B):** the witness rides on
`createTime100ns` — primitive 2, the class-5 `SystemProcessInformation` path — not on
`SequenceNumber`. Primitive 1 stayed **unwired**: `SystemBasicProcessInformation`'s numeric
info-class value is not published (MS Learn documents the struct and its 26100.4770 availability but
no enum number), and the one secondary source that offers a value returns a 12-byte payload on build
26200.8655 — plainly another class, caught by the sidecar's validation. Guessing a kernel info-class
number is out. The class also carries **no CreateTime**, so even once its number is confirmed it
could only ADD a second call for `seq` alongside the class-5 birth time, never replace it — and the
wire, client and chooser already carry an optional `seq` field, so enabling it is a change to
`sidecar/procsnap/` alone. `createTime100ns` is 10 000× finer than the epoch-ms it replaced; the
same-pid + same-millisecond bound in the Invariant above is unchanged by any of this.

**Witness storage:** string, always — ULONG64 SequenceNumber and 100ns CreateTime both exceed
what JS numbers hold safely; JS must never swallow precision. Witness is a separate field that
gates cache/merge reuse; it is NOT part of the instanceId key.

**Known bounds (documented, not hidden):** any snapshot path is blind to processes born and dead
between 10s scan ticks — closed later by a narrow Microsoft-Windows-Kernel-Process ETW slice,
decision AFTER Block 1 measurements, not now. NtQuerySystemInformation carries Microsoft's
"may be altered or unavailable" disclaimer — hence capability gate + fallbacks are mandatory.
PR #206 (merged) already made Win32 pay one fresh CIM observation per non-empty enrich pass;
providesStartTime=true on win32, false on linux/darwin.

## 5. SENSOR ARCHITECTURE

- JS/TS core stays. Native code = strangler/hot-path only.
- Sidecar = separate process, named pipe / stdio, length-prefixed frames. A native crash must
  never take down the Electron control/UI process.
- Sidecar language is a **reversible implementation choice** — the wire boundary is the stable
  contract. Block 1 physically picks one; the canon keeps it open (C#/TraceEvent vs Rust/ferrisetw
  re-evaluated when the streaming sensor becomes real).
- Never cite Encore's 2-4 ms as one sidecar-boundary cost (it was a multi-hop path). Benchmark
  AEGIS's own IPC.

## 6. FILE-READ ATTRIBUTION (Block 3)

- Source of record: `docs/recon/kernel-file-etw.md`. No claim below outranks its label there.
- Sensor/SUT: Microsoft-Windows-Kernel-File ETW `{edd08927-9cc4-4e65-b970-c2560fb5c289}`;
  admin/SYSTEM, no PPL required, very high volume. **VERIFIED, scoped to the Windows 10 build 18990
  manifest and no other build:** Read = event 15, `KERNEL_FILE_KEYWORD_READ` `0x100`, payload
  carrying NO pathname — only `FileObject`/`FileKey`; Create 12 = `FileObject`+`FileName`,
  NameCreate 10 = `FileKey`+`FileName`, Cleanup 13 / Close 14 exist; **no provider rundown event**.
- **NOT FOUND — retire "PID from the event header".** Event 15's issuer is unestablished across
  `EventHeader.ProcessId`, `ThreadId`/`IssuingThreadId` (v0/v1) and possible PID-4 attribution;
  never attribute or filter by it. A path comes only by correlating `FileObject`/`FileKey` with
  path-bearing events, whose lifetime and reuse are unestablished (legacy FileIo = ANALOGY).
  No rundown: files open before session start stay `unresolved` — fail-honest, never fabricated.
- `EVENT_FILTER_TYPE_PID` on this GUID is unproven until reproduced on target hardware; machine-wide
  capture plus user-mode attribution is the required fallback, and event-ID filtering is applied
  after generation — it cuts delivered volume, not provider cost. Mask `0x190` covers 10/12/15 only;
  13/14 need the FILEIO keyword `0x20`; `0x1B0` is a CANDIDATE, and 13/14's necessity is unratified.
- Independent confirmation: deterministic scenario catalogue + Procmon (file-IRP) + controlled
  4663 with pre-set SACL. **The SUT's own provider is never its own oracle** (common-mode rule) —
  and no per-event oracle for 15 exists: Procmon proves file activity, not that 15 fired, and 4663
  is not a per-Read oracle. Sysmon has NO file-read event; EID 11 = create/overwrite only.
- Bounded queue / backpressure / loss counters land in THIS block, before production ingestion.
  Policies: security events never dropped (spill to disk) · benign self-churn coalesced with
  automatic break on .ssh/.env/exe-write/unknown network · metrics latest-only. `EventsLost` /
  `RealTimeBuffersLost` flag collection unreliability, never WHICH event was lost.
- 13 HARDWARE-GATED items close only on the target machine: PID filter, issuer, Win11/2026 manifest.

## 7. NETWORK CANON

Per-process TCP tables + Sysmon EID 3 (connects) + EID 22 (DNS **queries only**). Blind spots to
state honestly: DoH, custom resolvers, direct-IP, encrypted SNI. No TLS payload inspection in core.

## 8. EVENT SCHEMA

Thin internal canonical event shape → **ECS on the wire/output** (Rustinel precedent: ECS 9.4.0
NDJSON). Decide naming BEFORE freezing Bench Replay schema. OCSF = possible later export, not now
(re-nesting cost). OTEL GenAI = enrichment/export only, pre-stable — pin the version.

## 9. CORRELATION RULES

- Public format: Sigma correlation. **Contract = formal spec v2.1.0 + JSON Schema = 7 types**
  (event_count, value_count, temporal, temporal_ordered, value_sum, value_avg, value_percentile).
  The sigmahq.io docs page claims 8 with value_median — docs-ahead-of-spec, not the contract;
  median = percentile 50.
- Implement `temporal_ordered` + the minimal needed subset. Unsupported types → explicit reject,
  never silent skip.
- Execution: own bounded temporal FSM — maxspan, join/group keys, TTL, active-state caps,
  watermark/ordering policy, dedup key, eviction counters. Justification: no production JS/TS
  EQL/CEP engine exists (checked 2026-08); determinism + memory bounds + zero dependency risk.

## 10. BENCH CANON

- Bench before ANY numeric accuracy/confidence claim.
- Method: generate an expected-event catalogue per scenario, confirm with independent oracles.
  Never diff two live streams. Never self-oracle.
- Oracle columns are separate: Sysmon (EID 1/2/3/5/11/22/**26**) = security-event reference;
  Procmon = file-IRP reference; Kernel-File ETW appears only as SUT when it is the sensor.
- **Ratified 2026-08-14 (B2.3).** (a) **EID 26 FileDeleteDetected** joins the oracle column: it is
  the deletion observation that does NOT archive the file. **EID 23 FileDelete is never enabled
  merely to observe a deletion** — Microsoft documents 23 as additionally saving the deleted file
  into `ArchiveDirectory`, and the two are never collapsed into one semantic event. Whether an
  installed binary requires or otherwise touches `ArchiveDirectory` when 26 is configured is
  **LIVE-UNVALIDATED**: the docs settle neither, and no answer is invented offline. (b) ProcessGuid
  may be retained and compared as an OPAQUE **equality** key between Sysmon events (EID 1 ↔ EID 5)
  — an additional lifecycle-correlation fact BESIDE EID 1 ordinality, never a replacement for it,
  and never a source of an `instanceId`.
- Sysmon writes two timestamps (EventData UtcTime ms vs System TimeCreated FILETIME) diverging
  1-2 s — join on TimeCreated, record both. ProcessGuid is Sysmon-generated — never parse it.
  Match by pid + start-time FILETIME, epsilon ~2 s. **That epsilon is a tolerance for comparing
  Sysmon's own two representations. It is NOT guest-clock uncertainty**, which is unmeasured, and
  the two must never be merged into one error bound. B2.3 declares no epsilon at all: it retains
  both representations, computes no delta, and leaves matching to B2.5.
- Environment: Hyper-V Gen2 gold image first; Windows Sandbox second (driver load and unattended
  teardown unverified; nested virt unsupported on GitHub runners). Pin the Windows build.
- Run separation: A = sensor+Sysmon (coverage/latency) · B = Sysmon+Procmon without sensor
  (oracle calibration) · C = sensor alone (overhead).
- PID-reuse scenario MEASURES the legacy same-ms bound against Sysmon EID 1 truth and documents
  it — it does not pretend the bound is eliminated. Zero silent merges required whenever
  generation evidence is distinguishable.
- Vocabulary borrowed, not invented: MITRE ATT&CK Evaluations (Visibility, Analytic Coverage,
  Detection type None, Delayed / Config-Change) · EDR Telemetry Project taxonomy (CC BY-NC,
  attribution required) · loss counters a la osquery events_max/events_expiry, Vector WhenFull,
  Sysmon EID 255 + EventRecordID gaps + wevtutil isFull.
- Workloads: SysmonSimulator (smoke), Atomic Red Team (T1059/T1105/T1041), own agent-action
  catalogue. No public "user-mode sensor vs Sysmon" matrix exists (checked 2026-08) — ours is
  the first; say "we found none", not "none exists".

## 11. AUDIT (Block 5)

Upgrade hash-chained JSONL to: Ed25519 signatures · RFC 8785 (JCS) canonical serialization ·
prev-hash chain · genesis marker · signer consistency · restart boundaries · truncation detection ·
standalone offline verifier + conformance corpus. Target property: a third party verifies AEGIS
audit integrity WITHOUT running or trusting AEGIS. References: Pipelock action receipts +
Microsoft AGT offline-verifiable receipts (Tutorial 33). Borrow formats and protocol ideas,
never code.

## 12. COMPETITOR FACTS (dated 2026-08-13 — stale-fast, re-check quarterly)

- Origin: Prelude rebrand; $16M round 2025-09-25, $45M total; endpoint sensor; TLS-layer semantic
  capture + prompt-to-action lineage; SACR: "local graph DB, no kernel driver, no cloud".
- AgentSight: repo active; sessions/SQLite, top/vis/report, OTEL GenAI export, Rust capture crate;
  live capture requires Linux eBPF (sudo/CAP_BPF); Mac partial; no Windows; <3% CPU is a paper
  figure, not our benchmark.
- Rustinel v1.2.0 (2026-07): ECS 9.4.0 output; not agent-aware; user-mode limits stated.
- Pipelock v3.3.0 (2026-07-31): signed hash-chained receipts + multi-language verifiers.
- Microsoft AGT (2026-04-02, MIT): Ed25519 identity, Cedar policy, JCS receipts, sandboxing —
  also the top existential signal (platform absorption risk).
- RootCause: **UNRESOLVED, out of the canonical set** (only an unrelated error-reporting crate
  found). ThreatFalcon: **deleted** (no primary source).
- Fastest-staling: Origin shipped-vs-claimed surface · AgentSight Windows support · Microsoft
  Windows/Defender agent-observability roadmap · AEGIS repo counts/HEAD.

## 13. BLOCK ORDER (canonical)

1. **Generation v2** — tiny sidecar; SequenceNumber where available; class-5 CreateTime fallback;
   CIM emergency fallback; witness as string; instanceId untouched; benchmark vs 1284/1459/1657 ms.
2. **Bench V1** — deterministic catalogue; independent oracles; PID-reuse scenario measuring the
   legacy same-ms bound.
3. **File-read ETW** — Kernel-File as SUT; Procmon + 4663/SACL confirmation; bounded
   queue/backpressure/loss counters INSIDE this block.
4. **Evidence graph + Sigma temporal_ordered** — formal spec/schema contract; explicit reject of
   unsupported types.
5. **Standalone audit verifier** — canonical signed chain, offline verification, conformance corpus.

Small debts slot as fillers, not blocks: overclaim comments in process-identity.js /
session-tracker.js (verify status post-#206 first) · scripts/counts.js + red CI on drift ·
tests/renderer/** typecheck include (26 errors) · health state machine on honest signals (feeds
Bench failure metrics — before/within Block 2) · danger-threshold drift 70/66/66 · demo data
carries no instanceId.

## 14. KILL LIST — never repeat

- "first / only / niche is empty" superlatives.
- RootCause as a verified peer; ThreatFalcon in any form.
- Encore 2-4 ms as one sidecar boundary cost.
- "npm start alone runs a stale renderer bundle" — **dead**: package.json on master (verified
  2026-08-13) has `start: npm run build:renderer && node scripts/launch.js`. Patch AEGIS.md.
- "AgentSight is Linux-only paper" — it is a shipped tracer; the Windows gap is the real fact.
- "Sigma has 8 correlation types" as contract.
- ECH/DoH as a no-TLS moat argument.
- Bench criterion "same pid + same ms MUST surface unattributed" — unobservable states cannot be
  labeled; the correct form is in section 10.
- "No kernel driver / no cloud" as a differentiator.
- Any hardcoded test/module/signature count without a same-day measurement.

## 15. PRIMARY SOURCES (load-bearing)

MS Learn NtQuerySystemInformation (SystemBasicProcessInformation, 26100.4770, SequenceNumber =
PID-reuse detector; "may be altered" disclaimer) · MS Sysmon docs · MS event-4663 ·
Kernel-File ETW manifest (repnz/etw-providers-docs; microsoft/Tx) · Elastic Security Labs
"Kernel ETW is the best ETW" (2024-09) · SigmaHQ sigma-correlation-rules-specification v2.1.0 +
JSON Schema · Elastic EQL docs · ECS docs · OCSF docs · OTEL GenAI semconv (pinned) ·
originhq.com + Business Wire 2025-09-25 + SACR ECP · github.com/eunomia-bpf/agentsight +
arXiv:2508.02736 · github.com/Karib0u/rustinel · pipelab.org action-receipt spec ·
microsoft/agent-governance-toolkit Tutorial 33 · EDR Telemetry Project · MITRE ATT&CK Evaluations ·
arXiv:2605.16265 (AgentWall) · arXiv:2510.21236 (AgentBound) · arXiv:2605.17380 (Uber ADR) ·
arXiv:2606.18190 (integrity matrix).
