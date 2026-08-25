# Audit index — a rebuildable SQLite projection over the hash-chained JSONL

**Status (as of 2026-08-25): block 1 BUILT — the engine gate, the schema, the writer that projects
JSONL lines into the index at flush time, and the rebuild-from-JSONL path, on
`feat/audit-index-block-1` (§12 records what landed, where it deviates from §3, and the PR).
Block 2 — the read path, `getEntriesBefore` dispatch, the fallback suite, the bench — is NOT
started; §3.3, §5, §6, §8 tests 3/4/9 and M1/M4/M5 describe it.** Before block 1: UNBLOCKED —
Electron 43.4.1 (Node 24.18.1, `node:sqlite` Stability 1.2) merged to master on 2026-08-25 in #334.
The record of the block, as it was written: the engine this plan chooses is
`node:sqlite`, and the Node that ships inside the pinned Electron does not have it: `electron@33.4.11`
(`node_modules/electron/package.json`) bundles **Node 20.18.3**
(<https://releases.electronjs.org/release/v33.4.11>); the Node 20.x API index lists no SQLite module
(<https://nodejs.org/docs/latest-v20.x/api/index.html>); `node:sqlite` was added in Node 22.5.0 and
unflagged in 22.13.0 (<https://nodejs.org/docs/latest-v22.x/api/sqlite.html>). The first Electron
that carries it is 35 (Node 22.14.0, <https://releases.electronjs.org/release/v35.0.0>); the
supported line today is 42 (Node 24.15.0) and 43 (Node 24.17.0), where the module is Stability 1.2
Release Candidate (<https://nodejs.org/docs/latest-v24.x/api/sqlite.html>); Electron 33 has been
end-of-life since 2025-04-29 (<https://endoflife.date/api/electron.json>). **Order of work: an Electron
upgrade block lands first, this index after it.** A capability-gated module that never fires in the
shipped app is dead code by this repository's rules (`memory-bank/ai-mistakes.md` #14), so the plan
below is not started until `process.versions.node` inside the packaged app resolves `node:sqlite`.
This header was refreshed in the upgrade PR, #334 (the lag `sensor-health-degraded.md`
records is what a stale status line costs).
**Branch context:** §1–§11 were verified against master @ `d1a80f8` (#323) on 2026-08-25 — BEFORE
#331 and block 1 both moved `src/main/audit-logger.js`, so every `audit-logger.js:NNN` in §1, §3
and §7 is off by tens of lines (`flush()` now sits past `:320`, the init seam that schedules
`cleanOldLogs` past `:140`). §12 is against `f7bd134` (#334) plus block 1 itself. Line numbers
drift with every edit — treat them as the place to start reading, and re-verify before an edit
that depends on one.
**Date:** 2026-08-25
**§11 follow-ups:** landed 2026-08-25, ahead of the index — the JSONL read path now filters by
`types` and opens the D+1 file. Where §3 says "the existing JSONL code, unchanged", it means that
code as it stands after them.
**Invariant:** the daily JSONL is the only source of truth. The index is a projection that can be
thrown away and rebuilt from it at any time; a missing or corrupt index is the current JSONL read
path with no behaviour change; the hash chain is never verified against the index.

The plan was drafted read-only against the tree and the primary sources linked above; nothing under
`src/`, `tests/` or `scripts/` was touched by it. Recon that motivated it:
`docs/recon/EXTERNAL-TECHNIQUES.md` §7 (rebuild-from-canonical discipline; "if we write only to
SQLite, we lose the hash chain") and `memory-bank/RESEARCH-BASELINE.md` §11 and §13 ("JSONL stays
canon; the tree is derived, like the planned SQLite index").

---

## 1. Readers of the JSONL today

Write path, for orientation: `log()` → buffer → `flush()` (`src/main/audit-logger.js:295-361`) —
`appendFileSync` of `JSON.stringify({...e, seq, hash})` lines into
`userData/audit-logs/aegis-audit-YYYY-MM-DD.json`; one chain per daily file; `seq` is the line
ordinal (`audit-hashchain.js:106` checks `entry.seq !== i`); retention 30 days (`cleanOldLogs`,
`audit-logger.js:368-391`).

| Reader | Channel / call | Query shape |
|---|---|---|
| `get-audit-entries-before` (`src/main/ipc-handlers.js`) → `getEntriesBefore(beforeTs, limit, types)` (`audit-logger.js`) | `preload.js` → `Timeline.svelte` `loadOlderHistory`, `HISTORY_BATCH = 25` (`timeline-utils.ts:37`), which passes `AUDIT_EVENT_TYPES` as `types` | `timestamp < beforeTs` as a STRING comparison of ISO text; `limit` clamped to [1, `MAX_READ_LIMIT`], default 100; `types` normalised by `_typeFilter` (not an array or empty → no filter; non-strings and names over 64 characters dropped; the first 16 kept) and applied WHILE reading, so a page holds `limit` MATCHING entries; `buffer-overflow-drop` markers excluded; v0 records widened by `normalizeAuditEntry`; files walked newest-first and a file dated after the day FOLLOWING the cursor's UTC date is skipped (`_nextDateStr` — the D+1 rule, §11); inside a file `readLinesReverse` in 4 KB chunks with `JSON.parse` per line. Cost: O(lines after the cursor in that file), plus one full reverse read of the D+1 file when it exists (~12 ms measured for a 7.3k-line day, §11). |
| `get-audit-stats` (`ipc-handlers.js:271`) → `getStats()` (`:418-456`) | `AuditLog.svelte:10-31`; type `stores/ipc.ts:143` | In-memory counters seeded by a full read of every file at `init` (`_seedCounters`, `:129-170`), plus `readdir`/`stat` per call. |
| `export-full-audit` (`ipc-handlers.js:280-296`) and `export-zip` (`:361-389`) → `exportAll()` (`:469-494`) | `AuditLog.svelte:92`, `App.svelte:288` | Every file, every line, RAW — markers included. The forensic path. |
| `seedFromTail` (`audit-hashchain.js:132-150`) | from `flush()` after a restart or a day rollover | reads the whole of today's file for its last line. |
| `verifyChain` (`audit-hashchain.js:90-122`) | exported by `audit-logger`; no production caller under `src/` (tests only — EXTERNAL-TECHNIQUES §1.4 says the same) | line by line, whole file. |

Not readers, so nobody mistakes them for one: `exports.js` (`exportLog` / `exportCsv` /
`generateReport`) works off the in-memory `activityLog` (`exports.js:119, 148, 181`), never off the
JSONL.

---

## 2. Engine — evidence and decision

**Decision: `node:sqlite` (`DatabaseSync`), resolved at runtime by `require('node:sqlite')` in a
`try/catch`; `better-sqlite3` rejected.** Reasons, each with the evidence that was read:

- **What is actually inside Electron.** See the status header: Node 20.18.3 in Electron 33, no
  `node:sqlite` there at all. Node per Electron major, from the release pages on
  releases.electronjs.org: 35 and 36 → 22.14.0, 38 → 22.18.0, 40 → 24.11.1, 41 → 24.14.0,
  42 → 24.15.0, 43 → 24.17.0. In the Node 22 line the module is Stability 1.1 "Active development";
  from Node 24.15.0 it is 1.2 "Release candidate". CI already runs on Node 22
  (`.github/workflows/ci.yml:16`, `setup-node` `'22'`), so vitest sees `node:sqlite` today and the
  tests can run before the upgrade — the APP cannot, which is why the block is ordered after it.
- **`better-sqlite3` 13.0.3** (published 2026-08-05): Node-API, eight prebuilt `.node` files inside
  the npm tarball (`prebuilds/win32-x64.node` 1.9 MB; 27 MB unpacked, with `binding.gyp`,
  `deps/sqlite3/sqlite3.c` at 9.5 MB and the C++ sources —
  <https://unpkg.com/better-sqlite3@13.0.3/?meta>), `engines.node >= 22`, one dependency
  (`node-addon-api ^8`) (<https://registry.npmjs.org/better-sqlite3/13.0.3>). Its GitHub releases
  carry no assets since 13.0.0; the 12.x line (last 12.12.0, 2026-07-15) shipped 56+ per-ABI tarballs
  (`electron-v121`, `-v132`, `-v135` name patterns) and an `electron-v130` asset — the ABI of
  Electron 33 — was NOT confirmed. Costs, stated per surface:
  - **Canon:** `memory-bank/RESEARCH-BASELINE.md` §3 — "no native in-process module inside Electron
    main" — a hard constraint, and this is exactly such a module.
  - **Windows build:** `electron-builder`'s `npmRebuild` defaults to `true`
    (<https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/configuration.ts>),
    so `npx electron-builder --win` in `.github/workflows/release-build.yml:65` would try to rebuild a
    module that ships `binding.gyp` against the Electron ABI on `windows-latest` (MSVC; `node-gyp`
    11.5.0 is already in the lockfile transitively). That needs either `npmRebuild: false` plus proof
    the Node-API prebuilt loads under Electron, or an `asarUnpack` entry — and on Electron 33 the
    13.x line refuses to install at all by `engines`.
  - **`npm audit`:** one more production dependency (plus `node-addon-api`) inside the perimeter of
    `npm audit --audit-level=high --omit=dev` (`ci.yml:96`). `node:sqlite` adds nothing there.
- **WASM alternatives** — `sql.js` 1.14.2 (no dependencies; the whole database lives in memory and is
  written back with an explicit `export()`) and `node-sqlite3-wasm` 0.8.60 (file-backed) — would
  work on Electron 33 today. Rejected as the primary: a production dependency and a second SQLite
  build in the audit perimeter, for an engine the runtime provides after the upgrade. Kept as the
  fallback named in open question 1.
- **Cost of `node:sqlite` on the Windows build and on `npm audit`: none.** No dependency, nothing to
  rebuild, nothing to unpack from asar.
- **One thing to know:** in Node 22 the first `require('node:sqlite')` prints
  `ExperimentalWarning: SQLite is an experimental feature and might change at any time`
  (<https://github.com/nodejs/node/issues/58611>). Whether the warning survives the Release
  Candidate status of Node 24.15+ was not verified.

---

## 3. Index contract

1. **JSONL is written first and is canon.** Inside `flush()` the index receives the SAME `out`
   strings that `appendFileSync` just wrote, strictly after that call succeeds and after
   `_prevHash` / `_seq` / `_chainDate` advance — inside the index's own `try/catch`. A failing index
   never touches the write, the counters or `onFlushError`.
2. **Rebuildable from JSONL at any time.** `rebuild()` = drop both tables, stream every
   `aegis-audit-*.json` line by line, INSERT in batched transactions. Row identity is
   `(file, line_no)` — the ordinal of the non-empty line, the same quantity `verifyChain` calls
   `seq` — never the `seq` field read out of the record.
3. **Missing or corrupt index = today's behaviour.** `getEntriesBefore` stays the single place that
   validates `beforeTs` and `limit` (`:564-575`) and then dispatches: `index.isReady()` → SQL;
   otherwise, and on ANY throw out of the SQL path, the existing JSONL code, unchanged, in the same
   call. An open error or `PRAGMA quick_check` not answering `ok` → close, unlink `.sqlite` +
   `-wal` + `-shm`, schedule a rebuild on `setImmediate`; until it finishes, JSONL.
4. **The hash chain is never verified against the index — structurally.** The schema has NO
   `hash` and NO `prev_hash` column (test 12 pins it through `PRAGMA table_info`). `verifyChain` and
   `exportAll` keep reading the file.
5. **Rebuild / reconcile triggers:** database file absent; `PRAGMA user_version !=
   AUDIT_INDEX_SCHEMA_VERSION`; `quick_check` not `ok`; and at every `init`, on `setImmediate` after
   `cleanOldLogs` (the seam at `audit-logger.js:122`), a reconcile of `audit_files` against the
   directory — a file on disk with no row → index it; a row with no file (retention) → delete its
   rows; a file smaller than recorded, or with a changed prefix → full re-index of that file.
6. **A partially indexed file is resumed, not restarted.** `audit_files(file, indexed_bytes,
   indexed_lines)` is updated in the SAME transaction as the rows it accounts for, so a crash mid-batch
   leaves it exact. Resume: `seek(indexed_bytes)`; the byte at `indexed_bytes - 1` must be `\n`, and
   the `seq` of the first new line (when it carries one) must equal `indexed_lines`; either check
   failing → full re-index of that file. The live `append` from `flush()` runs the same continuity
   check (`firstSeq === indexed_lines`); a mismatch marks the file stale → JSONL until reconcile.
7. **Location and mode:** `userData/audit-index/audit-index.sqlite`, `journal_mode = WAL`,
   `synchronous = NORMAL`. A directory of its own, so `open-audit-log-dir`, `export-full-audit` and
   `export-zip` keep seeing the JSONL alone. Opened lazily from `audit-logger.init({ userDataPath })` —
   `main.js:761-764` is not touched.

---

## 4. Schema

Two tables, no FTS (EXTERNAL-TECHNIQUES §7.2 is a later, separate step). Column names are the ECS
paths of `docs/ECS-MAPPING.md` §4 with `.` → `_`, and their VALUES follow the rules
`src/shared/ecs-normalizer.js` already enforces — so a later bench replay queries the names it
already knows and no second naming is born. Internal fields that ECS-MAPPING §6 lists as "carried,
not mapped" keep their internal name.

```sql
PRAGMA user_version = 1;                       -- AUDIT_INDEX_SCHEMA_VERSION; not the record's SCHEMA_VERSION
CREATE TABLE audit_files (
  file            TEXT PRIMARY KEY,            -- aegis-audit-YYYY-MM-DD.json
  file_date       TEXT    NOT NULL,
  indexed_bytes   INTEGER NOT NULL,
  indexed_lines   INTEGER NOT NULL,            -- = the next expected seq
  size_bytes      INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  malformed_lines INTEGER NOT NULL DEFAULT 0   -- lines JSON.parse rejected: counted, not stored
);
CREATE TABLE audit_events (
  file                     TEXT    NOT NULL REFERENCES audit_files(file) ON DELETE CASCADE,
  line_no                  INTEGER NOT NULL,   -- identity; the record's own seq is not trusted for it
  seq                      INTEGER,            -- as written; NULL on a line without a chain
  timestamp                TEXT    NOT NULL,   -- @timestamp, ISO text as on disk (text compare = today's)
  type                     TEXT    NOT NULL,   -- the internal discriminator; what the renderer filters on
  event_kind               TEXT,               -- event.kind       } from normalizeToEcs; NULL when the
  event_category           TEXT,               -- event.category   } type is unknown or the
  event_type               TEXT,               -- event.type       } normalizer threw
  event_action             TEXT,               -- event.action ('file-modified', 'network-connection', or the type itself)
  aegis_schema_version     INTEGER,            -- NULL = v0: the ABSENCE of the field is what marks v0, never defaulted
  aegis_agent_name         TEXT,               -- NULL for '' (C-01: the empty string is the unattributed marker)
  process_pid              INTEGER,            -- only a safe integer > 0; pid 0 and null → NULL (ECS-MAPPING §4)
  process_entity_id        TEXT,               -- instanceId verbatim
  file_path                TEXT,               -- file.path for file-access / config-access only; NULL for network
  aegis_attribution_status TEXT,               -- NULL when attribution is null
  action                   TEXT    NOT NULL DEFAULT '',        -- carried, not mapped (§6)
  severity                 TEXT    NOT NULL DEFAULT 'normal',  -- carried, not mapped (§6)
  raw                      TEXT    NOT NULL,   -- the line as on disk; the answer is built from it
  PRIMARY KEY (file, line_no)
) WITHOUT ROWID;
CREATE INDEX audit_events_ts       ON audit_events(timestamp, file, line_no);
CREATE INDEX audit_events_type_ts  ON audit_events(type, timestamp);
CREATE INDEX audit_events_entity   ON audit_events(process_entity_id, timestamp);
```

- **`buffer-overflow-drop` markers** are ordinary rows with `type = 'buffer-overflow-drop'`,
  `event_action = type` and NULL categorization — the unknown-type branch of `AUDIT_ROUTES`
  (`ecs-normalizer.js:79-111`, `:154`); `droppedCount` / `firstDropTs` / `lastDropTs` stay inside
  `raw` (`json_extract` when needed). Every query adds `AND type != 'buffer-overflow-drop'` — the
  mirror of `audit-logger.js:603`.
- **Pre-v1 records without `schemaVersion`** — `aegis_schema_version IS NULL`
  (`src/shared/types/events.ts:267-278` and the comment above it). `process_pid`,
  `process_entity_id` and `aegis_attribution_status` are taken from the NORMALIZED view
  (`normalizeAuditEntry`); the evidence array is not a column — a v0 record's is `null` ("never
  recorded"), a v1 record's is in `raw`.
- **The answer is `normalizeAuditEntry(JSON.parse(raw))`** — the same object the JSONL path returns,
  by construction; the typed columns exist for WHERE and ORDER only.
- **Order of results:** `ORDER BY timestamp DESC, file DESC, line_no DESC LIMIT ?` — a seek on
  `audit_events_ts`, O(limit). Ordering by `timestamp` rather than file-then-line is what makes the
  rollover straddle a non-event for the index: entries logged before midnight and flushed after it
  sit in the file of day D+1, and the index finds them by timestamp alone. Since 2026-08-25 the
  JSONL path finds them too (the D+1 file rule, §11), so the two paths AGREE on this case — test 9
  pins that agreement, not a divergence.

---

## 5. First channel and what the renderer gains

`get-audit-entries-before` — with no new channel. **The third argument already exists** (landed
2026-08-25 ahead of the index, §11): `ipcRenderer.invoke('get-audit-entries-before', beforeTs, limit,
types)` (`preload.js`, the same call, so `ipc.invoke` and `ipc.total` in `scripts/counts.js` did not
move); `ipc-handlers.js` passes it through; `Timeline.svelte` sends `AUDIT_EVENT_TYPES`;
`AegisIpcBridge` (`stores/ipc.ts`) declares it. Validation lives in `getEntriesBefore` beside the
existing two (`_typeFilter`): not an array, or empty → no filter; non-string entries and names over
64 characters dropped; the first 16 kept; nothing left → no filter. **The JSONL path applies the
filter** (one clause beside the marker exclusion), so behaviour does not depend on whether the index
exists — the index's `queryBefore(beforeTs, limit, types)` must answer the SAME set, which is test 4.

What the renderer gains from the index on top of that: for a cursor deep inside a large daily file,
an O(limit) seek instead of a reverse read of the file's tail with `JSON.parse` on every line — and no
extra read of the D+1 file (§11). `flush()` before the read stays, so buffered entries remain visible
(`tests/main/audit-logger.test.js`, "still flushes buffered entries into view on a valid read").

---

## 6. Measurement plan

`scripts/bench-audit-index.mjs` — not a CI gate (no timing gate lives in CI; `ai-mistakes.md` #36),
its table goes into the PR body:

- **Generator:** eight daily files × 25k lines = 200k lines (~56 MB at the ~280 B/line the buffer
  comment at `audit-logger.js:36-37` implies), REALLY chained through `hashchain.computeHash` so
  `verifyChain` answers valid; mix 70 % `file-access`, 15 % `network-connection`, 5 %
  `config-access`, 5 % `agent-enter` / `agent-exit`, 5 % `anomaly-alert`; ~5 % of lines in the v0
  shape; three markers; one malformed line. The fixture is generated, never committed.
- **Timings** with `process.hrtime.bigint()`, 50 calls each, p50 / p95: `getEntriesBefore` JSONL vs
  index at cursors "file tail", "file middle", "file head", "across a file boundary"; `limit` 25 and
  500; with and without `types`.
- **Rebuild:** wall time and peak RSS (`process.memoryUsage().rss`); resume after an injected stop at
  batch k — row count equals a full build; `append` overhead for a 50-entry batch (must sit far
  below the 5 s `FLUSH_INTERVAL`, and the number is reported, not asserted); database size against
  JSONL size.
- Run on system Node 22 now and inside the packaged Electron after the upgrade; before the upgrade no
  in-app figure exists, and the report says so rather than extrapolating.

---

## 7. Files and estimates

**Add**

- `src/main/audit-index.js` (~260 lines): `_loadSqlite()` (the capability gate: `require('node:sqlite')`
  in `try/catch` → `null`), open / close, schema + `user_version`, `append({ file, firstSeq, lines })`,
  `queryBefore(beforeTs, limit, types)`, `status()` → `{ state: 'unavailable' | 'building' | 'ready'
  | 'failed', rows, lastError }`, corruption handling.
- `src/main/audit-index-rebuild.js` (~180 lines): the streaming line reader, `rebuild()`,
  `reconcile()`, resume from `indexed_bytes`, the projection of a line into columns through
  `normalizeToEcs` + `normalizeAuditEntry` (both pure; `src/shared` and `src/main` respectively).
- `tests/main/audit-index.test.js` (~360 lines) and `tests/main/audit-index-fallback.test.js`
  (~120 lines, module path overridable through `AEGIS_AI_UNDER_TEST` on the pattern of
  `tests/main/sequence-engine-gate.test.js:26-29`, so a scripted gate can be added later without
  rewriting the suite).
- `scripts/bench-audit-index.mjs` (~150 lines).

**Change**

- `src/main/audit-logger.js` (~45 lines): `init` opens the index on `setImmediate` after
  `cleanOldLogs`; `flush` calls `append` after a successful `appendFileSync`; `getEntriesBefore`
  dispatches — the `types` normalisation (`_typeFilter`) and the JSONL-loop clause already exist, so
  the SQL path receives the normalised Set; `cleanOldLogs` calls `index.forget(file)`; `shutdown`
  closes; `getStats` gains an additive `index` field.
- `src/main/ipc-handlers.js`, `src/main/preload.js`, `src/renderer/lib/components/Timeline.svelte`,
  `src/renderer/lib/stores/ipc.ts`: nothing — the third argument, its pass-through and the
  `AegisIpcBridge` declaration landed 2026-08-25 (§11).
- `vitest.config.js:39-72` — both new modules on `coverage.include` (a module missing from that list
  is not measured — the B3 lesson in `memory-bank/progress.md`).
- `tests/main/audit-logger.test.js` (+~30: the dispatcher — the JSONL filter and the D+1 rule are
  already pinned there); `tests/main/ipc-handlers.test.js`: nothing — the registered-channel
  assertion and the three-argument pass-through landed 2026-08-25 (§11).
- Docs: `docs/ECS-MAPPING.md` — a new §8 "Index columns" (column ↔ ECS field, by reference to §4 and
  §6; the module stays the source of truth); `docs/recon/EXTERNAL-TECHNIQUES.md` §7 — "[since recon:
  built]"; `memory-bank/progress.md` — the block entry; this file's status header.

No change to `package.json`, to `main.js`, to `audit-drop-tracker.js` or to `audit-normalize.js`.

---

## 8. Tests and mutations

**`tests/main/audit-index.test.js`** (fixtures written the way `tests/main/audit-logger.test.js:319-331`
and `tests/main/audit-schema-v1.test.js:134-145` already write them):

1. engine unavailable (`_loadSqlite` → `null`) → `state: 'unavailable'`, the answer equals the JSONL
   path's;
2. build from a directory holding v0 lines, markers and a malformed line — per-file counts,
   `aegis_schema_version IS NULL` on v0, `malformed_lines = 1`;
3. parity: 300 records through real `log()` / `flush()` across two days; a grid of cursors × limits —
   `deepEqual` index vs JSONL;
4. `types` filter — identical sets on both paths; an invalid filter → unfiltered; the marker is never
   returned even when asked for by name;
5. live `append`: `count(*)` grows by the batch size; the marker lands; a tampered `indexed_lines` →
   file stale → fallback → reconcile repairs;
6. resume after an injected stop, and a full re-index of a file whose prefix changed;
7. a corrupted database file → removed → rebuilt; during the rebuild the answer comes from JSONL;
8. retention — the rows of a deleted file disappear;
9. the rollover straddle: the index returns day-D records that live in the D+1 file, and its answer
   equals the JSONL path's (the D+1 file rule, §11) — the agreement §4 describes;
10. `process_pid`: 0 → NULL, null → NULL, 1234 → 1234; `process_entity_id` verbatim;
11. ECS columns: `file-access` / `modified` → `event_action = 'file-modified'`,
    `event_category = '["file"]'`; an unknown type → `event_action = type`; a line with no `type` →
    NULLs, still found by timestamp;
12. `PRAGMA table_info` contains neither `hash` nor `prev_hash`;
13. `shutdown` closes the database;
14. `user_version = 0` → reopening rebuilds.

**Mutations** — each applied, the suite run RED, then reverted, the protocol recorded in the PR body
the way the B1–B4 entries in `memory-bank/progress.md` record theirs:

- **M1 — fallback removed:** `getEntriesBefore` calls the index unconditionally instead of
  `isReady()` + `try/catch` → tests 1 and 7 red. This is the proof that the fallback path is
  load-bearing.
- **M2 — index ahead of canon:** `append` moved before `appendFileSync` → the test "rows in the index
  never exceed lines on disk" (with `rmSync(auditDir)` forcing the write to fail) red.
- **M3 — continuity check dropped** → test 5 red.
- **M4 — `types` removed from the JSONL path** → test 4 red, and with it
  `tests/main/audit-logger.test.js` "applies a types filter on the JSONL path" (the same mutation,
  run once already on 2026-08-25 — §11).
- **M5 — `ORDER BY line_no` instead of `timestamp`** → test 9 red.

---

## 9. `counts:check` sites

`scripts/counts.js` derives every counter from the index and compares it with the prose sites it
locates (`:276-443`). What this block moves:

- `main.total` and `main.topLevel` each move up by two (both new files sit directly under
  `src/main/`). Declaration sites: `CLAUDE.md` "Key Paths", `memory-bank/architecture.md` line 3,
  `docs/current-state/CORRECTNESS-AUDIT.md` (the modules row of its table). The copies inside
  `.claude/skills/*/SKILL.md` are untracked and outside the scan.
- `size.over300` does not move while both modules stay under the 300-line target; if one crosses it,
  the counter moves up by one at `CLAUDE.md` rule 3, `AGENTS.md` "Code conventions" and
  `docs/DEVELOPMENT.md` "Conventions".
- `ipc.invoke`, `ipc.push`, `ipc.total`: unchanged (third argument on the same `invoke` line).
- `ci.commands`, `ci.contexts`: unchanged — no new CI step — unless open question 5 chooses the
  scripted gate, which moves `ci.commands` up by one at `CLAUDE.md` and `AGENTS.md` and needs its own
  scanner in `counts.js`.

Counter sites are edited by other work in flight; bump them after those PRs merge, on a fresh master.

---

## 10. Open questions, each with its default

1. **`node:sqlite` is absent from Electron 33.** Default (now the accepted order): the Electron
   upgrade block (33 → 43; 43 is supported to 2027-01-05, Node 24.17 carries the module at Release
   Candidate) lands first, this index after it, so the module fires from its first shipped build.
   The alternative — `node-sqlite3-wasm` to light the index up on Electron 33 today — is rejected:
   a production dependency and a second SQLite build in the audit perimeter.
2. **Does canon §3 "no native in-process module" cover `node:sqlite`?** Default: no — the clause is
   about npm native addons (ABI rebuilds, crash surface); `node:sqlite` is part of the runtime the way
   `fs` and `crypto` are. A literal reading leaves only WASM or a sidecar, which is materially
   different work.
3. **Order by `timestamp` versus the JSONL file order** (rollover straddle, clock steps). Default:
   `timestamp`. On the straddle the two paths agree since 2026-08-25 (§11) and test 9 pins that; what
   this question still decides is a clock step INSIDE a file.
4. **A third argument on the existing channel** versus an untouched channel with the filter left in
   the renderer. Default: extend the channel; the JSONL path honours the filter too.
5. **Mutations by hand (recorded in the PR) versus a scripted `verify:index-gate`** on the model of
   `verify:seq-gate`. Default: by hand; the suite is already override-aware, so the script can come
   later. The script moves `ci.commands` and needs a `counts.js` scanner.
6. **Store `raw`** (parity by construction, roughly double the storage) versus rebuilding the answer
   from columns. Default: `raw`.
7. **An additive `index` field on `get-audit-stats`** with no UI change. Default: yes.
8. **The `ExperimentalWarning`** on `require('node:sqlite')`. Default: accept the one line; do not set
   `--no-warnings` globally.
9. **Where the database lives** — `userData/audit-index/`, separate from `audit-logs/`. Default: yes,
   so the export and the "open log directory" action see canon alone.
10. **`exportAll` and `export-zip` stay on JSONL** (forensic; markers included); the index does not
    serve them. Default: confirmed.

All ten defaults were accepted on 2026-08-25, with the order of question 1 as stated in the header.

---

## 11. Follow-ups — independent of the index

All three landed 2026-08-25 on `fix/audit-history-filter-and-straddle` (the PR number is in the block
entry of `memory-bank/progress.md`), ahead of the index and without waiting for it:

- **Timeline stopped loading history on a batch of 25 unmatched rows.** `loadOlderHistory` fetched
  `HISTORY_BATCH` raw rows, filtered them client-side to the four `AUDIT_EVENT_TYPES`, and read an
  empty MAPPED batch as `historyExhausted` although the JSONL below the cursor held matches — any run
  of 25 `agent-enter`, `agent-exit`, `anomaly-alert` or `sequence-detection` records ended history for
  the session. Fixed server-side, as §5 specifies: the renderer passes `AUDIT_EVENT_TYPES` as the
  third argument and the main process pages until it holds `limit` MATCHING rows; exhaustion is
  decided only by an empty FETCH, and the next cursor is the oldest RAW row returned
  (`historyCursor`), so a batch with nothing to show can never stall or refetch. Chosen over a
  renderer-side retry loop because that loop is partial by construction — any cap leaves a longer
  unmatched run declaring false exhaustion, and no cap means one IPC round trip plus a synchronous
  main-thread reverse read per 25 raw lines. Pinned by `tests/main/audit-logger.test.js` "applies a
  types filter on the JSONL path" (five old `file-access` below 25 newer `agent-enter`, limit 25 →
  the five) and by `tests/renderer/components/Timeline.test.ts` "asks for the timeline event types
  and renders the historical rows that come back" (the third argument equals `AUDIT_EVENT_TYPES`;
  six dots, not one).
- **`get-audit-entries-before` is asserted** among the registered channels in
  `tests/main/ipc-handlers.test.js`, together with the pass-through of all three arguments.
- **The D+1 file rule.** A file is named with the LOCAL date of the flush while a record's timestamp
  is UTC at `log()` time, so a record whose UTC date is D can sit in the file of D+1 — flushed after
  local midnight by the 5 s timer (the case this section first recorded), or, for any zone east of
  UTC, logged between local 00:00 and UTC 00:00: in Baku (UTC+4) that is four hours of every day,
  unreachable from a cursor inside D. Neither this machine (UTC−4) nor CI (UTC) shows the second
  case, which is why only the first was noticed. The two skews do not stack, so the bound is exactly
  one file: `getEntriesBefore` opens every file dated up to `_nextDateStr(cursor UTC date)` and
  relies on the timestamp comparison; files strictly later stay skipped. A cursor whose date passes
  the shape check but is no calendar date (`2026-13-45`) keeps the previous rule instead of reading
  as an empty log. Cost, measured on the real module over the largest daily file on this machine
  (2 334 591 B, 7 286 lines, cursor below every line — the D+1 profile): p50 12.4 ms (11.1–18.9 ms
  over 7 runs) against 1.0 ms for a tail-25 read; the mislaid lines sit at the HEAD of D+1, where a
  reverse read meets them last, which is why it is a full read. What no constant bound covers: a
  batch re-queued by a failing flush and written on a later day — the index (§3, keyed by timestamp)
  is what closes that. Pinned by `tests/main/audit-logger.test.js` "returns a day-D record that
  flush() wrote into the D+1 file".

---

## 12. Block 1 — what landed (2026-08-25, `feat/audit-index-block-1`)

**Scope:** §2 engine, §4 schema, the writer at flush time (§3.1), the rebuild-from-JSONL path
(§3.2, §3.5, §3.6), the capability gate, `getStats().index` (§10 q7). No renderer channel and no
read path: `getEntriesBefore` is untouched and still answers from the JSONL alone.

**Files.** Added `src/main/audit-index.js` (engine gate, DDL, projection, `append`, `writeBatch`,
`forget`, `status`, corruption handling) and `src/main/audit-index-rebuild.js` (streaming reader,
`reconcile`, `schedule`); `src/main/audit-logger.js` gained the seams — `init({ loadSqlite })`,
the deferred `cleanOldLogs` → index open → reconcile in ONE `setImmediate`, `flush` → `append`
after the write, `getStats().index`, `shutdown` → `close`, `_awaitIndexForTest`;
`tests/main/audit-index.test.js`; `vitest.config.js` (`coverage.include`); the `main.total` /
`main.topLevel` sites (58 / 46) and the `size.over300` sites (36 — `audit-index.js` crossed the
target: the SQL text and the JSDoc of the schema put it past 300, and rule 3 says bump, not split);
`docs/ECS-MAPPING.md` §8.

**Proven on the runtime, not on release notes:** `node_modules/electron/dist/electron.exe` 43.4.1
carries Node 24.18.1 with `node:sqlite` (SQLite 3.53.1); the §4 schema, `WITHOUT ROWID` with the
composite key, `ON DELETE CASCADE` (foreign keys enforced — `enableForeignKeyConstraints: true`
is passed explicitly, not left to the default), `user_version`, `quick_check`, `json_extract` and
WAL all answered as designed on that binary and on system Node 24.11.1. On a file that is not a
database the constructor does NOT throw — the first statement does — which is where the open's
inspection sits. The `ExperimentalWarning` (§10 q8): one line per process on system Node 24.11.1;
none under `ELECTRON_RUN_AS_NODE=1` on 43.4.1; the in-app main process was not probed.

**Deviations from §3, each a finding at implementation time:**

- **§3.6 continuity on BYTES, not on `seq`.** `flush()` takes one `stat` after the write and
  hands `append` the offset the write started at (`size − bytes`); the index compares it with
  `indexed_bytes`. The plan's `firstSeq === indexed_lines` would fail on every later flush of a
  file holding a repeated `seq` range — the interrupted-write-then-retry shape `verifyChain`'s own
  docstring names — and re-index that file once per flush. On a mismatch the file's rows are
  dropped, the index goes `'building'` and the reconcile re-reads the file from disk; there is no
  "stale" column — the stale marker is the ABSENCE of the `audit_files` row plus the state.
- **§3.5 "changed prefix" narrowed** to what the projection can see: `size < indexed_bytes` →
  full; `size == indexed_bytes` with a moved mtime → full; grown with the byte before the resume
  point being `\n` → resume; otherwise full. A same-length in-place edit inside the same
  millisecond is invisible here BY DESIGN — content integrity is the chain's job.
- **§3.5 `cleanOldLogs` → `forget` is NOT wired.** The sweep runs BEFORE the index opens, in the
  same `setImmediate`, so a `forget` there would be a call on a closed index every time (ai-mistakes
  #14); the reconcile's "row with no file" branch is the mechanism, and test T8 drives the organic
  sequence (indexed → deleted by retention at the next init → rows gone).
- **`line_no` counts a malformed line.** It is the ordinal of the non-empty line — the quantity
  `verifyChain` reports `malformed JSON at line i` for — so a rejected line owns its ordinal and is
  counted in `malformed_lines`, never stored. `indexed_lines` is therefore the next ORDINAL, which
  §4's comment calls "the next expected seq"; the two agree only on a file whose chain is intact.
- **A corrupt or out-of-version index is reported before it is discarded** (decided at the go):
  `logger.warn('audit-index', …, { reason, file })` precedes the close and the unlink — a forensic
  tool must not silently recreate its own store. T7 (`quick_check threw`) and T14 (`user_version 0,
  expected 1`) each assert exactly one warn; a healthy reopen asserts none.
- **The rebuild is asynchronous by batch, not by file:** ~2000 lines per transaction (the
  `audit_files` accounting in the same transaction), a `setImmediate` yield between batches, and up
  to three tail rounds that re-stat every file before the index is declared `'ready'` — lines
  flushed while a batch was yielding are on disk, and the live `append` is skipped until then.

**Chain breaks are reported, never repaired.** No column holds a hash; `verifyChain` is not
called from the rebuild; a duplicated `seq` range is visible as `seq ≠ line_no` and nothing is
dropped, renumbered or rewritten. The only writer of a daily file is still `flush()`.

**Tests, red first:** the new suite could not load (module absent) and two `audit-logger.test.js`
cases were red; after the modules, the first green run needed one fix in the writer (the parent
`audit_files` row must exist before the first event row — the foreign key is enforced) and two
fixture corrections in the suite (the ordinal rule above; T8 has to put the mismatch on TODAY's
file, the only one `flush()` writes). Mutations M2/M3/M6/M7/M8, each red then reverted with an
empty `git diff HEAD`, are in the PR body.

**Estimate miss, recorded:** `audit-index.js` was planned at ~240 lines and is ~530 by `wc` — the
DDL, the insert list and the JSDoc house style; with `audit-index-rebuild.js` (~220) and the
`audit-logger.js` seams (~100) the block is ~850 lines of `src`, past the ~500 the plan budgeted.
The cut line named at the go — the resume path — was not taken: the overrun is SQL text and
comments, not logic, and the resume path is what keeps the current day file from being re-read in
full on every start.
