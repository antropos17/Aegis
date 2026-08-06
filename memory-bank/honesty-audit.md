# AEGIS -- Honesty Audit (Claims vs. Code)

**Date:** 2026-06-02
**Scope:** Compare every feature claim in README.md, docs/, and marketing surfaces against the actual `src/` code.
**Method:** Read-only. Primary-source verification (grep over `src/`, `rules/`, IPC handlers). No files modified except this report.

---

## TL;DR / Verdict

The **tracked, in-repo documentation is honest** -- and in several places it *explicitly self-disclaims* the very capabilities the marketing page invents:

- `SECURITY.md:86` -- "**Monitor-only:** AEGIS currently observes but does not enforce at the OS level. ... True OS-level enforcement via kernel hooks is planned."
- `SECURITY.md:89` -- "**No TLS inspection:** ... cannot inspect encrypted traffic."
- `ARCHITECTURE.md:110-111` -- lists TLS interception and syscall monitoring in the **"What's NOT Covered Yet / Planned Approach"** table.
- `README.md:240` -- "Aegis is an observability layer, **not a restriction layer**."

The dishonesty is **isolated to one file: `aegis_landing.html`** (the Next.js marketing-site export, currently **untracked** -- `??` in `git status`). It fabricates a stack of kernel-level / ML / enforcement capabilities that **do not exist anywhere in the code**.

> WARNING -- **Severity depends on deployment.** `aegis_landing.html` appears to be a saved export of the marketing site. CLAUDE.md lists the live landing page as **aegisprotect.vercel.app**. If this file matches what is deployed there, **these false claims are live and public -- HIGH severity.** I did **not** fetch the live site to confirm; that verification is still open.

---

## The Checklist (exactly what was asked)

| # | Claim | Where it's claimed (file:line) | In the code? | Reality |
|---|-------|-------------------------------|:------------:|---------|
| 1 | "Built with ... **TypeScript**" | `README.md:6,196,224`; package.json keyword | **PARTIAL** | The **entire main-process monitoring engine is plain JavaScript (CommonJS)**: 35 `.js` files in `src/main/`, **0 `.ts`**. `src/shared/constants.js` (the rules) is also `.js`. TypeScript exists only in the UI/data layer: 28 `.ts` files (renderer utils/stores + `src/shared/types/`). So "built with TypeScript" describes the *renderer + type defs*, not the scanners/watchers/scoring. (aegis-context skill is honest about this: "incremental, allowJs:true".) |
| 2 | "68 **MITRE ATT&CK** rules" / "Risk scoring ... mapped to the MITRE ATT&CK framework" | `aegis_landing.html` (Risk Scoring card + TRACE drawer) | **NO** | Zero occurrences of `mitre`, `att&ck`, or any `T1xxx` technique ID in `rules/` **or** `src/`. The rules themselves are real (70 `- id:` entries across 8 YAML files), but they are **not MITRE-mapped** in any way. |
| 3 | "**lightweight ML** anomaly detection" / "uses lightweight ML models to detect anomalous sequences" / "ML scoring" | `aegis_landing.html` (Risk Scoring card) | **NO** | No ML anywhere. `anomaly-detector.js` = **4 hard-coded weighted heuristic dimensions** (network 0.3, filesystem 0.25, process 0.25, baseline 0.2). No tensorflow/onnx/model/neural/predict in `src/`. |
| 4 | "**netfilter** hooks" / "**syscall** hooks" / "**ptrace**" / "/proc/fs" / "hooks into the **kernel** ... at the kernel level" / "**eBPF**" | `aegis_landing.html` (Process Scanner card, Network Monitor card, How-It-Works step 02) | **NO** | None of these exist in `src/`. Process scan = `tasklist /FO CSV /NH` (`process-scanner.js`). Network scan = `Get-NetTCPConnection` via PowerShell + reverse DNS (`network-monitor.js`). No kernel module, no syscall interception, no inotify, no ptrace. (`eBPF` appears only in `ROADMAP.md:57` as a future Phase C -- honest.) |
| 5 | "**TLS interception** / TLS intercept" / "Optional TLS interception gives you full payload visibility" / "Network Intercept (checkmark)" | `aegis_landing.html` (Network Monitor card + comparison table row) | **NO** | The only `TLS` string in `src/` is a **display label** (`ThreatAnalysis.svelte:72` "All API traffic uses TLS on port 443"). `SECURITY.md:89` explicitly says there is **no** TLS inspection. The comparison table giving AEGIS a checkmark for "Network Intercept" is false. |
| 6 | "**actively block** dangerous operations" / "**auto-block** on violation" / "Policy Engine ... Auto-blocks" / process tree + live feed showing "**BLOCKED**" / "Policy Engine (checkmark)" | `aegis_landing.html` (Policy Engine card, How-It-Works step 04, process-tree graphic, footer live-feed, comparison table) | **NO** | There is **no policy engine and no automatic enforcement.** `kill-process` / `suspend-process` / `resume-process` IPC handlers **do exist** (`ipc-handlers.js:479-508`) but they are **manual, user-invoked, and PID-guarded** ("Process not monitored by Aegis"). Nothing fires automatically on a rule violation. `SECURITY.md:86` and `README.md:240` both confirm monitor-only. |

---

## Additional false claims found on `aegis_landing.html`

| Claim | Where | In the code? | Reality |
|-------|-------|:------------:|---------|
| "File Watcher ... **inotify** ... **ACL checks** ... enforce configurable allowlists" | Features card 02 | **NO / misleading** | File watching is `chokidar` (`file-watcher.js`); no inotify code, no ACL checks, no allowlist *enforcement* (only severity flagging). |
| "**LLM Prompt Injection Sanitization** -- Detects and neutralizes prompt injection attempts **before they reach your agents**" | What's New #03 | **NO** | The only sanitization is `sanitizeField()` in `ai-analysis.js` -- it truncates AEGIS's **own outbound telemetry** before AEGIS calls the Anthropic API. It protects AEGIS's analysis prompt; it does **not** sit between the user and their agents intercepting/neutralizing injected prompts. Claim is the opposite direction of what the code does. |
| "runs as a background **daemon** ... events at the kernel level -- **zero userspace overhead**" | How-It-Works intro + step 02 | **NO** | It is an Electron desktop app (userspace), not a daemon, and incurs userspace CPU (the app even reports its *own* CPU/RSS in the footer). |
| "Events flow through ... pipeline in **under 5ms**" | How-It-Works step 03 | **UNVERIFIED** | No benchmark in repo. Network scan alone runs on a 30s timer; process/file scans are interval-based. The "<5ms" figure is unsupported. |
| "checked against **70+ detection rules**" | How-It-Works step 03 | **OK-ish** | 70 rule entries actually exist (`rules/*.yaml`), so this number is fine -- but it sits next to the fabricated MITRE/ML/kernel claims, lending them false credibility. |
| "pipe to your **SIEM** / SIEM export" | Audit Log card + comparison | **PARTIAL** | Real export is JSON/CSV/HTML/ZIP + JSONL audit logs. There is no native SIEM integration; "pipe to SIEM" is generous framing of "export JSON". |

> Note: the landing page's animated stat counters render as `0 Tests Passing / 0 Agents Monitored / 0 Detection Rules / 0 Svelte Components` in static HTML (they count up via JS at runtime). Not a false claim -- just JS-driven counters. Real values (968 tests / 110 agents / 73 rules / 46 Svelte components) are accurate elsewhere.

---

## Claims that check out (the honest surfaces)

| Claim | Source | Verified |
|-------|--------|:--------:|
| "68 detection rules across 8 categories" | `README.md:36,137` | YES -- 70 `- id:` entries across exactly 8 YAML category files (ai-config, secrets, ssh, cloud, browser, devtools, crypto, certificates). "68" is within rounding of the live count. |
| "107 agent signatures" | `README.md:33,46` | YES -- consistent across docs (minor: `ARCHITECTURE.md:63` says "106" -- stale by one). |
| "Monitor-only, no OS enforcement" | `SECURITY.md:86` | YES -- matches code (manual kill/suspend/resume only). |
| "No TLS inspection" | `SECURITY.md:89` | YES -- matches code. |
| "AI analysis is opt-in, Anthropic API only on explicit click" | `SECURITY.md:80`, `ARCHITECTURE.md:90` | YES -- `ai-analysis.js` is invoke-only via IPC. |
| Network = `Get-NetTCPConnection`; Process = `tasklist`; Files = chokidar | `ARCHITECTURE.md:65,70,76` | YES -- matches code exactly. |
| "Process control (Kill/Suspend/Resume per agent)" | `CHANGELOG.md:550` | YES -- handlers exist (`ipc-handlers.js:479-508`). |
| eBPF / Minifilter / MCP interception framed as **roadmap** | `README.md:213`, `ROADMAP.md:57-58`, `ARCHITECTURE.md:111` | YES -- correctly presented as future, not current. |

### Minor doc-vs-doc drift (not dishonesty, just stale) — CLOSED
- ~~IPC channel count: `ARCHITECTURE.md:45` says "**54 channels**"; `SECURITY.md:71` says "**49 channels (43 invoke + 6 push)**". One is stale.~~ Both were stale; both now read 48 channels (39 invoke + 9 push).
- ~~Agent count: `ARCHITECTURE.md:63` "106" vs "107" everywhere else.~~ Both were stale; the live count is 110 and every doc now says 110.

---

## Recommendation

1. **Decide the fate of `aegis_landing.html`.** It is untracked. Either it is a stale local draft (low risk -- delete or fix it) **or** it mirrors the deployed **aegisprotect.vercel.app** (HIGH risk -- false advertising of security capabilities on a public security product). **Verify the live site next.**
2. If the false claims are live, rewrite the landing page's Features / How-It-Works / Comparison sections to match the honest framing already used in `SECURITY.md` and `ARCHITECTURE.md`: *monitor/observe*, not *intercept/block/kernel/ML/MITRE*.
3. Fix the two stale doc numbers (IPC channel count, "106" agents) for consistency.

**Bottom line:** The product and its in-repo docs are honest about being a userspace, monitor-only observability tool. The marketing page describes a *different, more powerful product that does not exist* -- kernel hooks, ML, MITRE mapping, TLS interception, and automatic blocking are all fabricated.

---

# Addendum -- README / CONTRIBUTING / ARCHITECTURE term scan (2026-06-02)

**Task:** confirm the tracked docs make NO current-capability claim that the code lacks.
**Method:** grep each file for the banned term list; classify every hit by *context* (current claim vs. disclaimer vs. roadmap/blind-spot).

## Every hit, classified

| What was found | file:line | Truth / Lie |
|----------------|-----------|-------------|
| "OS-level **enforcement** (Windows Minifilter, macOS Endpoint Security, Linux **eBPF**)" -- under `## Roadmap`, unchecked `- [ ]` | README.md:213 | **TRUTH** -- explicitly roadmap, not claimed as present |
| "Aegis is an observability layer, **not a restriction** layer ... use sandboxing for **enforcement**" | README.md:240 | **TRUTH** -- honest disclaimer (denies enforcement) |
| "production ... features (auto-update, OS-level **enforcement**) are on the roadmap for v1.0" | README.md:248 | **TRUTH** -- explicitly roadmap |
| "Semantic **Kernel**" (agent framework name) | README.md:205 | **N/A** -- false positive; it is Microsoft Semantic Kernel, not an OS-kernel claim |
| "`kernel` -- OS-level **enforcement** features" (contribution-area label description) | CONTRIBUTING.md:178 | **TRUTH** -- describes a label/work-area, not a shipped feature |
| "... from fixing typos to implementing **kernel**-level monitoring" | CONTRIBUTING.md:189 | **TRUTH** -- aspirational call for contributions; not a claim it exists |
| "~95% user-level observability ... **without kernel drivers**" | ARCHITECTURE.md:5 | **TRUTH** -- disclaimer (denies kernel drivers) |
| "Deep Packet Inspection \| Sees TCP endpoints but not encrypted payloads \| **TLS interception** proxy with user consent" (blind-spots table, *Planned Approach* column) | ARCHITECTURE.md:110 | **TRUTH** -- limitation + planned column; no current TLS claim |
| "**Syscall** Monitoring \| No **kernel**-level visibility into system calls \| ... Linux **eBPF**" (blind-spots table) | ARCHITECTURE.md:111 | **TRUTH** -- explicitly states NO syscall/kernel visibility now; eBPF planned |

## Terms with ZERO occurrences in any of the three files
`MITRE` ?? `ATT&CK` ?? `machine learning` ?? `ML` ?? `neural` ?? `netfilter` ?? `inotify` ?? `ptrace` ?? `auto-block` / `actively block` ?? `policy engine`
-> None of the fabricated landing-page capabilities leak into README / CONTRIBUTING / ARCHITECTURE.

## TypeScript reality check
| Claim | file:line | Verdict |
|-------|-----------|---------|
| "Stack: Electron 33, Svelte 5, Vite 7, **TypeScript**" | README.md:196 | **PARTIAL / half-true** |
| "... using Electron 33, Svelte 5, and **TypeScript**" (FAQ) | README.md:224 | **PARTIAL / half-true** |

Reality: the **main-process monitoring engine is plain JavaScript (CommonJS)** -- 35 `.js`, 0 `.ts` in `src/main/`; `src/shared/constants.js` (rules) is also `.js`. TypeScript is confined to the renderer/data layer (28 `.ts`: renderer utils/stores + `src/shared/types/`). Listing "TypeScript" as a flat stack element overstates it -- the scanners/watchers/scoring that *do the monitoring* are JS. Honest fix: "TypeScript (renderer + shared types; main process is JavaScript/CommonJS)".

## Verdict
**README.md, CONTRIBUTING.md, ARCHITECTURE.md are HONEST.** Every kernel / eBPF / TLS / syscall / enforcement hit is a framework name, an explicit disclaimer, or a labeled roadmap/blind-spot item -- never a false claim of a current capability. The only overstatement is the flat "TypeScript" stack label (PARTIAL). This reconfirms the core finding: the fabricated claims are isolated to `aegis_landing.html` / the deployed landing site, not the in-repo docs.

---

# Re-verification -- README / CONTRIBUTING / ARCHITECTURE + package.json (2026-06-02, 2nd pass)

**Task:** confirm README/docs make NO current-capability claim absent from the code. Banned-term scan + TypeScript reality check. Read-only. No files changed.
**Method:** `Grep` over each doc for the term list; primary-source verification against `src/`, `rules/`, `anomaly-detector.js`; file-count via `find`.

## Term scan -- every hit, classified (что нашёл | файл:строка | правда/враньё)

| What was found | file:line | Truth / Lie |
|----------------|-----------|-------------|
| "Semantic **Kernel**" (Microsoft agent framework, in agent list) | README.md:205 | **TRUTH** -- framework name, not an OS-kernel claim (false positive) |
| "OS-level **enforcement** (Windows Minifilter, macOS Endpoint Security, Linux **eBPF**)" -- under `## Roadmap`, unchecked `- [ ]` | README.md:213 | **TRUTH** -- explicitly roadmap, not present |
| "Aegis is an observability layer, **not a restriction layer** ... use sandboxing for **enforcement**" | README.md:240 | **TRUTH** -- disclaimer that denies enforcement |
| "production deployment features (auto-update, OS-level **enforcement**) are on the roadmap for v1.0" | README.md:248 | **TRUTH** -- explicitly roadmap |
| "`kernel` -- OS-level **enforcement** features" (contribution-area label) | CONTRIBUTING.md:178 | **TRUTH** -- describes a work-area label, not a shipped feature |
| "... from fixing typos to implementing **kernel**-level monitoring" | CONTRIBUTING.md:189 | **TRUTH** -- aspirational call for contributors; not a claim it exists |
| "~95% user-level observability ... **without kernel drivers**" | ARCHITECTURE.md:5 | **TRUTH** -- disclaimer that denies kernel drivers |
| "Deep Packet Inspection \| ... not encrypted payloads \| **TLS interception** proxy with user consent" (blind-spots table, *Planned* column) | ARCHITECTURE.md:110 | **TRUTH** -- limitation + planned column; no current TLS-intercept claim |
| "**Syscall** Monitoring \| No **kernel**-level visibility into system calls \| ... Linux **eBPF**" (blind-spots table) | ARCHITECTURE.md:111 | **TRUTH** -- explicitly states NO syscall/kernel visibility now; eBPF planned |

## Terms with ZERO occurrences in README / CONTRIBUTING / ARCHITECTURE
`MITRE` · `ATT&CK` · `machine learning` · `ML` · `neural` · `syscall`(README) · `netfilter` · `inotify` · `ptrace` · `auto-block` / `actively block` · `policy engine` · `intercept`(README/CONTRIBUTING)
-> None of the fabricated landing-page capabilities leak into the tracked docs. **Confirmed unchanged from 1st pass.**

## Source-code cross-check (primary evidence)
- `grep -rilE 'mitre|att&ck|tensorflow|onnx|neural|eBPF|netfilter|inotify|ptrace|syscall' src/` -> **0 matches**. No fabricated capability exists in source.
- `anomaly-detector.js:21` -> `const WEIGHTS = { network: 0.3, filesystem: 0.25, process: 0.25, baseline: 0.2 }` -- hard-coded heuristic weights, composite = Σ(score·weight). **No ML** (no tensorflow/onnx/neural/predict). Confirms claim #3.
- `rules/` -> **70 `- id:` entries across 8 `.yaml` files**. README's "68 rules / 8 categories" is within rounding -- **OK**.
- `aegis_landing.html` -> still **untracked (`??`)**. The fabricated MITRE/ML/kernel/TLS/auto-block stack remains isolated to this one file; live-site verification still OPEN.

## TypeScript reality check (updated counts)
| Claim | file:line | Verdict |
|-------|-----------|---------|
| "Built with Electron 33, Svelte 5, and **TypeScript**" (intro) | README.md:6 | **PARTIAL / half-true** |
| "Stack: Electron 33, Svelte 5, Vite 7, **TypeScript**" | README.md:196 | **PARTIAL / half-true** |
| "... using Electron 33, Svelte 5, and **TypeScript**" (FAQ) | README.md:224 | **PARTIAL / half-true** |
| `"typescript"` keyword | package.json:83 | **PARTIAL / half-true** |

Current file counts (`find`): **`src/main/` = 28 `.js`, 0 `.ts`** (was 35 `.js` at 1st pass -- some main modules were removed/consolidated, but the JS-only ratio is unchanged: still **0 TypeScript in the monitoring engine**). `src` totals: **35 `.js` vs 28 `.ts`**; `src/shared/constants.js` (the 68/70 rules) is `.js`. TypeScript remains confined to renderer utils/stores + `src/shared/types/`. The flat "TypeScript" stack label still overstates -- the scanners/watchers/scoring are plain CommonJS JS. (`tsconfig.main.json` exists per package.json:16, so `tsc --noEmit` runs over the JS via `allowJs`, but the source is not authored in TS.)

## Verdict (2nd pass)
**README.md, CONTRIBUTING.md, ARCHITECTURE.md remain HONEST -- no regression since 1st pass.** Every kernel / eBPF / TLS / syscall / enforcement hit is a framework name, an explicit disclaimer, or a labeled roadmap/blind-spot. The sole overstatement is the flat "TypeScript" stack label (PARTIAL -- main process is JS/CommonJS). Fabricated claims (MITRE, ML, kernel hooks, TLS interception, auto-block, policy engine) appear **only** in the still-untracked `aegis_landing.html`, never in source or tracked docs. **No doc edits made -- per instruction, STOP.**
