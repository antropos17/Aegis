/**
 * @file attribution.js
 * @module main/attribution
 * @description Attribution status + evidence for file events — answers ONE
 *   question: how do we know which agent a file event belongs to.
 *
 *   Three statuses, a CLOSED list of evidence codes (see {@link EVIDENCE_CODES} —
 *   only codes in that registry are accepted), and deliberately NO numeric
 *   confidence anywhere. A score invites "0.7 is probably fine" reasoning where
 *   the honest answer is a hard three-way distinction: resolved from a PID
 *   (`confirmed`), guessed from a path (`inferred`), or unknown (`unattributed`).
 *   An unattributed event keeps no agent at all — substituting one would poison
 *   that agent's baselines, risk score and audit trail (C-01).
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.11.0
 */
'use strict';

/**
 * Closed list of evidence codes. Nothing outside this list may appear in an
 * event's `attribution.evidence` — {@link deriveStatus} throws on an unknown
 * code so a typo can never silently degrade an event into `unattributed`.
 *
 * PID-backed (→ `confirmed`):
 * - `rm-holder-pid` — Restart Manager reported this PID as holding the resource.
 * - `handle-scan-pid` — the per-PID handle scan was run FOR this agent's pid.
 * - `os-tcp-owner-pid` — the OS connection table reported this PID as owning the socket
 *   (`Get-NetTCPConnection -OwningProcess` on win32, `lsof` on POSIX) and that PID was in
 *   the same scan tick's agent snapshot. Same strength as `handle-scan-pid`: both are
 *   kernel-reported PID observations. The same-tick constraint holds by construction —
 *   network-monitor builds its pid map from the agents passed into the very same call —
 *   which is what keeps a recycled pid from being credited to a dead agent.
 *
 * Heuristic (→ `inferred`):
 * - `self-config-path` — the path matches this agent's OWN config dir.
 * - `cwd-containment` — the path lies inside this agent's working directory.
 *
 * Negative (→ `unattributed`):
 * - `no-owner-match` — no self-config and no cwd containment matched any AI agent.
 * - `no-ai-agents-online` — no AI-category agent was online to own the event.
 * - `population-unavailable` — the process sensor could not vouch for the agent
 *   population at this instant, so no owner was even looked for. Deliberately NOT
 *   `no-ai-agents-online` (which asserts nobody was online — possibly false, the
 *   population is UNKNOWN, not empty) and not `no-owner-match` (which asserts a
 *   match was attempted and failed). The path observation itself stays valid: what
 *   is unavailable is the list of candidate owners, not the event.
 * @type {Readonly<Object<string, string>>}
 * @since v0.11.0
 */
const EVIDENCE = Object.freeze({
  RM_HOLDER_PID: 'rm-holder-pid',
  HANDLE_SCAN_PID: 'handle-scan-pid',
  OS_TCP_OWNER_PID: 'os-tcp-owner-pid',
  SELF_CONFIG_PATH: 'self-config-path',
  CWD_CONTAINMENT: 'cwd-containment',
  NO_OWNER_MATCH: 'no-owner-match',
  NO_AI_AGENTS_ONLINE: 'no-ai-agents-online',
  POPULATION_UNAVAILABLE: 'population-unavailable',
});

/**
 * Every legal evidence code, in declaration order.
 *
 * The `AttributionEvidence` union in src/shared/types/events.ts mirrors the first
 * SEVEN codes. `population-unavailable` is **not yet in that union** — the typed
 * mirror is the second half of gap S in the app-state design and ships in the pass
 * that is allowed to edit `src/shared/`. Nothing breaks meanwhile: the renderer
 * switches on `attribution.status`, never on an individual code, and the write path
 * is guarded by {@link deriveStatus} rather than by the union. State it here rather
 * than let the old blanket "mirrors the union" sentence claim a parity that stopped
 * holding (ai-mistakes #27).
 * @type {ReadonlyArray<string>}
 * @since v0.11.0
 */
const EVIDENCE_CODES = Object.freeze(Object.values(EVIDENCE));

/** @type {Set<string>} Lookup set for the closed-list check. */
const KNOWN_CODES = new Set(EVIDENCE_CODES);

/**
 * Human-facing label for an event with no known owner (`agent: ''`). Used
 * wherever a main-process surface shows the name to a PERSON — tray body, CSV,
 * HTML report, LLM prompt — so a blank never reads as a formatting bug.
 *
 * NOT for machine-readable output: a JSON export must keep the raw empty `agent`
 * plus the attribution status, otherwise a downstream tool would group real
 * activity under a fabricated agent name.
 *
 * The renderer keeps its own copy in lib/utils/grouped-feed-utils.ts — main is
 * CJS and the renderer never imports from src/main, so the string cannot be
 * shared across the process boundary. Keep the two in sync.
 * @type {string}
 * @since v0.11.0
 */
const UNKNOWN_SOURCE_LABEL = 'Unknown source';

/** @type {Set<string>} PID-backed codes — any one of them means `confirmed`. */
const PID_EVIDENCE = new Set([
  EVIDENCE.RM_HOLDER_PID,
  EVIDENCE.HANDLE_SCAN_PID,
  EVIDENCE.OS_TCP_OWNER_PID,
]);

/** @type {Set<string>} Heuristic codes — any one of them means `inferred`. */
const HEURISTIC_EVIDENCE = new Set([EVIDENCE.SELF_CONFIG_PATH, EVIDENCE.CWD_CONTAINMENT]);

/**
 * Derive the attribution status from a list of evidence codes.
 *
 * PID beats heuristic: an event whose agent came from a holder PID stays
 * `confirmed` even when `self-config-path` is also present — that second code
 * only documents WHY the self-access exemption applied, it does not weaken the
 * PID proof.
 * @param {string[]} evidence - One or more codes from {@link EVIDENCE_CODES}.
 * @returns {string} `'confirmed'` | `'inferred'` | `'unattributed'`.
 * @throws {Error} When evidence is not a non-empty array, or carries a code
 *   outside the closed list.
 * @since v0.11.0
 */
function deriveStatus(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('attribution: evidence must be a non-empty array');
  }
  for (const code of evidence) {
    if (!KNOWN_CODES.has(code)) {
      throw new Error(`attribution: unknown evidence code "${code}"`);
    }
  }
  if (evidence.some((c) => PID_EVIDENCE.has(c))) return 'confirmed';
  if (evidence.some((c) => HEURISTIC_EVIDENCE.has(c))) return 'inferred';
  return 'unattributed';
}

/**
 * Build the `attribution` object stamped onto a file event. The evidence array is
 * copied so a caller's mutable working array can never leak into the event.
 * @param {string[]} evidence - One or more codes from {@link EVIDENCE_CODES}.
 * @returns {{status: string, evidence: string[]}}
 * @throws {Error} Propagated from {@link deriveStatus} on invalid evidence.
 * @since v0.11.0
 */
function makeAttribution(evidence) {
  return { status: deriveStatus(evidence), evidence: [...evidence] };
}

module.exports = {
  EVIDENCE,
  EVIDENCE_CODES,
  UNKNOWN_SOURCE_LABEL,
  deriveStatus,
  makeAttribution,
};
