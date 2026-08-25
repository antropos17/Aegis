# ECS mapping — the AEGIS event boundary

AEGIS keeps its internal event schema untouched and exposes an **Elastic Common Schema 8.11**
view at the boundary. One module performs that projection:

**`src/shared/ecs-normalizer.js` is the source of truth. The tables in this document must follow
it, never the other way round.** If a row here and the module disagree, the module is right and
this file is the bug. Any change to the mapping is made in the module first; the row is then
updated to match.

Nothing consumes the projection yet. It exists so the names are fixed before the consumers are
built against them: sequence-rule-engine input, the bench trace format, and SIEM export.

---

## 1. Why ECS, and why at the boundary

**The Sysmon oracle joins through a mapping somebody else maintains.** `bench/lib/oracles/sysmon.js`
confirms what the sensor recorded against a kernel-backed independent source. Sysmon events reach
an ECS index through Elastic's own maintained winlogbeat mapping, and every field name on that side
is decided for us. Naming the AEGIS side anything else would mean writing — and then maintaining —
a second, private translation between two things that already agree on a vocabulary. `process.pid`,
`file.path`, `event.category` and `process.entity_id` on both sides is the whole point.

**Sigma correlation rules group by a field name, and that name is `process.entity_id`.** A Sigma
correlation (`group-by`) buckets events by field, so a sequence rule such as "this process read a
credential file and then opened an outbound connection" is only expressible if both events carry
the same process key under the same name. AEGIS already has the right value — `instanceId` binds a
pid to the OS process-creation time, which is exactly what `process.entity_id` is for (Sysmon puts
its `ProcessGuid` there). What was missing was the name.

**The internal schema stays as it is.** The projection happens at the boundary and only there.
Nothing inside AEGIS renames a field, and Event Schema v1 records on disk are unchanged.

---

## 2. How a record is recognised

`normalizeToEcs(event)` takes any of four carriers and works out which by structure. First match
wins; the order is part of the contract:

| # | test | carrier | emitted by |
|---|------|---------|-----------|
| 1 | `type` is a non-empty string | `AuditRecordV1` / `AuditRecordV0` | `src/main/audit-logger.js` |
| 2 | `file` is a string | `FileEvent` | `src/main/file-watcher.js` |
| 3 | `remoteIp` is a string | `NetworkConnection` | `src/main/network-monitor.js` |
| 4 | `firstSeen` is a number | session record | `src/main/session-tracker.js` `reconcile()` |

`type` is tested first because an audit record is the only carrier that has one, while its
`path`/`action` pair would otherwise be read as a live shape. A session record says which side it
is by `lastSeen`: `reconcile()` puts that field on an exit and withholds it on an enter.

**An unrecognised shape throws `TypeError`.** A normalizer that answered `{}` would drop the event
and look like it had handled it (memory-bank/ai-mistakes.md #25).

### Absence

A value a record does not carry is **omitted from the output — never written as `null`**. This is
the same convention `bench/lib/catalogue.js` states as B2.2, and it is load-bearing: `null` in an
ECS document reads as a measured null. Empty containers are omitted too — there is no
`process: {}` and no `aegis: {}`.

---

## 3. Categorization — `event.kind` / `event.category` / `event.type` / `event.action`

`event.category` and `event.type` are arrays, as ECS requires; `event.action` is a string.

| record | `kind` | `category` | `type` | `action` |
|---|---|---|---|---|
| `FileEvent` `created` | `event` | `[file]` | `[creation]` | `file-created` |
| `FileEvent` `modified` | `event` | `[file]` | `[change]` | `file-modified` |
| `FileEvent` `deleted` | `event` | `[file]` | `[deletion]` | `file-deleted` |
| `FileEvent` `accessed` | `event` | `[file]` | `[access]` | `file-accessed` |
| `FileEvent` `holding` | `event` | `[file]` | `[info]` | `file-handle-held` |
| `NetworkConnection` | `event` | `[network]` | `[connection]` | `network-connection` |
| session record, enter | `event` | `[process]` | `[start]` | `agent-enter` |
| session record, exit | `event` | `[process]` | `[end]` | `agent-exit` |
| audit `file-access` | `event` | `[file]` | by its `action`, as above | as above |
| audit `config-access` | `event` | `[configuration, file]` | by its `action` | as above |
| audit `network-connection` | `event` | `[network]` | `[connection]` | `network-connection` |
| audit `agent-enter` | `event` | `[process]` | `[start]` | `agent-enter` |
| audit `agent-exit` | `event` | `[process]` | `[end]` | `agent-exit` |
| audit `anomaly-alert` | `alert` | `[intrusion_detection]` | `[info]` | `anomaly-alert` |
| audit `sequence-detection` | `alert` | `[intrusion_detection]` | `[info]` | `sequence-detection` |
| audit `permission-deny`, `buffer-overflow-drop`, any unknown type | `event` | *omitted* | *omitted* | the `type` string |
| `FileEvent` with an action outside the closed union | `event` | `[file]` | *omitted* | *omitted* |

Four of those rows are decisions rather than transcriptions:

- **`holding` is `info`, not `access`.** `file-watcher.js` emits `holding` for a point-in-time
  handle HOLD observed at the scan tick, and its own comment says it is explicitly not a read.
  `access` would claim more than the observation supports (ai-mistakes.md #27).
- **`agent-enter` / `agent-exit`, not `process-started` / `process-ended`.** An enter is AEGIS's
  first *sighting* of an agent under eager-enter/lazy-exit reconciliation, which is not a process
  start; and a synthetic agent (pid 0 — editor extension, WSL-inner, local runtime) has no process
  to start at all. `event.category` and `event.type` still read `process` / `start`, and those,
  with `process.entity_id`, are what a Sysmon join actually uses.
- **`config-access` keeps its own category.** It is a file event *and* a settings access, and
  `event.category` is an array precisely so both can be said. No custom field is spent on it.
- **`permission-deny` and `buffer-overflow-drop` get no categorization.** Nothing in `src/` emits
  the first, and `src/shared/types/events.ts` refuses to invent its field semantics for a code path
  that never runs; inventing them here would be the same manufacture one layer down. The second is
  the audit log stating that *other* records were lost, which is no categorization of the marker
  itself — in particular it is not ECS `pipeline_error`, which describes a failure to ingest *this*
  document. Both keep `event.action` equal to their type and claim nothing more.

---

## 4. Field mapping

The mapping is field-driven: a field is mapped wherever it appears, so a carrier that lacks one
simply produces a smaller document.

| internal field | carrier | ECS field | rule |
|---|---|---|---|
| `timestamp` (epoch ms) | `FileEvent` | `@timestamp` | finite, `> 0`, within Date range → ISO 8601 UTC |
| `timestamp` (ISO string) | audit record | `@timestamp` | verbatim |
| `firstSeen` | session enter | `@timestamp` | epoch ms → ISO 8601 UTC |
| `lastSeen` | session exit | `@timestamp` | epoch ms → ISO 8601 UTC |
| `instanceId` | all | `process.entity_id` | non-empty string, **verbatim** — `pid:startTime`, `0:<name>` or `<pid>:u`, format unchanged |
| `pid` | all | `process.pid` | only `Number.isSafeInteger(pid) && pid > 0` |
| `process` | session record | `process.name` | non-empty string — the OS process name |
| `cwd` | `FileEvent`, `NetworkConnection` | `process.working_directory` | non-empty string |
| `file` | `FileEvent` | `file.path` | non-empty string |
| `path` | audit `file-access` / `config-access` | `file.path` | non-empty string |
| `remoteIp` | `NetworkConnection` | `destination.ip` | non-empty string |
| `remotePort` | `NetworkConnection` | `destination.port` | safe integer `> 0` |
| `domain` | `NetworkConnection` | `destination.domain` | non-empty string; the forward-confirmed name the classifier established, never a bare PTR answer |
| — | `NetworkConnection` | `network.transport` | constant `tcp` |
| `agent` | all | `aegis.agent.name` | non-empty string — the AEGIS display name |
| `attribution.status` | `FileEvent`, audit record | `aegis.attribution.status` | non-empty string |
| `attribution.evidence` | `FileEvent`, audit record | `aegis.attribution.evidence` | array, copied |
| `schemaVersion` | audit record | `aegis.schema_version` | safe integer |
| `_demo` | any | `aegis.demo` | only when strictly `true` |
| `riskScore` | audit record | `event.risk_score` | any finite number, **including `0`** |
| — | all | `ecs.version` | constant `8.11.0` |

### Rows that are decisions

**Two names, and they are not the same thing.** `process` is the OS process name (`node.exe`) and
goes to `process.name`. `agent` is the AEGIS display name (`Claude Code`) and goes to
`aegis.agent.name`. They are different strings about different things, and a join treating one as
the other would manufacture matches out of a naming coincidence — the reason `bench/lib/join.js`
refuses to join on a name at all. Root ECS `agent.*` is reserved for the collector, which here is
AEGIS itself, and is never written.

**`process.pid` only for a pid the OS handed out.** `pid: 0` is a real value in AEGIS meaning a
synthetic, process-less agent, and `pid: null` means none was observed. Neither is an OS pid, and
writing either invites a join on it — every synthetic in the fleet would land in one bucket. The
synthetic stays identified: its `process.entity_id` is `0:<name>`. Same rule and same reason as
`bench/lib/observed.js` `processIdentity()`.

**`process.entity_id` is copied, never parsed.** The value carries its own three value spaces
(`src/main/process-identity.js`); splitting the pid back out of it here would be a second identity
resolution one step removed from the first (ai-mistakes.md #19).

**`aegis.demo` is written only for `_demo === true`.** Absence is the observed case and presence is
the claim: the main process has no way to set the flag, so an unmarked record must not be marked
here — and a marked one must not reach a SIEM looking like a real observation.

### `event.risk_score` is vestigial, and it is `0` on every record

`AuditRecordV1.riskScore` is always `0` in v1. `src/shared/types/events.ts` says so and adds
"derive nothing from it". It is mapped anyway, `0` included, because a value the record carries is
not an absence — the omit-never-null rule is about fields that are *missing*.

The consequence must be read before writing a rule against it: **`event.risk_score` is `0` on every
ECS document AEGIS produces today.** A detection expressed as `risk_score > 50` will never fire,
and will look like a rule that is evaluating a score. When a real score exists, it will map through
this same row unchanged.

---

## 5. Requested mappings with no source

These ECS fields are **never written**, because no internal record carries a value for them. None
is a stub awaiting a value; each is a statement about what AEGIS observes today.

| ECS field | why there is no source |
|---|---|
| `process.executable` | No full executable path exists anywhere in the internal shapes. `DetectedAgent` carries `process` (the image name) and nothing more; the snapshot sidecar frame is `{pid, ppid, name, ct, seq}`. |
| `process.parent.pid` | `ppid` lives inside the process map `getParentProcessMap()` builds and is never carried onto an agent record or an event. |
| `process.parent.name` | `parentEditor` is a display **label** (`'VS Code'`, from `EDITOR_LABELS`), not a process name; `parentChain` — which does hold real parent process names — lives on `DetectedAgent` only and is copied onto no event. |
| `source.ip` | A `RawTcpConnection` is `{pid, ip, port, state}`. The local endpoint is not in the row. |
| `source.port` | Same row, same absence. |
| `@timestamp` on a `NetworkConnection` | The connection object carries no observation time at all — `network-monitor.js` uses its `now` only for sensor health. The audit record written for the same socket does carry one, and that is where a time for that event comes from. |
| `destination.ip` / `destination.port` on an **audit** `network-connection` record | Its `path` is the display string `` `${remoteIp}:${remotePort}` ``. Splitting it back apart would rebuild an identity out of a rendering, and is ambiguous the moment the address is IPv6. `destination.*` comes from a live `NetworkConnection` only. |

Wiring any of these means changing an emitter first, which is a separate piece of work. Until then,
the honest answer is the empty one.

---

## 6. Carried by the internal schema, not mapped in this block

Enumerated so each omission is a decision rather than an oversight (ai-mistakes.md #30):

`verdict`, `verdictReason`, `severity`, `sensitive`, `selfAccess`, `reason`, `category`, `state`,
`flagged`, `httpUnencrypted`, `userAgent`, `parentEditor`, `details`, `seq`, `hash`, `repeatCount`.

Several have obvious ECS or `aegis.*` homes — `severity`, `verdict` and `state` in particular. They
are left out because this block fixes the identity, time, path and network naming and nothing else.
Adding one later is an additive change to the module and one more row above.

---

## 7. Relationship to `bench/lib`

`bench/lib/catalogue.js` and `bench/lib/observed.js` already write a minimal ECS subset, and they
are **not** refactored onto this module. Nothing under `bench/lib/` may import from `src/`: the
bench is the oracle side, and an oracle that shares code with the sensor it confirms stops being
independent. The duplication is deliberate and stays.

What that costs, stated rather than hidden:

| | `src/shared/ecs-normalizer.js` | `bench/lib/{catalogue,observed}.js` |
|---|---|---|
| custom namespace | `aegis.*` | `bench.*` |
| instance key | `process.entity_id` | `bench.instanceId` |
| attribution | `aegis.attribution` | `bench.attribution` |
| action for an `agent-enter` record | `agent-enter` | `process-started` |
| scope | every carrier and every audit type | four shapes; network and anomaly records are tallied, not written |
| ECS version | `ECS_VERSION` | `ECS_VERSION` — same value, separate declaration |

The two `ECS_VERSION` declarations are compared by a case in `tests/shared/ecs-normalizer.test.js`.
That test is the only thing that goes red if they drift apart; there is no other gate on it.

The shared conventions — omit rather than null, `event.category`/`event.type` as arrays,
`@timestamp` at the root, `ecs.version` on every document — are the same on both sides, and a row
that changes one should change the other.
