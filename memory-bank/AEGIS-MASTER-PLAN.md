# AEGIS — Master Development Plan

> **Purpose:** the single source of truth for AEGIS development. Keep it at `memory-bank/AEGIS-MASTER-PLAN.md` OR paste the contents into a new chat — the context picks up from here.
> **Scope:** development only (code / architecture / features). No Dev.to post, no landing page, no marketing.
> **Checked against live code:** master @ `<verify: git rev-parse --short HEAD>`, 2026-06-03. Numbers are a snapshot, not the truth.

---

## 0. How to use this + working protocol

**TRUST CODE OVER DOCS.** Before quoting any number or fact, read the source (`package.json`, `git log`, `src/shared/*`, `ARCHITECTURE.md`). The numbers in this file go stale.

**Claude Code cycle (every step):**
```
/clear → read CLAUDE.md, @package.json, memory-bank/progress.md
→ ONE task → (non-trivial: /plan, wait for OK)
→ verify gate → commit "type: summary" → update progress.md → STOP
```
- Verify gate: renderer-only → `npm run build:renderer`; logic/types → `npm run typecheck && npm run lint && npm test`.
- Steps in batches of 3–5 with time estimates. `/simplify` after every 3–5 steps.
- Multi-file work — via orchestration / parallel subagents; read-only analysis — a subagent (`test-auditor`) to keep the context clean.
- Deterministic ship/merge — the `/ship` skill (format→commit→push→PR→CI). CC runs `git push` itself; force-pushing master is forbidden.

---

## 1. What AEGIS is + verified state

**One line:** a local-first, out-of-band OS-level observer of AI agents (processes / files / network) with agent signatures, risk scoring and a dashboard. It sits **outside** the agent → needs no cooperation and does **not slow the agent down** (unlike hook-based tools).

**Snapshot (orientation, not truth; verify with the command, never type the number in):**
```sh
# version
node -e "console.log(require('./package.json').version)"
# agents
node -e "console.log(require('./src/shared/agent-database.json').agents.length)"
# rules
grep -rhcE '^\s*-\s*id:' rules/*.yaml | paste -sd+ | bc
# tests (counted by running the suite; never type the number in)
npm test 2>&1 | tail -3
# LOC main
find src/main -name '*.js' | xargs wc -l | tail -1
# commit / date
git rev-parse --short HEAD ; date +%F
```
- Electron 43 · Svelte 5 (runes) · Vite 7 · main = JavaScript/CommonJS · renderer/shared = TS · chokidar 3 · ajv · js-yaml · Vitest 4

---

## 2. Architectural truth (what the code actually does)

**Collection layer:** Windows — `tasklist /FO CSV` (async) + PowerShell `Get-CimInstance Win32_Process` (parent map) + `Get-NetTCPConnection` (network) + `handle64.exe`/Get-Process (file handles); files — chokidar (`usePolling:false`). Caches: parent-chains 60s TTL, CWD 60s TTL, DNS 300s TTL. **Everything on the Electron main process — no `utilityProcess`, no `worker_threads`.**

**Pipeline:** scan → file/network → baselines → anomaly (0–100) → risk score → trust grade (A+…F) → audit (JSONL) → UI.

**What it SEES:** process spawns (per poll), file writes/creates/deletes, handles open at poll time, outbound TCP + DNS (per poll / on change), known-vs-unknown endpoint classification.

**What it does NOT see (security gaps — all of these are dev tasks):**
- **File reads.** chokidar catches `add/change/unlink`, not `IN_ACCESS`. An agent **reads** `~/.ssh/id_rsa` → the file-watcher stays silent; it is caught only if the handle is open at the moment of the 30s scan or via a subsequent connection. → your strongest detection is effectively the **network**, not files.
- **Polling gap.** A process/connection that lives between polls (≤10s processes, ≤15s network) is invisible.
- **Intent.** No LLM-traffic interception → you see effects, not intent.
- **Tamper.** A user-space JS process + an unsigned editable JSONL log; no self-protection.

**Why this matters (research):** an agent can evade purely behavioral detection (Weak-to-Strong Monitoring, Scale/CMU/MIT); what cannot be faked is exactly the OS-level effects (a connection to an unknown endpoint). → **network scoring is the load-bearing capability**, and tester demand confirms it.

---

## 3. Verified bug backlog

### P0 — correctness (fix first, EACH with a regression test)
| ID | Where (anchor) | Bug | Effect |
|---|---|---|---|
| C-01 | `file-watcher.js` `aiAgents.length>0?aiAgents[0]` | file events → the first AI agent; the self-access exemption also fires against the wrong agent | breaks attribution / audit / baselines / risk calibration. **PREREQ** for per-agent work and correlation |
| C-02 | `scan-loop.js` `setInterval(doProcessScan)` | no reentrancy guard (`doNetworkScan` has one) | overlapping scans → duplicated/missed sessions |
| C-03 | `audit-logger.js` + `logger.js` `_buffer.splice(0)` before append | the buffer is not restored in `catch` | silent audit/log loss |
| C-04 | `agent-database.json` + `process-scanner.js` (first-match `break`) | 4 cross-agent duplicate names (`claude.exe`, `gemini`, `copilot-language-server`, `sm-agent`) + 6 repeated names within a single agent | agent mis-identification |
| C-05 | `rules/secrets.yaml` SC003/004/007 | `password`/`credential`/`api_key` with no path anchor | mass false positives |

**Test quality (important):** all 5 modules DO have tests, yet the bugs pass green (C-01 — fixtures with a single agent; C-02 — no concurrency test; C-03 — only the callback is checked, not data survival). Every fix needs a test that **would have failed while the bug existed**.

### P1 — functional gaps / UI vs reality
- **C-06** localModels are sent after `scan-batch` → one cycle late.
- **C-07** user-set `ignoredDirectories` never reach the project-watcher.
- **C-08** a partial `save-settings` resets missing fields to defaults.
- **C-09** customAgents are stored/displayed/exported but **never scanned at runtime**.
- **C-10** the "block"/Paranoid UI presets are **not enforced** in main. → decide: implement minimal enforcement OR rename to "alert only (enforcement planned)".
- **C-12** anomaly toast storm on first render (empty prevAnomalyKeys).
- **C-13** async setState after unmount in several components.
- *(C-11 reveal-in-explorer path traversal — **ALREADY FIXED** (`isInsideUserData` guard). Do not reopen.)*

### P2 — performance (→ Phase 2)
- **C-14** `O(processes×agents×patterns)` matching per scan.
- **C-15** synchronous `/proc` walk (linux) blocks the event loop; darwin `O(n²)`.
- **C-16** `classifySensitive` — a linear pass; `categoryIndex` exists in `rule-loader.js` but is unused.
- **C-17** files over 300 lines: `ipc-handlers.js` 556, `ActivityFeed.svelte` 492, `main.js` 424, `constants.js` 415, `ai-analysis.js` 391, `config-manager.js` 387, `file-watcher.js` 376, …
- **C-18** all tabs stay mounted; `ActivityFeed` renders ~200 rows with no virtualization.

### P3 — absurdities / dirt
- **C-19** `AgentStatsPanel.svelte` `$derived($tick ? Date.now() : Date.now())` — both branches identical.
- **C-20** `ActivityFeed.svelte` dead branch in `formatRelativeTime`.
- **C-21** different trust-grade thresholds in `trust-badge-utils` vs `risk-scoring`.
- **C-22** a double source of truth: `constants.js` SENSITIVE_RULES (deprecated) vs `rules/*.yaml`.

---

## 4. Performance roadmap (make it fly)

> **⚠️ MEASURE-GATE 2026-06-04 (read-only): `utilityProcess` REMOVED from Tier 0 → Phase 5.** Code measurement (file:line) proved the Windows + macOS engine is fully ASYNC with zero event-loop blocks — a `utilityProcess` offloads CPU-bound work, but moving async I/O to another process does NOT speed it up, and no CPU-bound tick exists. Per Electron docs a separate process = last-resort; the freeze premise is absent on the primary platform. utilityProcess re-homed to Phase 5 as **isolation / self-protection**, NOT a freeze-remedy. False alarms cleared: C-18 (feed capped 200 / stores 500) and darwin-sync (it's async). Tier 0 re-oriented **instrumentation-first**. See `progress.md` "Phase 2 measure-gate" + `DEFERRED-utilityprocess-migration.md`.

**Tier 0 — quick wins, no architecture change (instrumentation-first):**
1. **`feat/scan-timing-instrumentation` — FIRST.** `performance.now()` around the 3 scan functions (`scan-loop.js` doProcessScan/doFileScan/doNetworkScan) → structured log. Today `grep performance.now` = 0 hits → we are flying blind. A prerequisite for ANY perf decision, and the only path to reopening utilityProcess (only a measured CPU-bound Windows tick re-motivates it).
2. **Linux /proc — async** (C-15-linux) — the only real sync block: `platform/linux.js:66,69,194,198` (`readdirSync('/proc')` + per-PID `readFileSync` + per-fd `readlinkSync`) → `fs.promises`. Prove it with the stopwatch from item 1 (before/after). darwin is already async (false alarm cleared).
3. **A `name→agent` index (O(1))** — fixes C-14, makes the C-04 duplicates deterministic.
4. **`classifySensitive` via `categoryIndex`** (C-16).
5. **Collapse the PS calls into one script per cycle + a persistent runspace** — cuts the spawn tax (hits hardest under agent churn).
6. **Ring buffers / OOM hardening** (your roadmap).
7. *(opt.)* **async log flush** — `logger.js:140` / `audit-logger.js:141` `appendFileSync` → async (minor, batched 50/5s).

**Tier 1 — event-driven (the real "flight") → Phase 5.**
> ⚠️ Do not conflate: changing the collection layer (ETW/driver) = "it flies"; Tauri-vs-Electron = UI RAM weight. The former comes first.

---

## 5. Security hardening roadmap (dev)
- **Tamper-evident audit:** hash-chained JSONL (`prevHash` + `hash = H(prevHash + canonical(event))`) + optional Ed25519 signing. Builds on the C-03 fix. (Nobulex / MS AGT pattern)
- **Close the read blindness:** for now — raise handle-scan coverage; properly — ETW file events / fanotify (Phase 5).
- **Close the polling gap:** event-driven collection (Phase 5).
- **Self-protection:** the engine in a separate (elevated/service) process; protect the audit directory.
- **Intent / boundary tracing (honestly):** on Windows ≈ an opt-in local proxy or WFP, **NOT eBPF**; build it against demand. Reference — AgentSight.
- **Network scoring — load-bearing:** blocking is not an option (Claude Code needs the internet) → strengthen known-vs-unknown endpoint classification + scoring. This is the signal users react to.

---

## 6. Capability / feature roadmap (borrowings + demand)
- **OWASP Agentic AI Top 10 (2026) mapping** — tag every rule/detection (goal hijacking, tool misuse, identity abuse, rogue agents…). Replaces the MITRE overclaim; the standard MS AGT and the ecosystem anchor to.
- **OpenTelemetry `gen_ai.*` / event export** — interop with Phoenix/Langfuse/Grafana.
- **Headless / daemon JSON mode** — runs without Electron, structured JSON logs + trust score, for VMs/CI/servers. *(Validated by demand — Apex Stack; fits on `src/main/cli.js`.)*
- **SQLite session store + query CLI** (`db`/`report`/`prompts`/`list`) — the AgentSight model; complements/replaces JSONL.
- **`top`-style ranked live view** — like AgentSight `top`: ranked by tool calls / file / network activity / health.
- **Dashboard UX (from productivity dashboards):** Kanban (Working/Waiting/Completed/Error), activity heatmap, live/offline indicator. *(You already have the parent-child agent tree with chevrons.)*
- **analyzer-chain refactor** (AgentSight pattern) — composable stream processors; the self-access exemption + event dedup (risk-engine invariants) + privacy filters (strip auth headers) also land there.

---

## 7. Intelligence (gated on C-01)
- **Per-agent baselines + z-score anomaly** — your ML roadmap; validated (John Sun, Mykola).
- **Process→file→network correlation** (an AgentSight idea) — **REQUIRES** correct attribution (C-01 first).
- **Human-in-the-loop triage** — escalate only pre-flagged anomalies (weak-to-strong: +~15% TPR at FPR 0.01).
- **Rules UI** (your roadmap; the IPC is ready — `getRulesByCategory`/`onRulesReloaded`, the front end is not built).

---

## 8. Execution order by phase + dependencies
```
Phase 1   Correctness:   C-01 → C-04 → C-03 → C-02 → C-05   (+ regression tests)
Phase 2a  Perf/UX:       instrumentation-first (scan-timing) → Linux /proc async   [utilityProcess REJECTED as a freeze cure 2026-06-04 → Phase 5]
Phase 2b  Perf (Tier 0): O(1) index, categoryIndex, PS runspace, ring buffers
Phase 3   Trust:         hash-chained signed audit, OWASP mapping, OTel export
Phase 4a  Reach:         headless JSON daemon
Phase 4b  Reach:         SQLite session store + query CLI
Phase 4c  UX:            top-view (ranked live) + dashboard UX
Phase 5   Moat:          Rust/native event-driven sidecar (ETW Win / eBPF+fanotify Linux / EndpointSecurity mac)
          (multi-month, native sidecar — NOT a one-week task)
                         → closes the polling gap + read blindness + tamper + main-process load
Phase 6   Intelligence:  per-agent baselines, z-score, correlation, triage, Rules UI
```
**Hard dependencies:**
- **C-01 → Phase 6** (correlation / per-agent work is impossible on broken attribution).
- **C-03 → Phase 3** (the hash chain builds on the fixed flush).
- **`utilityProcess` → Phase 5** (NOT Phase 2a — the 2026-06-04 measurement removed the freeze premise; moving the engine out remains a stepping stone toward the sidecar, but the motivation = ISOLATION/SELF-PROTECTION, not perf). Ready 6-PR plan: `DEFERRED-utilityprocess-migration.md`.
- **analyzer-chain** — the home for the self-access exemption + dedup (the C-04/C-05 calibration zone).

---

## 9. Invariants (do NOT break)
- main = Node/CommonJS APIs only; renderer = browser APIs + Svelte 5 **runes** (`$state`/`$derived`/`$effect`), **no legacy Svelte 4**.
- TS — renderer/shared only; main = JS + JSDoc.
- New IPC channels → via the `preload.js` contextBridge, names in **kebab-case**.
- A file ≤300 lines (soft), early returns, named exports.
- Commit after every working state; **verify BEFORE commit**; **NEVER force-push master**.
- One P0 = one PR ≤300 lines. Do not stuff several fixes into one PR (protection against git races and unreadable diffs).
- Risk engine: **self-access exemptions, event dedup, weights with diminishing returns** — do not break these when touching scoring.
- **Code honesty:** no "tamper-proof" / "kernel" / "blocks" in code strings/UI until the capability is real (see C-10).
- TRUST CODE OVER DOCS — verify numbers against the code.

---

## 10. Definition of "a serious project" (exit criteria)
- [ ] Phase 1 DoD: C-01..C-05 closed; each has a regression test that is RED without the fix (proving the fix is real).
- [ ] 0 P0 bugs; each one has a test that fails without the fix.
- [ ] Monitoring off the main thread; no UI jank.
- [ ] Tamper-evident (hash-chained) audit; rules with OWASP mapping; OTel export.
- [ ] Headless daemon mode works (usable in VMs/CI).
- [ ] Event-driven collection at least on Windows (ETW) → polling gap + read blindness closed.
- [ ] Per-agent baselines + anomaly.

---

*End of plan. The source of truth is the code; sync this file after major changes.*
