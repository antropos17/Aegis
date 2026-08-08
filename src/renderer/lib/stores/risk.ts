/**
 * @file risk.ts — Derived store: agents enriched with risk scores + trust grades
 * @module renderer/stores/risk
 * @since 0.2.0
 */

import { derived } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { agents, events, anomalies, network, falsePositives } from './ipc.js';
import { calculateRiskScore, getTrustGrade, getTimeDecayWeight } from '../utils/risk-scoring.js';
import type {
  FileEvent,
  NetworkConnection,
  NetworkVerdict,
  EnrichedAgent,
  RiskScoreInput,
  TrustGrade,
} from '../../../shared/types';

/** Known API domain patterns for API-call indicator */
const API_DOMAIN_PATTERNS: readonly RegExp[] = [
  /^api\./i,
  /api\.openai\.com$/i,
  /api\.anthropic\.com$/i,
  /api\.github\.com$/i,
  /api\.groq\.com$/i,
  /api\.cohere\.ai$/i,
  /api\.mistral\.ai$/i,
  /generativelanguage\.googleapis\.com$/i,
  /api\.together\.xyz$/i,
  /api\.replicate\.com$/i,
];

/**
 * Check if a domain is a known API endpoint.
 * @param domain - Domain string to test
 * @returns true if domain matches a known API pattern
 */
function isApiDomain(domain: string): boolean {
  return API_DOMAIN_PATTERNS.some((p) => p.test(domain));
}

/**
 * The verdict to score one connection under.
 *
 * The fallback covers records the classifier never saw — demo pools and scans cached by an
 * older build — and reads exactly the rule NetworkPanel's `classify()` uses: a name that was
 * not recognized IS the flagged case, and no name at all is `unknown`, not an accusation.
 * A record with `flagged: false` and no verdict was allowlisted by the old boolean, so it
 * contributes to neither count.
 * @param conn - Network connection, with or without a verdict
 * @returns The verdict to score this connection under
 */
function scoringVerdict(conn: NetworkConnection): NetworkVerdict {
  if (conn.verdict) return conn.verdict;
  if (!conn.flagged) return 'allowlisted';
  return conn.domain ? 'flagged' : 'unknown';
}

/**
 * The DURABLE key an agent's saved permissions live under. Deliberately built from
 * name + cwd + parentEditor, and deliberately NOT migrated to `instanceId`.
 *
 * DO NOT "FIX" THIS TO USE `instanceId`. It mirrors `getInstanceKey()` in
 * main/config-manager.js byte for byte, and the string it returns is a key inside
 * `agentPermissions` in settings.json — it outlives the process it names. `instanceId`
 * is per-boot (`pid:startTime`), so writing one here would persist a key that can never
 * match again, orphaning every saved permission on the next launch. Worse, with `cwd`
 * and `parentEditor` both null, PermissionsGrid.save() takes its `saveAgentPermissions`
 * branch and would write that per-boot key straight into settings.json.
 *
 * Correlating events to an agent is a DIFFERENT question with a different key — see
 * `byInstance` below. This one answers "whose settings are these", not "who did that".
 * IDENTITY-RECON.md §6 step 6.
 * @param name - Agent name
 * @param parentEditor - Parent editor name or null
 * @param cwd - Working directory or null
 * @returns Composite instance key
 */
function instanceKey(name: string, parentEditor: string | null, cwd: string | null): string {
  if (cwd) return `${name}::${cwd}`;
  if (parentEditor) return `${name}::${parentEditor}`;
  return name;
}

/**
 * Enriched agents store — derives from agents, events, anomalies, network.
 * Each agent object gets: name, instanceId, instanceKey, sensitiveFiles, unknownDomains,
 * anomalyScore, riskScore, trustGrade, fileCount, networkCount.
 *
 * Risk is calculated per process INSTANCE, correlated on the canonical `instanceId`
 * stamped by the main process — not on the agent name, and not on a key rebuilt from
 * cwd/parentEditor (see `byInstance` below).
 *
 * ONE EXCEPTION, and it is not an oversight: `anomalyScore` is still read as
 * `$anomalies[name]`, because the main process builds that map per NAME
 * (scan-loop.js `scores[a.agent]` over `baselines.js` `sessionData[agentName]`). Two
 * instances of one agent therefore still share the anomaly term of their score.
 * IDENTITY-RECON.md §5 C2 — closing it is step 7 and lives in main.
 */
let _prevAgents: unknown = null;
let _prevEvents: unknown = null;
let _prevAnomalies: unknown = null;
let _prevNetwork: unknown = null;
let _prevFp: unknown = null;
let _cachedResult: EnrichedAgent[] = [];

export const enrichedAgents: Readable<EnrichedAgent[]> = derived(
  [agents, events, anomalies, network, falsePositives],
  ([$agents, $events, $anomalies, $network, $fp]) => {
    // Reference equality cache — skip recompute if all inputs unchanged
    if (
      $agents === _prevAgents &&
      $events === _prevEvents &&
      $anomalies === _prevAnomalies &&
      $network === _prevNetwork &&
      $fp === _prevFp
    ) {
      return _cachedResult;
    }
    _prevAgents = $agents;
    _prevEvents = $events;
    _prevAnomalies = $anomalies;
    _prevNetwork = $network;
    _prevFp = $fp;

    const allEvents: FileEvent[] = $events.flat();

    // ═══ THE CORRELATION KEY ═══
    //
    // Both maps are keyed on the canonical `instanceId` the main process stamped
    // (main/process-identity.js), READ off the record — never a key rebuilt here from
    // name, cwd or parentEditor. A rebuilt key is what collision C1 was: on Windows
    // `cwd` is routinely null, so two Claude Code instances in two different projects
    // produced the identical key and each was scored on BOTH event sets — one project's
    // .ssh access raised the other project's card (IDENTITY-RECON.md §5).
    //
    // POLICY FOR A MISSING KEY (`instanceId` null on a record, or on an agent):
    // quarantine, no fallback. A record with no key enters NO bucket and is joined to
    // NOBODY — not by name, not by pid. Falling back to the name is precisely the
    // collision this store just removed, and attributing an action to the wrong instance
    // is worse than attributing it to none (shared/types/events.ts `FileEvent.instanceId`,
    // ai-mistakes.md #19). An agent whose own `instanceId` is null likewise gets an empty
    // list rather than a namesake's events.
    //
    // Quarantined does NOT mean hidden. The Activity feed and the Timeline read `$events`
    // and `$network` directly and group by `ev.agent` (utils/grouped-feed-utils.ts
    // `groupByAgent`, utils/timeline-utils.ts), so such a record is still listed and still
    // counted there. What it stops doing is moving an agent's riskScore — the one thing it
    // has no grounds to do.
    //
    // Reachable today for: unattributed events (no owner → no key, by construction), and
    // owners that no stamp site reached (the `attachModels` pid-0 synthetics).
    const eventsByInstance = new Map<string, FileEvent[]>();
    for (const ev of allEvents) {
      // An unattributed event belongs to no agent, so it must not raise anyone's
      // sensitiveFiles / riskScore / trustGrade. Checked by STATUS, not by falsy
      // agent/pid: the intent has to be readable and independently testable.
      if (ev.attribution?.status === 'unattributed') continue;
      if (ev.selfAccess) continue;
      if (!ev.instanceId) continue;
      let arr = eventsByInstance.get(ev.instanceId);
      if (!arr) {
        arr = [];
        eventsByInstance.set(ev.instanceId, arr);
      }
      arr.push(ev);
    }

    const connsByInstance = new Map<string, NetworkConnection[]>();
    for (const conn of $network) {
      if (!conn.instanceId) continue;
      let arr = connsByInstance.get(conn.instanceId);
      if (!arr) {
        arr = [];
        connsByInstance.set(conn.instanceId, arr);
      }
      arr.push(conn);
    }

    // Pre-build false-positive name set
    const fpNames = new Set<string>($fp.map((fp) => fp.agentName));

    _cachedResult = $agents.map((raw): EnrichedAgent => {
      const name = raw.agent;
      const parentEditor = raw.parentEditor || null;
      const cwd = raw.cwd || null;
      const projectName = raw.projectName || null;
      const iKey = instanceKey(name, parentEditor, cwd);
      // Read, never derive: the value must be the identical string this agent carried in
      // `scan-batch`, or the join lands on a different instance (ai-mistakes.md #19).
      const instanceId = raw.instanceId || null;

      // Direct lookup on the canonical key — no pid branch, no name branch, no refinement
      // by parentEditor. An agent with no key of its own correlates to nothing.
      const candidateEvents: FileEvent[] = instanceId ? eventsByInstance.get(instanceId) || [] : [];

      let sensitiveFiles = 0;
      let configFiles = 0;
      let sshAwsFiles = 0;
      let fileCount = 0;
      const seen = new Map<string, number>();

      for (const ev of candidateEvents) {
        if (ev.selfAccess) continue;
        if (ev.file) {
          const prev = seen.get(ev.file);
          if (prev && ev.timestamp - prev < 30000) continue;
          seen.set(ev.file, ev.timestamp);
        }
        const w = getTimeDecayWeight(ev.timestamp);
        fileCount += w;
        if (ev.sensitive) sensitiveFiles += w;
        if (ev.reason?.startsWith('AI agent config')) configFiles += w;
        if (/SSH|AWS/i.test(ev.reason)) sshAwsFiles += w;
      }

      // Same direct lookup for network connections.
      const candidateConns: NetworkConnection[] = instanceId
        ? connsByInstance.get(instanceId) || []
        : [];

      // Two disjoint counts, not one bucket: an endpoint that resolved and is on no
      // allowlist is a different claim from one nobody could identify, and risk scoring
      // weighs them differently. `conn.flagged` alone cannot tell them apart.
      let flaggedDomains = 0;
      let unknownDomains = 0;
      let networkCount = 0;
      let httpUnencryptedCount = 0;
      let hasApiCalls = false;
      for (const conn of candidateConns) {
        networkCount++;
        const verdict = scoringVerdict(conn);
        if (verdict === 'flagged') flaggedDomains++;
        else if (verdict === 'unknown') unknownDomains++;
        if (conn.httpUnencrypted) httpUnencryptedCount++;
        if (conn.domain && isApiDomain(conn.domain)) hasApiCalls = true;
      }

      const anomalyScore = $anomalies[name] || 0;
      const riskInput: RiskScoreInput = {
        sensitiveFiles,
        configFiles,
        sshAwsFiles,
        networkCount,
        flaggedDomains,
        unknownDomains,
        fileCount,
        httpUnencryptedCount,
      };
      let riskScore: number = calculateRiskScore(riskInput);
      if (fpNames.has(name)) riskScore = Math.max(0, riskScore - 20);
      const trustGrade = getTrustGrade(riskScore) as TrustGrade;

      return {
        ...raw,
        name,
        parentEditor,
        cwd,
        projectName,
        // Both keys are published, and they answer different questions: `instanceId` is
        // the per-boot correlation key this store matched events on, `instanceKey` is the
        // durable one PermissionsGrid saves under.
        instanceId,
        instanceKey: iKey,
        sensitiveFiles,
        // The published field keeps the meaning it always had — "endpoints not confirmed
        // as allowlisted" — so the split changes scoring only, not what consumers read.
        unknownDomains: flaggedDomains + unknownDomains,
        anomalyScore,
        riskScore,
        trustGrade,
        fileCount,
        networkCount,
        hasApiCalls,
      };
    });
    return _cachedResult;
  },
);
