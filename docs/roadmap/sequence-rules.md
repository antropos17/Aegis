# Sequence rules — `temporal_ordered` correlations keyed on `process.entity_id`

**Status (as of 2026-08-24):** Block 1 implemented. `src/main/sequence-rule-loader.js`,
`tests/main/sequence-rule-loader.test.js`, `tests/fixtures/sequences/`,
`rules/sequences/sequences.yaml` (1 sequence correlation rule, SEQ001, in 1 sequence rule file),
`tests/main/sequence-rules-parity.test.js` and the `sequences.*` counters in `scripts/counts.js`
now exist and are green, and so do `src/main/sequence-engine.js` and
`tests/main/sequence-engine.test.js` — the §2 state machine with the §3 caps and counters, the
`agent-exit` cleanup with `recentlyExited`, the §4 null policy and the §5 detection payload with
weakest-link attribution — now fed by the five §5 taps in `src/main/main.js` and
`src/main/scan-loop.js` (engine init from the loader's rules, `sweep()` once per process tick;
`onDetection` only logs for now). No gate and no emission named in §5–§7 exists yet — the mutation
gate (§6) is prompt 3 of block 2, the audit record / score merge / `sequences` stats block are
block 3 prompt 2 and the second watcher is prompt 3 — so every file path below other than Block
1's, the engine module and the taps is still a target, not a claim. **Block 1 — LANDED. Block 2 —
ENGINE CORE LANDED (§7 prompt 1); CAPS AND PAYLOAD LANDED (prompt 2); the mutation gate still to
come (prompt 3). Block 3 — TAPS AND INIT LANDED (prompt 1); emission (prompt 2) and the
`rules/sequences` watcher (prompt 3) pending.** When a block lands, refresh this header in the same PR
(the lag the `sensor-health-degraded.md` correction records is what a stale status line costs).
**Branch context:** master @ `2e9e37f`; every `file:line` reference below was verified against that
commit on 2026-08-24. Line numbers drift with every edit to the file — treat them as the place to
start reading, and re-verify before an edit that depends on one.
**Date:** 2026-08-24
**Invariant:** a sequence detection is a claim about ORDER inside one process instance. Every state
the engine drops — skipped, expired, evicted, closed on exit, reset — is counted, never silent.

Three blocks of at most three prompts each. Block 1 delivers the rule format and the
`rules/sequences/` loader with its full validation matrix plus the first live rule (SEQ001) — with
no engine and no consumer, on the ecs-normalizer precedent (PR #294, landed before anything called
it). Block 2 is the pure FSM engine under a mutation gate. Block 3 wires the engine into the scan
pipeline and emits detections through the existing audit/alert path.

---

## 1. Rule format — the accepted subset of Sigma correlations

Files: `rules/sequences/*.yaml` and `*.yml`, multi-document YAML (`---`): base detection
documents plus one or more correlation documents; every base document must be referenced by a
correlation in the same file. The existing gates are untouched by the new directory:
`rule-loader.js:100` reads only the top level of `rules/` (`readdirSync` without `recursive`, filtered
on `.yaml`/`.yml`, so a directory entry named `sequences` never passes); the 8-file parity baseline
(`tests/main/rule-loader-yaml-parity.test.js:85–88`) applies the same filter; `deriveRules()`
(`scripts/counts.js:166–167`) counts through `trackedTopLevel` (`:68–77`, one level deep only).

**Base document** — ONLY these keys are accepted: `title` (optional); `name` (required,
`^[a-z0-9_]+$`, the reference key); `id` (optional); `logsource` (required): exactly
`product: aegis` plus `category: file|network|process`; `detection` (required): exactly one named
selection plus `condition: <that name>`. A selection is a map of `field: value` pairs (AND); a value
is a scalar or a list (OR). Modifiers: `contains`, `startswith`, `endswith`, `re`, `re|i` — nothing
else. Field names are a closed dictionary taken from `docs/ECS-MAPPING.md` §4, per
`logsource.category`:

- **file**: `event.action` (`file-created` | `file-modified` | `file-deleted` | `file-accessed` |
  `file-handle-held`), `event.type`, `file.path`, `process.working_directory`, `process.pid`,
  `aegis.agent.name`, `aegis.attribution.status`;
- **network**: `destination.ip`, `destination.port`, `destination.domain`,
  `process.working_directory`, `aegis.agent.name`;
- **process**: `event.action` (`agent-enter` | `agent-exit`), `process.name`, `process.pid`,
  `aegis.agent.name`.

Internal fields the normalizer does not map (`sensitive`, `reason`, `verdict`, `severity` —
ECS-MAPPING §6) are not available: "a sensitive file" is expressed as a regex over `file.path`.
`process.entity_id` is forbidden inside a selection — it is reserved for `group-by`.

**Correlation document**: `title` (required); `id` (required, `^SEQ[0-9]{3}$` — a documented
departure from Sigma's UUID, so the id can serve as the stats key and the audit `action`); `level`
(optional, `informational` … `critical`, default `medium`); `status` / `description` (optional);
`correlation`: `type: temporal_ordered` (the only accepted type), `rules` — 2 to 5 names from THIS
file, `group-by` — exactly `[process.entity_id]`, `timespan` — `^[0-9]+[smhd]$`, bounded to 1s–24h.
Sigma v2.1.0 calls the window `timespan`; the task brief called it maxspan (the EQL term). The YAML
keeps `timespan`; the semantics are the same.

**Example** — `rules/sequences/sequences.yaml`:

```yaml
title: Credential file read
name: cred_file_read
logsource:
  product: aegis
  category: file
detection:
  selection:
    event.action:
      - file-accessed
      - file-handle-held
    file.path|re|i: '[\\/](?:[^\\/]*[._\d-])?(?:passwords?|credentials?)[^\\/]*$'
  condition: selection
---
title: Outbound network connection
name: outbound_conn
logsource:
  product: aegis
  category: network
detection:
  selection:
    destination.port:
      - 443
      - 80
  condition: selection
---
title: Credential file read followed by outbound connection
id: SEQ001
level: high
correlation:
  type: temporal_ordered
  rules:
    - cred_file_read
    - outbound_conn
  group-by:
    - process.entity_id
  timespan: 5m
```

SEQ001's network step matches ANY destination on port 443 or 80 — including the agent's own API
host, which every agent talks to continuously — and negation (`not`, a `filter` selection,
`condition: selection and not filter`) is outside the accepted subset, so noise from this rule is
expected in v1 and is not a defect of the engine.

**Rejected with a load error** (the whole file is skipped; one
`logger.warn('sequence-loader', message, { rule, step, reason })` line per cause, plus the
`loadErrors` counter in stats): `type` other than `temporal_ordered` (`event_count`, `value_count`,
`value_sum`, `value_avg`, `value_percentile`, `temporal` — "not supported"); `group-by` other than
`[process.entity_id]`; `aliases`; a `condition` inside the correlation; `generate`; a correlation
that references another correlation (chains); a reference to a name outside the file, or one that
does not resolve; `rules` shorter than 2 or longer than 5; an unknown ECS field (the message names
the field and points at `docs/ECS-MAPPING.md`); an unsupported modifier; an invalid regex; a
wildcard `*` / `?` in an unmodified value ("use |contains or |re"); a `timespan` outside the grammar
or the bounds; a base document nothing references; a duplicate `name` or `id`; an unsatisfiable
selection (a field the `logsource.category` never produces — e.g. `destination.ip` under `file`); a
step that provably observes only events without an entity id (§4).

**A warning, not an error**: two adjacent steps that resolve to the same file document.
`dedupFileEvent` (`src/main/scan-loop.js:69–93`) suppresses repeats of `instanceId|file` for 30 s,
so such a rule fires only on two DIFFERENT paths inside the window — the loader tells the author so
in one line.

## 2. FSM

Module `src/main/sequence-engine.js` (CJS, on the baselines / anomaly-detector pattern). State:
`Map<ruleId, Map<instanceId, OpenSeq>>`, `OpenSeq = { stepIndex, openedAt, evidence[] }` — EXACTLY
one open sequence per (rule, instanceId). Ingest projects the carrier through `normalizeToEcs`
(the first production consumer; the role is written into `src/shared/ecs-normalizer.js:12`) inside a
`try/catch`: the normalizer throws a `TypeError` on an unrecognised shape (`ecs-normalizer.js:19`),
and the engine counts that (`stats.ingestErrors`) and writes a rate-limited warn but never lets the
exception reach the scan cycle. The key is `carrier.instanceId` verbatim (= `process.entity_id`,
never parsed — ai-mistakes #19).

Clock: one scale, `observedAt = now()` at ingest (`now` is injected — the test seam). A
`NetworkConnection` carries no timestamp at all (ECS-MAPPING §5) and a file event carries the
`Date.now()` of its emission; the two scales are never mixed, so the window and the order are both
computed on ingest time. Order = arrival order: every tap is synchronous (`handleWatcherEvent` /
`onFileEvent` contain no `await`; the entered/exited loops run under the C-02 re-entrancy guard) and
ingest is atomic. A negative elapsed (clock jump) is treated as 0 — there is no early expiry. The
module header states the resolution: scan cadences of 10 s / 30 s plus chokidar's 2 s per-path
debounce mean a meaningful `timespan` starts at about 60 s; a shorter window can invert the
file → network order and fail to fire.

Transitions on an event with key K under rule R — the check order is fixed and covered by tests:

1. state exists and `observedAt − openedAt > timespanMs` → discard (`expired++`); the state is then
   treated as absent;
2. state exists and the event matches `step[stepIndex]` → advance (`evidence.push`); on the last
   step with `elapsed ≤ timespanMs` (boundary inclusive) → emit + delete (`completed++`). Advance
   takes priority over 3–4; one event satisfies exactly one step and never re-opens a sequence after
   its own completion;
3. state exists, `stepIndex == 1`, and the event matches `step[0]` → slide (`openedAt`,
   `evidence[0]` and the actor are replaced, `slid++`) — widens the window at no memory cost. At
   `stepIndex ≥ 2` a repeated `step[0]` is ignored (`retriggerIgnored++`); the residual miss is
   "A₁ B₁ A₂ B₂ C under `[A, B, C]`, A₁'s window expired before C but A₂ + B₂ + C would have fit" —
   A₂ arrives past step 1 and cannot widen the window. It is a declared v1 bound and is pinned by
   a test, as is the shape that DOES fire: "A₁ A₂ B C" slides at A₂ and A₁'s expiry stops
   mattering (#310; ai-mistakes #27: write the guarantee, not the impression);
4. no state and the event matches `step[0]` → open, subject to the caps (§3), `opened++`.

`agent-exit` is first evaluated as a step (it can complete a rule whose last step is the exit),
then closes every open state for that instanceId across all rules (`closedOnExit++`) and puts the
key into `recentlyExited: Map<instanceId, expiresAt>` (TTL 60 s, cleared by sweep). The hole this
closes: `doFileScan` / `doHotReadScan` are async, so a late handle-scan result for an already-dead
instanceId can arrive AFTER the exit and open an orphan; an open for a key in `recentlyExited` is
skipped and counted (`lateAfterExit++`). `sweep()` is called once per process tick from scan-loop —
it removes expired states and expired `recentlyExited` entries, so memory does not wait for the
next event of the same key.

Lifecycle: in-memory only, for the life of the process; a state is destroyed on completion /
expiry / eviction / agent-exit / hot-reload of the sequence rules (`reset`, `reloadDiscarded++`) /
application exit. An AEGIS restart drops every open sequence — a declared bound. All three key
value spaces are accepted; `<pid>:u` (the linux/darwin steady state) is pid-reuse-unsafe over long
windows — the 24 h cap bounds the damage; the `attachModels` pid-0 synthetics carry
`instanceId: null` even with confirmed attribution (`src/shared/types/events.ts:74–76`) and fall
under the null policy — both facts go into the module header.

## 3. Bounded memory

`MAX_OPEN_PER_RULE = 128`, `MAX_OPEN_TOTAL = 1024`. A slot under a rule is held by a DISTINCT
instanceId — one instance holds at most one slot per rule by construction, so a "noisy" instance
cannot starve the others (the starvation attack is rejected by design and pinned by a test). Groups
per rule ≤ live instances (usually under 50 against a database of 110 agent types); an `OpenSeq` is
O(steps ≤ 5) fixed fields, with the path in evidence truncated to 256 characters ⇒ worst case
under 2 MB.

When a cap is reached: first a micro-sweep of the affected rule's map (of every map, for the total
cap) — expired states leave as `expired` instead of taking quota from live ones (the hole this
closes: between logical expiry and the 10 s sweep, dead states occupied slots); if the cap is still
reached after that, the state with the oldest `openedAt` (the one nearest expiry) is evicted,
`evicted++` per rule and globally, plus a rate-limited warn (once a minute per rule). Empty inner
Maps are deleted; stats is a fixed set of counters keyed only by loaded ruleIds.

Counters, per rule plus global aggregates: `opened, completed, expired, evicted, slid,
retriggerIgnored, closedOnExit, lateAfterExit, reloadDiscarded, loadErrors, ingestErrors,
skippedNullInstanceId` (global), gauges `openNow`, `peakOpen`.

## 4. Null-instanceId policy

Runtime: ingest checks `carrier.instanceId` before anything else; `null` ⇒
`skippedNullInstanceId++`, and the event takes part in neither opening nor advancing —
deterministic, counted, never silent.

Load time, two levels:

1. **Hard error** (file rejected): a step that can match ONLY events without a key — a selection on
   `aegis.attribution.status: unattributed` (C-01: unattributed ⇒ `readInstanceId(null)` ⇒ null,
   `src/main/file-watcher.js:507/523`) — "step can only match events without process.entity_id; a
   temporal_ordered rule grouped by process.entity_id can never fire".
2. **Structural warning** (rule loads): for every rule with steps over file / network — where
   `instanceId` is nullable under Event Schema v1 (`src/shared/types/events.ts:83` `FileEvent`,
   `:147` `NetworkConnection`) — one line: unattributed events on those steps are skipped and counted
   in `stats.sequences.skippedNullInstanceId`. Steps over process always carry the key
   (`src/main/session-tracker.js:168` skips agents without one) — no warning.

## 5. Integration points

Taps — the live carrier, after the existing dedup, next to the baselines / audit calls already
standing there (numbers: function declaration / insertion point):

1. `src/main/main.js` `onFileEvent` `:556–574` — chokidar events, after `dedupFileEvent`;
2. `src/main/scan-loop.js` `doFileScan` (`:647`, insertion ~`:667–671`) and `doHotReadScan`
   (`:695`, insertion ~`:709–716`) — handle / Restart Manager events;
3. `src/main/scan-loop.js` `doNetworkScan` (`:191`, insertion ~`:234–240` beside
   `recordNetworkEndpoint`) — per connection;
4. `src/main/scan-loop.js` `doProcessScan` entered / exited loops `:419` / `:436` — session records
   (the normalizer tells enter from exit by `lastSeen`);
5. in the same tick, once — `sequenceEngine.sweep()`.

Emission: `init({ rules, onDetection, now })` in `main.js`; `onDetection` writes
`audit.log('sequence-detection', …)` on the event, without waiting for a tick. The record:
`agent` / `pid` / `instanceId` from the first step's evidence, `action: ruleId`, `severity` from
`level`, `attribution: { status, evidence }` — status by the weakest link (every step confirmed ⇒
confirmed, otherwise inferred; steps with `attribution: null` — enter / exit — are neutral),
evidence — the union of the steps' codes; `extra: { ruleId, title, timespan, steps: [{ step, at,
action, path, attribution }] }` — the attribution evidence of every step. Companion edits:
`'sequence-detection'` in the `AuditEventType` union (`src/shared/types/events.ts:197–205`, additive
— no exhaustive narrowing over that union exists in the code); a categorization row in
`ecs-normalizer.js` on the `anomaly-alert` model (`:89–90`):
`{ kind: 'alert', categories: ['intrusion_detection'], type: 'info', action: 'sequence-detection' }`
plus a row in `docs/ECS-MAPPING.md` (the module is primary, the document follows — that is the
document's own contract).

Visibility on the alert path, **zero new IPC channels**: (a) scan-loop, when assembling scores
(`:505–510`), merges `Math.max(current, sequenceEngine.scoreFor(instanceId))`; level → score:
critical 90 / high 70 / medium 55 / low 30, held for 10 minutes after the last detection; the toast
fires by itself (`src/renderer/lib/utils/anomaly-toast-tracker.ts:51`, threshold 50) and
`src/renderer/lib/stores/risk.ts:219` picks it up by instanceId; (b) a `sequences` block (the §3
counters) in `getStats()` (`main.js:294`) — rides the existing `stats-update` / `scan-batch`
pushes. Timeline is untouched: `AUDIT_EVENT_TYPES` (`timeline-utils.ts:110`) does not show
`anomaly-alert` either — parity with it; extending the UI is outside this task.

Hot-reload: `setupRulesWatcher` (`src/main/file-watcher.js:1057`) stays as it is (`depth: 0`,
`:1064`); a SECOND chokidar watcher on `rules/sequences` is added (function-form `ignored` with the
same `_`-prefix convention, `depth: 0`) — only that one reloads the sequence loader and calls
`sequenceEngine.reset('reload')`, so an edit to a flat rule file does not drop open sequences (the
hole this closes). The push stays `rules:reloaded`, with one additive field:
`{ count, file, sequenceCount }` from both watchers — otherwise a sequence reload would hand the
renderer `count: 73` with no sequence figure.

counts:check: `scripts/counts.js` gains the derived `sequences.total` / `sequences.files` (tracked
under `rules/sequences`) and `seqGate.mutants` (a locate + parse scanner on the `verify-gate-mutants`
model, `counts.js:476–484`), in the same prompts that introduce the rule file and the gate, together
with the prose declarations (ai-mistakes #24).

## 6. Test strategy

**Loader** (`tests/main/sequence-rule-loader.test.js`, fixtures under `tests/fixtures/sequences/`):
acceptance of the canonical example (`.yaml` and `.yml`); table-driven rejection for every cause in
§1, asserting the exact message and a zero contribution from the file; the warning for adjacent
identical file steps; a parity test on the `rule-loader-yaml-parity.test.js` convention — every `re`
pattern reaches the `RegExp` byte for byte as written in the YAML, flags pinned.

**Engine** (`tests/main/sequence-engine.test.js`, injected clock on the `_setPlatformForTest` /
fake-timers pattern of `tests/main/process-utils.test.js:83–91`):

- order: A→B fires; B→A does not; A→X→B fires; one event ≠ two steps (a rule `[A, A]` needs two
  events); advance beats open; completion does not re-open;
- maxspan boundary: exactly `timespan` — fires; +1 ms — expired, and the same B opens nothing; after
  expiry a new A opens again; sweep removes an idle state;
- group-by isolation: A(i1) A(i2) B(i1) B(i2) — two detections with separate evidence; A(i1) + B(i2)
  — none; one instance never holds more than one slot per rule;
- slide at `stepIndex 1`; the three-step residual miss pinned as known behaviour;
- memory / lifecycle: evict-expired-first, then oldest, on the per-rule and total caps (stats);
  agent-exit cleanup; `lateAfterExit` on a late open; reload reset; the null skip counted;
  `ingestErrors` on an unrecognised carrier with no exception escaping;
- payload: the evidence shape, weakest-link attribution (confirmed + inferred ⇒ inferred, null steps
  neutral).

**Integration** (`tests/main/sequence-integration.test.js`): loader fixtures + engine + a mocked
audit; carriers pushed through the real tap signatures; asserts the full `sequence-detection`
record and the score surface.

**Mutation check**: `scripts/verify-sequence-gate.mjs` on the `verify-witness-gate.mjs` model
(mutant copies in `src/main/.mutants/`, env `AEGIS_SEQ_UNDER_TEST`, refusal to report without an
override-aware suite — "refuse rather than annotate"); the override-aware suite
`tests/main/sequence-engine-gate.test.js` (import through the env variable as in
`tests/main/process-utils-witness.test.js:10–12`). Four mutants = four properties: m1 — order check
removed (a match is accepted at any index); m2 — expiry comparison removed; m3 — group key collapsed
to ruleId; m4 — caps removed. What the mutants prove is exactly the order, maxspan-boundary,
group-by-isolation and eviction tests. npm script `verify:seq-gate` — a step of the existing `test`
job in `ci.yml` (beside `:56` / `:63` / `:70`; no new status context).

## 7. Blocks — each at most 3 prompts, each merged green on its own

**Block 1 — format and loader** (2 prompts). (1) `src/main/sequence-rule-loader.js` with the §1
validation matrix + fixtures + accept / reject / warn tests + the module on the coverage list in
`vitest.config.js`. (2) `rules/sequences/sequences.yaml` with SEQ001 + the parity test + the
`sequences.*` counters in `counts.js` + the prose declarations in the same prompt. All 9 gates
green: `checkJs: false` means a new `.js` file is not type-checked, and neither the parity baseline
nor `deriveRules` sees the subdirectory.

**Block 2 — FSM engine** (3 prompts). (1) `sequence-engine.js`: ingest with the error boundary /
advance / slide / expiry / sweep / complete + the clock seam + the order, boundary and isolation
tests. (2) Caps, evict-expired-first, eviction, exit cleanup + `recentlyExited`, reset, null skip,
stats, payload and attribution + tests; the module on the coverage list. (3)
`verify-sequence-gate.mjs` + the gate suite + the npm script + the `ci.yml` step + `seqGate.mutants`
in `counts.js`. An engine with no production caller is green.

**Block 3 — wiring and emission** (3 prompts). (1) The five taps + engine init from the loader's
rules + sweep in the tick. (2) `onDetection → audit.log` + the union in `src/shared/types/events.ts`
+ the categorization row in `ecs-normalizer.js` + the row in `ECS-MAPPING.md` + the score merge +
the `sequences` block in `getStats()`. (3) The second watcher on `rules/sequences` with the engine
reset and `sequenceCount` in `rules:reloaded` + the end-to-end integration test. (The
`memory-bank/progress.md` entry is the repository's merge convention, not a deliverable of the
prompt.)

No open question changes the build: the contested points — the field name `timespan`, a new audit
type instead of reusing `anomaly-alert`, the score merge as the visibility path — are decided above
with their reasons.
