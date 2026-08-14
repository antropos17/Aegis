/**
 * @file process-identity.js
 * @module main/process-identity
 * @description The single authority for AEGIS's process INSTANCE key. Windows
 *   recycles PIDs, so a bare PID is not an identity: a new process can inherit a
 *   dead one's session, dedup sets and accumulated accounting. `instanceId` binds
 *   the PID to the OS process-creation time — a pair the OS never reissues.
 *
 *   THREE VALUE SPACES, disjoint by construction (a value from one can never
 *   equal a value from another — the pid segment and the `u` marker separate them):
 *
 *     1. `"<pid>:<epochMs>"` — source `'os'`. pid > 0 with a readable OS birth
 *        time. The reuse-resistant case.
 *     2. `"0:<name>"` — source `'synthetic'`. pid 0. Editor-extension agents
 *        (Kilo Code, Cline), WSL-inner agents and local LLM runtimes have no OS
 *        process at all and are registered with pid 0 (ide-extension-detector.js,
 *        wsl-detector.js, scan-loop.js `attachModels`). Their NAME is the
 *        identity, so two synthetics never collapse onto one key, and the key is
 *        stable across ticks — a per-tick surrogate would churn their agent cards.
 *     3. `"<pid>:u"` — source `'unknown'`. A real process whose birth time is
 *        unreadable. Honest by construction: "this pid, instances
 *        indistinguishable". Cannot collide with space 1 (`u` is not a number),
 *        and the degradation is exactly the pre-instanceId behaviour, not a
 *        regression.
 *
 *   `:u` is deliberately NOT a fabricated surrogate (no counter, no first-seen
 *   stamp). Distinguishability we do not have is not invented here; a caller that
 *   needs name-level discrimination composes it itself — session-tracker.js keys
 *   on `instanceId|process`, so the process name still separates instances
 *   wherever space 3 applies.
 *
 *   TIME RESOLUTION — the bound on space 1, per platform. Two instances sharing
 *   BOTH a pid and a stored birth millisecond are indistinguishable, and degrade to
 *   space 3's behaviour (two instances read as one). No tie-breaker is added for
 *   that — the code would never run.
 *     - win32: MILLISECONDS. The snapshot sidecar reports each process's creation
 *       time in 100 ns FILETIME ticks, and `ticksToEpochMs`
 *       (platform/process-snapshot.js) floors them to the epoch-ms this key is
 *       built from. The CIM `Win32_Process.CreationDate` path (platform/win32.js
 *       `cimParentProcessMap`) produces the same millisecond and is the EMERGENCY
 *       FALLBACK, not the source. The 100 ns observation is 10 000× finer than the
 *       millisecond kept here, so this bound is a property of THIS KEY's format,
 *       not of what the OS can observe.
 *       A collision needs the same pid reissued with a creation time that FLOORS
 *       TO THE SAME stored millisecond — which is a bucket, not a sliding window:
 *       two creations 0.86 ms apart inside one millisecond collide, two 0.1 ms
 *       apart across the boundary do not. `tests/fixtures/bench/derived/
 *       D1-pid-reuse-same-ms/` models that first pair, and what a pid-only join
 *       can and cannot say about it.
 *     - linux: 10 ms would be available from `/proc/<pid>/stat` field 22 at the
 *       usual USER_HZ=100. The `/proc/stat` btime anchor carries up to ±1 s of
 *       systematic error, but it is identical for every process on the machine,
 *       so it affects only cross-machine comparability — never distinguishability.
 *       NOT WIRED: platform/linux.js `getParentProcessMap` omits startTime today,
 *       so linux resolves to space 3.
 *     - darwin: 1 SECOND at best (`ps` lstart/etime). Reuse inside one second
 *       would require the macOS pid counter to wrap (~99k spawns in that second).
 *       NOT WIRED: platform/darwin.js omits startTime, so darwin resolves to
 *       space 3.
 *
 *   That MERGE is the only way this FORMAT loses a distinction; it is not the only
 *   way the key can be wrong. The opposite failure is a SPLIT, and it comes from
 *   outside this file: one live instance read with two DIFFERENT birth milliseconds
 *   across ticks resolves to two keys, and its session, dedup set and token
 *   accounting split with it. That is a disagreement between birth-time SOURCES
 *   rather than a property of the format, which is why the snapshot sidecar is held
 *   to exact millisecond parity against CIM before it may be believed at all
 *   (memory-bank/ai-mistakes.md #25) — the guard is there, not here.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.11.0
 */
'use strict';

/**
 * Closed set of `instanceId` provenances. Exported so callers and tests assert
 * against the set instead of re-listing the literals: `'os'` = bound to an OS
 * birth time (space 1), `'synthetic'` = named pid-0 entity (space 2),
 * `'unknown'` = real pid, birth time unreadable (space 3).
 * @type {readonly ['os', 'synthetic', 'unknown']}
 * @since v0.11.0
 */
const INSTANCE_ID_SOURCES = Object.freeze(['os', 'synthetic', 'unknown']);

/**
 * @typedef {'os'|'synthetic'|'unknown'} InstanceIdSource
 */

/**
 * @typedef {Object} ProcessIdentity
 * @property {string} instanceId - the instance key; one of the three value spaces.
 * @property {InstanceIdSource} instanceIdSource - where the key came from, so a
 *   consumer can be honest about reuse-resistance without parsing the string.
 */

/**
 * @typedef {Object} IdentityInput
 * @property {number} [pid] - OS process id; 0 marks a synthetic (process-less) agent.
 * @property {string} [process] - OS process name (preferred name source).
 * @property {string} [agent] - display name; used only when `process` is absent.
 * @property {number|null} [startTime] - OS process-creation time (epoch ms), or
 *   null/absent when the platform did not supply one.
 */

/**
 * Normalise a pid to a non-negative integer, or null when it is unusable.
 * @param {*} v
 * @returns {number|null}
 */
function _normalizePid(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Name segment for the synthetic space: lowercased, whitespace collapsed to `-`
 * so the key stays a single readable token in JSON and audit JSONL. `process` is
 * preferred over `agent` because the detectors already emit a normalised process
 * name (e.g. 'lm-studio'); the display name is the fallback.
 * @param {IdentityInput} agent
 * @returns {string} normalised name, or '' when there is none.
 */
function _normalizeName(agent) {
  const raw = agent && (agent.process || agent.agent);
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * True when a value is a usable OS birth time (finite epoch-ms above zero).
 * @param {*} v
 * @returns {boolean}
 */
function _isUsableStartTime(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Resolve a detected agent to its instance key AND the key's provenance. Pure —
 * no module state, no I/O, no clock. See the file header for the three value
 * spaces and their platform bounds.
 * @param {IdentityInput} agent - detected agent (or any {pid, process, startTime}).
 * @returns {ProcessIdentity}
 * @since v0.11.0
 */
function identify(agent) {
  const pid = _normalizePid(agent && agent.pid);

  // Space 1 — a real process with a readable OS birth time.
  if (pid !== null && pid > 0 && _isUsableStartTime(agent.startTime)) {
    return { instanceId: `${pid}:${agent.startTime}`, instanceIdSource: 'os' };
  }

  // Space 2 — pid 0 is not an OS process; the name IS the identity. An unnamed
  // pid-0 entry falls through to space 3: without a name there is nothing to
  // distinguish it by, and inventing one would be a fabricated identity.
  if (pid === 0) {
    const name = _normalizeName(agent);
    if (name) return { instanceId: `0:${name}`, instanceIdSource: 'synthetic' };
  }

  // Space 3 — honest "cannot distinguish instances of this pid". An unusable pid
  // normalises to 0 so the key stays well-formed rather than embedding 'NaN'.
  return { instanceId: `${pid === null ? 0 : pid}:u`, instanceIdSource: 'unknown' };
}

/**
 * The instance key alone, for callers that do not need the provenance.
 * @param {IdentityInput} agent
 * @returns {string}
 * @since v0.11.0
 */
function buildInstanceId(agent) {
  return identify(agent).instanceId;
}

/**
 * Read back the `instanceId` an agent object already carries, or `null`.
 *
 * READ, never re-derive. The counterpart to {@link buildInstanceId}, and the reason
 * both live here: the stamp exists so a consumer can join an event to the agent it
 * received in the SAME `scan-batch`, which means the value must be the identical
 * string that batch carried. `buildInstanceId()` would cheerfully produce a
 * well-formed key from whatever fields the object happens to hold — `0:code.exe`
 * where the batch says `0:kilo-code` (scan-loop.js `injectDetectedExternalAgents`
 * withholds `process` on purpose) — and a key that joins to nothing is worse than a
 * documented absence: `null` says "no key", a wrong key says "this other instance".
 * Deriving one at a consumer would also be a SECOND identity resolution, one tick
 * removed from the first — exactly the cross-tick pid reuse ai-mistakes.md #19 is
 * about.
 *
 * `null` therefore covers two distinct cases, and neither may be papered over with
 * a name match: no owner was resolved (C-01 — an unattributed event keeps no agent,
 * so it keeps no key), or the resolved owner was never stamped upstream (the
 * `attachModels` synthetics, scan-loop.js).
 *
 * Hot-path consumers (handleKey, sessionKey, event stamps) must NOT pair this with
 * `buildInstanceId` as a silent fallback — that is a second identity resolution.
 * Prefer null / skip. Bare-pid token accounting may use space-3 `"<pid>:u"` only as
 * an explicit degraded domain, never as a substitute for a missing stamp.
 * @param {{instanceId?: string}|null|undefined} agent - the agent resolved for THIS
 *   event, on THIS tick. Never a substitute, never a re-resolved pid.
 * @returns {string|null}
 * @since v0.12.0
 */
function readInstanceId(agent) {
  return agent && typeof agent.instanceId === 'string' && agent.instanceId
    ? agent.instanceId
    : null;
}

module.exports = {
  INSTANCE_ID_SOURCES,
  identify,
  buildInstanceId,
  readInstanceId,
};
