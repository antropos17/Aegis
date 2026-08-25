# Audit index — a rebuildable SQLite projection over the hash-chained JSONL

**Status (as of 2026-08-25): BLOCKED on Electron >= 35.** The engine this plan chooses is
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
When the upgrade lands, refresh this header in the same PR (the lag `sensor-health-degraded.md`
records is what a stale status line costs).
**Branch context:** master @ `d1a80f8`; every `file:line` reference below was verified against that
commit on 2026-08-25. Line numbers drift with every edit — treat them as the place to start reading,
and re-verify before an edit that depends on one.
**Date:** 2026-08-25
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
| `get-audit-entries-before` (`src/main/ipc-handlers.js:272-274`) → `getEntriesBefore(beforeTs, limit)` (`audit-logger.js:563-623`) | `preload.js:57-58` → `Timeline.svelte:81-110` `loadOlderHistory`, `HISTORY_BATCH = 25` (`timeline-utils.ts:37`) | `timestamp < beforeTs` as a STRING comparison of ISO text (`:602`); `limit` clamped to [1, `MAX_READ_LIMIT`], default 100 (`:572-575`); `buffer-overflow-drop` markers excluded (`:603`); v0 records widened by `normalizeAuditEntry` (`:608`); files walked newest-first and a file whose date is later than the cursor's date is skipped (`:591`); inside a file `readLinesReverse` in 4 KB chunks (`:516-543`) with `JSON.parse` per line. Cost: O(lines after the cursor in that file). The TYPE filter runs in the renderer AFTER the fetch (`Timeline.svelte:97`, the four entries of `AUDIT_EVENT_TYPES`, `timeline-utils.ts:110-115`). |
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
  `audit_events_ts`, O(limit). This is a DELIBERATE divergence from the JSONL path's file-then-line
  order: entries logged before midnight and flushed after it sit in the file of day D+1, and
  `audit-logger.js:591` skips that file for a cursor inside day D; the index finds them. Pinned by
  test 9; the fallback path is left as it is.

---

## 5. First channel and what the renderer gains

`get-audit-entries-before` — with no new channel: the existing
`ipcRenderer.invoke('get-audit-entries-before', beforeTs, limit, types)` gains an OPTIONAL third
argument (`preload.js:57-58`, the same call, so `ipc.invoke` and `ipc.total` in `scripts/counts.js`
do not move); `ipc-handlers.js:272-274` passes it through; `Timeline.svelte:92` sends
`AUDIT_EVENT_TYPES`. Validation lives in `getEntriesBefore` beside the existing two: not an array, or
empty → no filter; non-string entries dropped; at most 16 entries of at most 64 characters. **The JSONL
path applies the filter too** (one check beside `:603`) — otherwise behaviour would depend on whether
the index exists.

What the renderer gains: (a) 25 RELEVANT events per fetch instead of 25 arbitrary lines filtered on
the client, which removes the false `historyExhausted` (§11); (b) for a cursor deep inside a large
daily file, an O(limit) seek instead of a reverse read of the file's tail with `JSON.parse` on every
line; (c) `flush()` before the read stays (`:576`), so buffered entries remain visible
(`tests/main/audit-logger.test.js:382-390`).

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

- `src/main/audit-logger.js` (~55 lines): `init` opens the index on `setImmediate` after
  `cleanOldLogs`; `flush` calls `append` after a successful `appendFileSync`; `getEntriesBefore`
  dispatches and applies `types` inside the JSONL loop; `cleanOldLogs` calls `index.forget(file)`;
  `shutdown` closes; `getStats` gains an additive `index` field.
- `src/main/ipc-handlers.js:272-274` (~2), `src/main/preload.js:57-58` (~2),
  `src/renderer/lib/components/Timeline.svelte:92` (~1), `src/renderer/lib/stores/ipc.ts` — declare
  `getAuditEntriesBefore` on `AegisIpcBridge` (~3).
- `vitest.config.js:39-72` — both new modules on `coverage.include` (a module missing from that list
  is not measured — the B3 lesson in `memory-bank/progress.md`).
- `tests/main/audit-logger.test.js` (+~60: the filter on the JSONL path, the dispatcher);
  `tests/main/ipc-handlers.test.js:262-264` (+~8: `get-audit-entries-before` is NOT asserted among the
  registered channels today — add it, and the pass-through of three arguments).
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
9. the rollover straddle: the index returns day-D records that live in the D+1 file; the JSONL path
   does not (the documented divergence, §4);
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
- **M4 — `types` removed from the JSONL path** → test 4 red.
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
   `timestamp`, the divergence pinned by test 9.
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

- **Timeline stops loading history on a batch of 25 unmatched rows.** `Timeline.svelte:81-110`
  fetches `HISTORY_BATCH` rows, filters them on the client to the four `AUDIT_EVENT_TYPES`
  (`:97`), and when `mapped.length === 0` sets `historyExhausted = true` (`:99-100`) — although the
  JSONL below the cursor may hold plenty of matching rows. A stretch of 25 consecutive `agent-enter`,
  `agent-exit`, `anomaly-alert` or `sequence-detection` records ends history loading for the rest of
  the session. The fix is the component's own: treat an empty MAPPED batch as "advance the cursor and
  fetch again" and mark exhaustion only when the FETCH returns nothing (`:93-94`), bounded by a retry
  cap so a log with no matching rows at all terminates. The index's server-side filter (§5) makes the
  case rarer; it does not make the renderer's logic right, so this is a separate fix with its own
  test in `tests/renderer/components/`.
- **`get-audit-entries-before` is not asserted in `tests/main/ipc-handlers.test.js:262-264`** among
  the registered channels — the neighbouring audit channels are. Add the assertion regardless of
  when the index lands.
- **`audit-logger.js:591` skips the D+1 file for a cursor inside day D**, so entries buffered across
  midnight are unreachable from the paginated view until the index exists. Recorded here as the
  fallback path's known bound; not changed in that path (§3, "no behaviour change").
