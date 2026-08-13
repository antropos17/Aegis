/**
 * @file process-utils.js
 * @module main/process-utils
 * @description Parent-chain resolution via PowerShell and editor host app
 *   annotation for detected AI agent processes.
 * @requires child_process
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const path = require('path');
const _platform = require('./platform');
const { identify } = require('./process-identity');
const { EDITORS } = require('../shared/constants');

let _getParentProcessMap = _platform.getParentProcessMap;
let _getProcessCwds = _platform.getProcessCwds;
/**
 * Whether this platform's `getParentProcessMap` carries an OS birth time. Only
 * win32 does today (`Win32_Process.CreationDate`); linux and darwin omit it, and
 * neither may pay a per-scan subprocess or /proc walk to serve a Windows-only
 * generation check. The flag is what gates the generation proof below.
 * @type {boolean}
 */
let _providesStartTime = _platform.providesStartTime === true;
/** @internal Override platform functions AND the birth-time capability (for tests). */
function _setPlatformForTest(overrides) {
  if (overrides.getParentProcessMap) _getParentProcessMap = overrides.getParentProcessMap;
  if (overrides.getProcessCwds) _getProcessCwds = overrides.getProcessCwds;
  // Explicit boolean, not truthiness: `false` is a value a test must be able to
  // pin, so both paths are exercised without depending on the CI host's OS.
  if (typeof overrides.providesStartTime === 'boolean')
    _providesStartTime = overrides.providesStartTime;
}
/** @internal Clear caches and restore the real platform capability (for tests). */
function _resetForTest() {
  parentChainCache.clear();
  cwdCache.clear();
  _providesStartTime = _platform.providesStartTime === true;
}

const parentChainCache = new Map();
const PARENT_CHAIN_TTL = 60000;

/**
 * Cache key for the parent-chain / startTime cache AND the cwd cache: pid PLUS
 * the process name.
 *
 * A bare pid is not enough. Windows recycles PIDs, so a live TTL entry keyed on
 * pid alone serves the DEAD process's chain and — far worse — its `startTime`,
 * the one field `instanceId` is built from. Folding the name in turns a recycled
 * pid that belongs to a different executable into a cache MISS.
 *
 * The name is NOT the whole answer: a pid recycled by an executable with the SAME
 * name produces the same key. What separates those two instances is the GENERATION
 * WITNESS — freshly observed on every enrichment pass and never read back out of a
 * cache. The key addresses the entry; the witness decides whether the entry is
 * still about the process running under that pid right now (see
 * {@link enrichWithParentChains} and {@link _witnessOf}).
 * @param {number} pid
 * @param {string} [name] - OS process name (or display name) observed for that pid.
 * @returns {string}
 * @since v0.11.0
 */
function _cacheKey(pid, name) {
  return `${pid}|${typeof name === 'string' ? name.toLowerCase() : ''}`;
}

/**
 * The name segment {@link _cacheKey} is keyed on: the OS process name, falling back
 * to the display name. One definition, so the parent-chain cache and the cwd cache
 * can never disagree about which name belongs to a pid — a disagreement would make
 * the two caches key the same process differently and silently halve their hit rate.
 * @param {{process?: string, agent?: string}} agent
 * @returns {string} the name, or '' when the agent carries neither.
 */
function _agentName(agent) {
  return String(agent.process || agent.agent || '');
}

/**
 * Drop entries older than their TTL once a cache grows past 500 keys. Shared by
 * both caches so neither can grow without bound on a long-running scan.
 * @param {Map<string, {timestamp: number}>} cache
 * @param {number} ttl
 * @param {number} now
 * @returns {void}
 */
function _pruneStale(cache, ttl, now) {
  if (cache.size <= 500) return;
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > ttl) cache.delete(key);
  }
}

/**
 * Walk one pid's parent chain inside an already-fetched process map. Depth 6,
 * cycle-guarded, and it costs nothing: the map is the caller's, so a chain rebuild
 * never adds a provider call.
 * @param {Map<number, {name: string, ppid: number}>} procMap
 * @param {number} pid
 * @returns {string[]} parent names, nearest first.
 */
function _walkChain(procMap, pid) {
  const chain = [];
  let cur = pid;
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const info = procMap.get(cur);
    if (!info) break;
    const pp = info.ppid;
    if (pp <= 0 || pp === cur || seen.has(pp)) break;
    seen.add(pp);
    const parentInfo = procMap.get(pp);
    if (!parentInfo) break;
    chain.push(parentInfo.name);
    cur = pp;
  }
  return chain;
}

/**
 * The OS birth time (epoch-ms) a process map carries for one pid, or null when the
 * platform omits it (darwin/linux map entries) or the OS withheld it for this pid.
 * Null is honest — never a substitute for a number, and never read from a cache.
 * @param {Map<number, {startTime?: number|null}>} procMap
 * @param {number} pid
 * @returns {number|null}
 */
function _birthTimeOf(procMap, pid) {
  const info = procMap.get(pid);
  return info && typeof info.startTime === 'number' ? info.startTime : null;
}

/**
 * The GENERATION WITNESS a process map carries for one pid: the strongest proof
 * THIS observation can offer that a cached entry still describes the process
 * living under that pid right now.
 *
 * Ordered, and the order is the whole point:
 *   1. `entry.witness` — what the snapshot sidecar observed: the kernel
 *      SequenceNumber where Windows supplies it (Microsoft documents it as the
 *      PID-reuse detector), otherwise the creation time in 100 ns ticks. Always a
 *      STRING. Both are 64-bit values a JS number cannot hold without dropping low
 *      digits, and a witness that lost its low digits compares EQUAL across two
 *      generations — precisely the failure it exists to prevent.
 *   2. the epoch-ms birth time, stringified, source `startTimeMs` — what the
 *      emergency CIM observation and every pre-sidecar map entry can offer. This is
 *      the same proof PR #206 shipped, carried in the new shape, which is why
 *      linux/darwin and the existing behaviour are untouched by the change.
 *   3. null — nothing observable, so nothing proven. Never a substitute for a
 *      value, and never taken from a cache.
 *
 * The SOURCE travels with the value and is compared alongside it, so two witnesses
 * of different provenance are never equal by accident: a provider change can only
 * invalidate cache entries, never falsely prove one.
 * @param {Map<number, {startTime?: number|null, witness?: string|null,
 *   witnessSource?: string|null}>} procMap
 * @param {number} pid
 * @returns {{value: string, source: string}|null}
 * @since v0.12.0
 */
function _witnessOf(procMap, pid) {
  const info = procMap.get(pid);
  if (!info) return null;
  if (
    typeof info.witness === 'string' &&
    info.witness.length > 0 &&
    typeof info.witnessSource === 'string' &&
    info.witnessSource.length > 0
  ) {
    return { value: info.witness, source: info.witnessSource };
  }
  const birthTime = _birthTimeOf(procMap, pid);
  // The same usability test process-identity.js applies before building an `os`
  // key: a value that cannot identify an instance cannot prove one either.
  if (!Number.isFinite(birthTime) || birthTime <= 0) return null;
  return { value: String(birthTime), source: 'startTimeMs' };
}

/**
 * Resolve parent process chains for a list of PIDs via platform adapter, TTL-cached.
 *
 * This is the chain-only helper: it answers from the cache when it can and fetches
 * a process map only for the pids it cannot answer. It carries no generation proof
 * and is not the identity path — {@link enrichWithParentChains} is, and on a
 * birth-time platform that path observes its own single map instead of calling here.
 *
 * The entries it writes therefore carry no witness. Nothing on win32 calls this
 * today; if something did, those entries would simply never be proven and would be
 * rebuilt — safe, only wasteful. An entry may never be reused on the strength of a
 * proof it does not hold.
 * @param {number[]} pids
 * @param {Object} [opts]
 * @param {Map<number, string>} [opts.names] - pid → process name, used to key the
 *   cache (see {@link _cacheKey}). Omitted names key as the empty string, which is
 *   consistent for a caller that never supplies them.
 * @param {boolean} [opts.forceRefresh=false] - when true, ignore cached entries for
 *   the requested pids and re-read the OS process map. Costs one platform call.
 * @returns {Promise<Map<number, string[]>>} pid to parent-name chain
 * @since v0.1.0
 */
async function getParentChains(pids, opts = {}) {
  if (pids.length === 0) return new Map();

  const names = opts.names instanceof Map ? opts.names : null;
  const forceRefresh = opts.forceRefresh === true;
  const keyOf = (pid) => _cacheKey(pid, names ? names.get(pid) : undefined);

  const now = Date.now();
  _pruneStale(parentChainCache, PARENT_CHAIN_TTL, now);
  const needLookup = pids.filter((pid) => {
    if (forceRefresh) return true;
    const cached = parentChainCache.get(keyOf(pid));
    return !cached || now - cached.timestamp > PARENT_CHAIN_TTL;
  });

  if (needLookup.length === 0) {
    const result = new Map();
    for (const pid of pids) {
      const cached = parentChainCache.get(keyOf(pid));
      if (cached) result.set(pid, cached.chain);
    }
    return result;
  }

  const procMap = await _getParentProcessMap();
  const result = new Map();

  // Populate cached entries first — skipped entirely under forceRefresh, where
  // every requested pid is re-walked from the fresh map below.
  if (!forceRefresh) {
    for (const pid of pids) {
      const cached = parentChainCache.get(keyOf(pid));
      if (cached && now - cached.timestamp <= PARENT_CHAIN_TTL) {
        result.set(pid, cached.chain);
      }
    }
  }

  // Walk parent chains in JS for uncached PIDs
  for (const pid of needLookup) {
    // The OS birth time (epoch-ms) for the agent's OWN pid comes from the same map
    // fetch — zero extra spawn. Only win32 supplies it; darwin/linux map entries
    // omit startTime, so this is null there (honest).
    const chain = _walkChain(procMap, pid);
    parentChainCache.set(keyOf(pid), {
      chain,
      startTime: _birthTimeOf(procMap, pid),
      timestamp: now,
    });
    result.set(pid, chain);
  }

  return result;
}

/**
 * Stamp `parentChain`, `startTime` and the generation witness from ONE fresh
 * process-map observation, on a platform that supplies OS birth times. This is the
 * generation proof.
 *
 * Exactly one provider call per pass, and that single map serves everything: the
 * witness that proves the generation, the birth time the identity is built from,
 * and every chain rebuild a miss or a generation change needs. There is never a
 * second fetch in one pass.
 *
 * A cached entry survives only while the FRESH witness — value AND source — equals
 * the one the entry was written with. Same pid, same executable name, different
 * witness is a different process instance, so its chain is rebuilt from this map
 * and its cwd loses its proof (see {@link annotateWorkingDirs}).
 *
 * The witness gates the CACHE; it is not the identity. `startTime` is still the
 * freshly observed epoch-ms and still the only input to `instanceId` — a cached
 * birth time never proves the current instance, and when the fresh observation
 * withholds it the agent gets null rather than the stale number, degrading through
 * the `<pid>:u` identity process-identity.js already defines. A pid whose witness
 * is readable while its birth time is not therefore keeps a working cache gate AND
 * an honest `unknown` identity; the two answer different questions.
 *
 * pid ≤ 0 is not an OS process (the pid-0 synthetics), so there is no generation to
 * prove for it and the plain TTL contract applies.
 * @param {Array} agents
 * @param {boolean} forceRefresh - rebuild every chain from this map regardless of
 *   what the cache holds.
 * @returns {Promise<void>}
 * @since v0.12.0
 */
async function _stampFromFreshBirthTimes(agents, forceRefresh) {
  const procMap = await _getParentProcessMap();
  const now = Date.now();
  _pruneStale(parentChainCache, PARENT_CHAIN_TTL, now);

  for (const a of agents) {
    const key = _cacheKey(a.pid, _agentName(a));
    const birthTime = _birthTimeOf(procMap, a.pid);
    const witness = _witnessOf(procMap, a.pid);
    const cached = forceRefresh ? undefined : parentChainCache.get(key);
    const live = cached !== undefined && now - cached.timestamp <= PARENT_CHAIN_TTL;
    const proven =
      live &&
      (a.pid <= 0 ||
        (witness !== null &&
          cached.witness === witness.value &&
          cached.witnessSource === witness.source));

    if (proven) {
      a.parentChain = cached.chain;
    } else {
      const chain = _walkChain(procMap, a.pid);
      parentChainCache.set(key, {
        chain,
        startTime: birthTime,
        witness: witness ? witness.value : null,
        witnessSource: witness ? witness.source : null,
        timestamp: now,
      });
      a.parentChain = chain;
    }
    a.startTime = birthTime;
    a.generationWitness = witness ? witness.value : null;
    a.generationWitnessSource = witness ? witness.source : null;
  }
}

/**
 * Stamp `parentChain` and `startTime` on a platform that supplies NO birth time
 * (linux, darwin). Unchanged behaviour: the TTL-bounded parent-chain cache answers,
 * and a pass whose pids are all cached costs no provider call at all. Adding a
 * per-pass process map here would buy nothing — there is no birth time in it to
 * prove a generation with — and would cost a `ps` spawn or a full /proc walk every
 * scan tick.
 *
 * No generation witness is stamped here, deliberately: the field stays `undefined`,
 * which {@link annotateWorkingDirs} reads as "this record established no
 * generation" and answers with the plain TTL contract. An invented witness would be
 * a fabricated proof.
 * @param {Array} agents
 * @param {boolean} forceRefresh
 * @returns {Promise<void>}
 * @since v0.12.0
 */
async function _stampFromCachedChains(agents, forceRefresh) {
  // pid → name for the cache key. Synthetic agents all share pid 0, so the last
  // one wins here; harmless because pid 0 is absent from the OS process map (its
  // startTime is null either way) and identify() reads each agent's OWN name.
  const names = new Map();
  for (const a of agents) names.set(a.pid, _agentName(a));
  const chains = await getParentChains(
    agents.map((a) => a.pid),
    { names, forceRefresh },
  );
  for (const a of agents) {
    a.parentChain = chains.get(a.pid) || [];
    const entry = parentChainCache.get(_cacheKey(a.pid, names.get(a.pid)));
    a.startTime = entry && typeof entry.startTime === 'number' ? entry.startTime : null;
  }
}

/**
 * Attach parent-chain arrays, the OS process start-time AND the process instance
 * key to each agent object.
 *
 * `startTime` (epoch-ms, OS birth time) is distinct from `firstSeen`
 * (AEGIS-observed). Used by the token-feed PID-reuse guard; null on a platform that
 * supplies no birth time, and null for an absent pid.
 *
 * WHERE IT COMES FROM decides whether `instanceId` means anything. On a platform
 * that supplies birth times, every pass makes ONE fresh process-map observation:
 * the birth time it reads is the stamped value, and the GENERATION WITNESS it reads
 * alongside is the proof that the cached `parentChain` (and, downstream, the cached
 * cwd) still describes the process living under that pid — see
 * {@link _stampFromFreshBirthTimes} and {@link _witnessOf}. Serving a CACHED birth
 * time was the poisoning bug: a pid Windows had reissued to another process of the
 * same executable name kept the dead process's birth time, so both instances shared
 * one `instanceId`, and with it one session, one dedup set and one token ledger.
 *
 * `generationWitness` / `generationWitnessSource` are stamped here too. They gate
 * cache reuse and NOTHING else: the `instanceId` format stays `pid:startTime(ms)`,
 * so two instances that share a pid and a birth millisecond still collide on the
 * identity even when a stronger witness can tell them apart. That bound is
 * documented, not eliminated (process-identity.js TIME RESOLUTION).
 *
 * `instanceId` / `instanceIdSource` are derived from that startTime by
 * process-identity.js. This is the ONLY place they are stamped, so it must run
 * BEFORE anything that keys on a process instance — session-tracker's reconcile in
 * particular (see scan-loop.js).
 * @param {Array} agents
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh=false] - rebuild every parent chain from the
 *   observed map instead of trusting cached entries. The identity stamp no longer
 *   depends on it: the birth time is re-observed on every pass either way.
 * @returns {Promise<void>}
 * @since v0.1.0
 */
async function enrichWithParentChains(agents, opts = {}) {
  if (agents.length === 0) return;
  const forceRefresh = opts.forceRefresh === true;
  if (_providesStartTime) await _stampFromFreshBirthTimes(agents, forceRefresh);
  else await _stampFromCachedChains(agents, forceRefresh);
  for (const a of agents) {
    const identity = identify(a);
    a.instanceId = identity.instanceId;
    a.instanceIdSource = identity.instanceIdSource;
  }
}

/**
 * The generation witness ONE agent record carries out of its own enrichment pass.
 *
 * Read off the record, never out of `parentChainCache`. The cache is keyed by
 * `pid|name` and is shared by every record that ever used that key, so a lookup
 * there would answer with a generation some OTHER record established — possibly on
 * an earlier tick — and a record that never went through enrichment at all would
 * silently borrow it. The witness is written by {@link enrichWithParentChains} on
 * every observation, so the record itself is the only honest source.
 * @param {{generationWitness?: string|null, generationWitnessSource?: string|null}} agent
 * @returns {{value: string, source: string}|null|undefined} the pair when this
 *   record's own fresh observation produced a witness; `null` when enrichment ran
 *   for it and the observation produced none (nothing is proven); `undefined` when
 *   this record never passed through enrichment, so no generation was established
 *   for it either way.
 * @since v0.12.0
 */
function _recordWitness(agent) {
  const value = agent.generationWitness;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) return null;
  const source = agent.generationWitnessSource;
  return typeof source === 'string' && source.length > 0 ? { value, source } : null;
}

/** Map editor host exe names (lowercase) to human-readable labels, derived from EDITORS */
const EDITOR_LABELS = Object.fromEntries(
  EDITORS.flatMap((e) => e.names.map((n) => [n.toLowerCase(), e.label])),
);

/**
 * Annotate agents whose parentChain includes an editor host.
 * Sets displayLabel = "AgentName (via EditorName)" and parentEditor field.
 * @param {Array} agents
 * @returns {void}
 * @since v0.2.0
 */
function annotateHostApps(agents) {
  for (const a of agents) {
    if (!a.parentChain || a.parentChain.length === 0) continue;
    for (const p of a.parentChain) {
      const label = EDITOR_LABELS[p.toLowerCase()];
      if (label) {
        a.parentEditor = label;
        a.displayLabel = `${a.agent} (via ${label})`;
        break;
      }
    }
  }
}

const cwdCache = new Map();
const CWD_CACHE_TTL = 60000;

/**
 * Annotate agents with their working directories.
 * Sets `agent.cwd` (full path) and `agent.projectName` (basename).
 * Uses batched platform call (single PowerShell spawn on Windows).
 *
 * The cache is keyed by pid AND process name — the same {@link _cacheKey} the
 * parent-chain cache uses, and for the same reason. A bare pid was not enough:
 * a pid recycled inside the 60 s TTL served the DEAD process's `cwd`, and `cwd`
 * is the field the renderer's instance key is built from and the field
 * CWD_CONTAINMENT attribution matches on. Folding the name in turns a recycled
 * pid belonging to a different executable into a cache MISS.
 *
 * A same-name recycled pid produces the same key, so on a platform that supplies
 * birth times the entry additionally carries the GENERATION WITNESS it was fetched
 * under, and it is served only while that witness is still the one THIS agent record
 * carries from its own enrichment pass ({@link _recordWitness}). This function
 * performs NO observation of its own — it consumes the one the record already holds,
 * which is why scan-loop must keep running the identity stamp first.
 *
 * Three cases, and the middle one is the honest degradation:
 *   - a witness pair → the cwd must have been fetched under that same value AND
 *     source;
 *   - `null` (enrichment ran for this record and the fresh observation produced no
 *     witness) → nothing is proven, so the cwd is re-fetched rather than
 *     inherited from the old generation;
 *   - `undefined` (this record never passed through enrichment — every pid on
 *     linux/darwin, pid ≤ 0, and any direct caller that skipped the stamp) → the
 *     record established no generation, so none is invented for it and the plain
 *     TTL contract applies exactly as it did before generations existed.
 * @param {Array} agents
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh=false] - when true, ignore cached entries and
 *   re-read the working directories from the platform. Pass true when the scanned
 *   pid set changed: a pid new to the set must never be annotated with a dead
 *   process's directory. Costs one platform call — the same batched fetch an
 *   uncached tick already pays.
 * @returns {Promise<void>}
 * @since v0.5.0
 */
async function annotateWorkingDirs(agents, opts = {}) {
  if (agents.length === 0) return;

  const forceRefresh = opts.forceRefresh === true;
  const now = Date.now();
  _pruneStale(cwdCache, CWD_CACHE_TTL, now);

  // One cache key per agent, resolved once, via the same `_agentName` the
  // parent-chain cache keys on, plus the witness THAT RECORD carries. pid ≤ 0 is
  // not an OS process, so it has no generation — undefined leaves the synthetics on
  // the plain TTL contract.
  const entries = agents.map((a) => ({
    agent: a,
    key: _cacheKey(a.pid, _agentName(a)),
    witness: _providesStartTime && a.pid > 0 ? _recordWitness(a) : undefined,
  }));

  // Pids with no live, generation-proven cache entry. Agents can share a pid (the
  // pid-0 synthetics all do) while holding distinct keys, so the Set both collects
  // and deduplicates — one platform lookup per pid, in first-seen order.
  const uncachedPids = new Set();
  for (const e of entries) {
    const cached = forceRefresh ? null : cwdCache.get(e.key);
    const fresh = cached && now - cached.timestamp <= CWD_CACHE_TTL;
    const proven =
      e.witness === undefined ||
      (e.witness !== null &&
        cached &&
        cached.witness === e.witness.value &&
        cached.witnessSource === e.witness.source);
    if (fresh && proven) continue;
    uncachedPids.add(e.agent.pid);
  }

  // Single batched call for all uncached PIDs.
  const batchResults = uncachedPids.size > 0 ? await _getProcessCwds([...uncachedPids]) : null;

  // The fetched result is written back per AGENT, not per pid — the pid alone can
  // no longer reconstruct the cache key — and each entry is annotated in the same
  // pass, reading the value just written.
  for (const e of entries) {
    if (batchResults && uncachedPids.has(e.agent.pid)) {
      cwdCache.set(e.key, {
        cwd: batchResults.get(e.agent.pid) || null,
        // The witness this directory was read under. `undefined` (no generation
        // established) stores as null, which no established witness ever matches
        // — a value fetched without a proof never becomes one.
        witness: e.witness ? e.witness.value : null,
        witnessSource: e.witness ? e.witness.source : null,
        timestamp: now,
      });
    }
    const cached = cwdCache.get(e.key);
    const cwd = cached ? cached.cwd : null;
    e.agent.cwd = cwd;
    e.agent.projectName = cwd ? path.basename(cwd) : null;
  }
}

module.exports = {
  getParentChains,
  enrichWithParentChains,
  annotateHostApps,
  annotateWorkingDirs,
  _setPlatformForTest,
  _resetForTest,
};
