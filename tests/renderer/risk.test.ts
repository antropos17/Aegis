import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// stores/ipc.ts reads `window.aegis` at module load (and would start demo-mode
// timers in a browserless env), so its input stores are replaced with plain
// writables. The factory is self-contained — it must not close over module-scope
// bindings, because vi.mock is hoisted above the imports below.
vi.mock('../../src/renderer/lib/stores/ipc.js', async () => {
  const { writable } = await import('svelte/store');
  return {
    agents: writable([]),
    events: writable([]),
    anomalies: writable({}),
    network: writable([]),
    falsePositives: writable([]),
  };
});

import { enrichedAgents } from '../../src/renderer/lib/stores/risk.js';
import { eventsByInstance } from '../../src/renderer/lib/stores/events-index.js';
import {
  buildUnifiedEvents,
  groupByAgent,
  type FeedEvent,
} from '../../src/renderer/lib/utils/grouped-feed-utils.js';
import * as ipc from '../../src/renderer/lib/stores/ipc.js';

const inputs = ipc as unknown as {
  agents: { set: (v: unknown[]) => void };
  events: { set: (v: unknown[]) => void };
  anomalies: { set: (v: Record<string, number>) => void };
  network: { set: (v: unknown[]) => void };
  falsePositives: { set: (v: unknown[]) => void };
};

const NOW = Date.now();

/**
 * The canonical instance keys these fixtures correlate on — `pid:startTime`, value space 1
 * of main/process-identity.js. Every agent and every event/connection that belongs to it
 * carries the SAME string, because that is the only thing the risk store joins on now: a
 * fixture that lets the pid or the name imply the join would pass for the wrong reason.
 */
const CLAUDE_ID = '100:1754380000000';
const OPENCODE_ID = '200:1754380044000';
/** A SECOND Claude Code — same name, same executable, different process. The C1 case. */
const SECOND_CLAUDE_ID = '200:1754380090000';

/** A confirmed, non-sensitive file event owned by Claude Code (pid 100). */
function fileEvent(over: Record<string, unknown> = {}) {
  return {
    agent: 'Claude Code',
    pid: 100,
    instanceId: CLAUDE_ID,
    parentEditor: null,
    cwd: '/home/user/a',
    file: '/home/user/a/src/index.js',
    sensitive: false,
    selfAccess: false,
    reason: '',
    action: 'modified',
    timestamp: NOW,
    category: 'ai',
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
    ...over,
  };
}

/** An unattributed event: no owner, so agent '', pid null AND instanceId null (C-01). */
function unattributed(over: Record<string, unknown> = {}) {
  return fileEvent({
    agent: '',
    pid: null,
    instanceId: null,
    cwd: null,
    category: 'other',
    file: '/home/user/.ssh/id_rsa',
    sensitive: true,
    reason: 'SSH keys/config',
    attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    ...over,
  });
}

const TWO_AGENTS = [
  { agent: 'Claude Code', pid: 100, instanceId: CLAUDE_ID, cwd: '/home/user/a', category: 'ai' },
  { agent: 'opencode', pid: 200, instanceId: OPENCODE_ID, cwd: '/home/user/b', category: 'ai' },
];

/** Per-agent risk figures — the numbers an unattributed event must never move. */
function riskShape() {
  return get(enrichedAgents).map((a) => ({
    name: a.name,
    sensitiveFiles: a.sensitiveFiles,
    riskScore: a.riskScore,
    trustGrade: a.trustGrade,
    fileCount: a.fileCount,
  }));
}

beforeEach(() => {
  inputs.agents.set([]);
  inputs.events.set([]);
  inputs.anomalies.set({});
  inputs.network.set([]);
  inputs.falsePositives.set([]);
});

describe('risk store — enrichedAgents', () => {
  it('case 11: a confirmed sensitive event raises risk for THAT agent only', () => {
    inputs.agents.set(TWO_AGENTS);
    inputs.events.set([
      [
        fileEvent({
          file: '/home/user/a/.env',
          sensitive: true,
          reason: 'Environment variables',
        }),
      ],
    ]);

    const [claude, opencode] = get(enrichedAgents);
    expect(claude.name).toBe('Claude Code');
    expect(claude.sensitiveFiles).toBeGreaterThan(0);
    expect(claude.riskScore).toBeGreaterThan(0);
    expect(opencode.name).toBe('opencode');
    expect(opencode.sensitiveFiles).toBe(0);
    expect(opencode.riskScore).toBe(0);
    expect(opencode.trustGrade).toBe('A+');
  });

  it('case 9: an unattributed sensitive event changes nothing for anybody', () => {
    const attributed = [
      fileEvent({ file: '/home/user/a/src/a.js' }),
      fileEvent({
        agent: 'opencode',
        pid: 200,
        instanceId: OPENCODE_ID,
        cwd: '/home/user/b',
        file: '/home/user/b/b.js',
      }),
    ];

    inputs.agents.set(TWO_AGENTS);
    inputs.events.set([attributed]);
    const before = riskShape();

    // Same stream plus an unattributed hit on a real secret.
    inputs.events.set([[...attributed, unattributed()]]);
    const after = riskShape();

    expect(after).toEqual(before);
    for (const a of after) {
      expect(a.sensitiveFiles).toBe(0);
      expect(a.riskScore).toBe(0);
    }
  });

  it('case 10: an unattributed event never lands on a synthetic pid-0 agent', () => {
    // WSL-inner agents and local LLM runtimes are registered with pid 0.
    inputs.agents.set([
      { agent: 'grok', pid: 0, instanceId: '0:grok', category: 'ai' },
      { agent: 'Ollama', pid: 0, instanceId: '0:ollama', category: 'local-llm-runtime' },
    ]);
    inputs.events.set([
      [
        unattributed({ file: '/home/user/.aws/credentials', reason: 'AWS credentials' }),
        // Belt and braces: even if an unattributed event ever carried pid 0
        // instead of null, the status check must still keep it out.
        unattributed({ pid: 0, file: '/home/user/.ssh/id_ed25519' }),
      ],
    ]);

    const enriched = get(enrichedAgents);
    expect(enriched).toHaveLength(2);
    for (const a of enriched) {
      expect(a.sensitiveFiles).toBe(0);
      expect(a.fileCount).toBe(0);
      expect(a.riskScore).toBe(0);
      expect(a.trustGrade).toBe('A+');
    }
  });

  it('case 12: selfAccess events stay excluded (pre-existing invariant)', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    inputs.events.set([
      [
        fileEvent({
          file: '/home/user/.claude/settings.json',
          selfAccess: true,
          reason: 'AI agent config — Claude Code',
          attribution: { status: 'confirmed', evidence: ['handle-scan-pid', 'self-config-path'] },
        }),
      ],
    ]);

    const [claude] = get(enrichedAgents);
    expect(claude.fileCount).toBe(0);
    expect(claude.sensitiveFiles).toBe(0);
    expect(claude.riskScore).toBe(0);
  });

  it('an inferred event counts on equal terms with a confirmed one', () => {
    inputs.agents.set([TWO_AGENTS[1]]);
    inputs.events.set([
      [
        fileEvent({
          agent: 'opencode',
          pid: 200,
          instanceId: OPENCODE_ID,
          cwd: '/home/user/b',
          file: '/home/user/b/.env',
          sensitive: true,
          reason: 'Environment variables',
          attribution: { status: 'inferred', evidence: ['cwd-containment'] },
        }),
      ],
    ]);

    const [opencode] = get(enrichedAgents);
    expect(opencode.sensitiveFiles).toBeGreaterThan(0);
    expect(opencode.riskScore).toBeGreaterThan(0);
  });

  it('events with no attribution field (pre-v0.11.0) are still counted', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    const legacy: Record<string, unknown> = fileEvent({
      file: '/home/user/a/.env',
      sensitive: true,
      reason: 'Environment variables',
    });
    delete legacy.attribution;
    inputs.events.set([[legacy]]);

    const [claude] = get(enrichedAgents);
    expect(claude.sensitiveFiles).toBeGreaterThan(0);
  });
});

describe('risk store — two instances of one agent (C1)', () => {
  // WAS KNOWN-RED, NOW GREEN — collision C1 in docs/current-state/IDENTITY-RECON.md §5,
  // closed by migration step 5: the risk store's correlation moved from
  // eventsByPid/eventsByName + connsByPid/connsByName to a single byInstance map keyed on
  // the canonical `instanceId`, and the `hasCwd && raw.pid ? … : …` selectors became a
  // direct byInstance.get(). This is the assertion the whole identity migration exists to
  // make true; it was written first and failing, and it is now met.
  //
  // ONE ASSERTION MOVED, AND ONLY ONE. It used to read `instanceB.instanceKey !==
  // instanceA.instanceKey`; it now reads the same claim off `instanceId`. `instanceKey` is
  // the DURABLE permissions key (`name::cwd`, mirror of main/config-manager.js), which
  // step 6 deliberately keeps — and with cwd and parentEditor both null,
  // PermissionsGrid.save() would have written a per-boot key into settings.json. The two
  // assertions that carry this test's title — separate `sensitiveFiles`, separate
  // `riskScore` — are unchanged.
  it('C1: two Claude Code instances in different projects get separate risk histories', () => {
    // Both records report `cwd: null`, and that IS the C1 precondition, not a
    // convenience: on Windows `getProcessCwds` returns null whenever the working
    // directory is not extractable, and `annotateWorkingDirs` then writes null.
    // The two instances ARE in different projects — only the observation of that
    // fact is missing. Nothing derived from name, cwd or parentEditor can tell them
    // apart here; only the stamped `instanceId` can, which is the point.
    inputs.agents.set([
      {
        agent: 'Claude Code',
        pid: 100,
        instanceId: CLAUDE_ID,
        cwd: null,
        parentEditor: null,
        category: 'ai',
      },
      {
        agent: 'Claude Code',
        pid: 200,
        instanceId: SECOND_CLAUDE_ID,
        cwd: null,
        parentEditor: null,
        category: 'ai',
      },
    ]);
    // The same agent NAME on both event sets is what used to put them in one bucket —
    // varying it would make the test pass for the wrong reason. Distinct file
    // paths, so the 30s same-path dedup eats nothing. Each event carries the
    // instanceId of the process that produced it.
    inputs.events.set([
      [
        fileEvent({
          pid: 100,
          instanceId: CLAUDE_ID,
          cwd: '/home/user/project-a',
          file: '/home/user/project-a/.ssh/id_rsa',
          sensitive: true,
          reason: 'SSH keys/config',
        }),
        fileEvent({
          pid: 200,
          instanceId: SECOND_CLAUDE_ID,
          cwd: '/home/user/project-b',
          file: '/home/user/project-b/src/main.js',
        }),
      ],
    ]);

    const enriched = get(enrichedAgents);
    // Setup invariants. If one of them fails, the test is red for the wrong reason
    // and the assertions below prove nothing.
    expect(enriched).toHaveLength(2);
    const [instanceA, instanceB] = enriched;
    expect(instanceA.pid).toBe(100);
    expect(instanceB.pid).toBe(200);
    expect(instanceA.sensitiveFiles).toBeGreaterThan(0);
    expect(instanceA.riskScore).toBeGreaterThan(0);

    // Soft, so one run reports BOTH pinned sites rather than aborting on the first.
    expect.soft(instanceB.instanceId).not.toBe(instanceA.instanceId);
    expect.soft(instanceB.sensitiveFiles).toBe(0);
    expect.soft(instanceB.riskScore).not.toBe(instanceA.riskScore);

    // And the durable key is still the SHARED one — not a regression, the design:
    // permissions saved for "Claude Code" with no readable cwd apply to both, and
    // migrating that key would orphan every saved permission on the next launch
    // (IDENTITY-RECON.md §6 step 6).
    expect(instanceA.instanceKey).toBe('Claude Code');
    expect(instanceB.instanceKey).toBe('Claude Code');
  });
});

/** One connection owned by Claude Code (pid 100), allowlisted unless overridden. */
function conn(over: Record<string, unknown> = {}) {
  return {
    agent: 'Claude Code',
    pid: 100,
    instanceId: CLAUDE_ID,
    parentEditor: null,
    cwd: '/home/user/a',
    category: 'ai',
    remoteIp: '203.0.113.10',
    remotePort: 443,
    domain: 'api.anthropic.com',
    state: 'ESTABLISHED',
    flagged: false,
    verdict: 'allowlisted',
    verdictReason: 'domain-allowlist',
    httpUnencrypted: false,
    userAgent: 'claude',
    ...over,
  };
}

/** `n` copies of one connection shape, on distinct ports so nothing looks deduplicable. */
function repeat(n: number, over: Record<string, unknown>) {
  return Array.from({ length: n }, (_, i) => conn({ ...over, remotePort: 40000 + i }));
}

/** The risk score of the single enriched agent, for a given network snapshot. */
function scoreFor(connections: unknown[]) {
  inputs.agents.set([TWO_AGENTS[0]]);
  inputs.network.set(connections);
  return get(enrichedAgents)[0].riskScore;
}

const FLAGGED = { flagged: true, verdict: 'flagged', verdictReason: 'domain-not-allowlisted' };
const UNKNOWN = {
  flagged: true,
  verdict: 'unknown',
  verdictReason: 'ptr-missing',
  domain: '',
};

describe('risk store — flagged vs unknown endpoints', () => {
  it('N flagged endpoints score higher than the same N unknown ones', () => {
    // One endpoint each, then two: below the shared ceiling the difference is visible.
    expect(scoreFor(repeat(1, FLAGGED))).toBeGreaterThan(scoreFor(repeat(1, UNKNOWN)));
    expect(scoreFor(repeat(2, FLAGGED))).toBeGreaterThan(scoreFor(repeat(2, UNKNOWN)));
  });

  it('an unknown endpoint still raises risk — absence of a name is not free', () => {
    expect(scoreFor(repeat(1, UNKNOWN))).toBeGreaterThan(scoreFor(repeat(1, {})));
  });

  it('an allowlisted endpoint adds no endpoint risk, only connection count', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    inputs.network.set(repeat(2, {}));
    const [claude] = get(enrichedAgents);
    expect(claude.networkCount).toBe(2);
    expect(claude.unknownDomains).toBe(0);
  });

  it('unknownDomains stays the total of both verdicts', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    inputs.network.set([...repeat(2, FLAGGED), ...repeat(3, UNKNOWN), ...repeat(1, {})]);
    const [claude] = get(enrichedAgents);
    expect(claude.unknownDomains).toBe(5);
    expect(claude.networkCount).toBe(6);
  });

  it('the endpoint factor still cannot exceed its ceiling at high counts', () => {
    // 50 + 50 endpoints: the endpoint factor caps at 20, the connection-count factor at
    // 10, and nothing else is fed — so a split count cannot outscore a single one.
    const mixed = scoreFor([...repeat(50, FLAGGED), ...repeat(50, UNKNOWN)]);
    const allFlagged = scoreFor(repeat(100, FLAGGED));
    expect(mixed).toBe(allFlagged);
    expect(mixed).toBe(30);
  });

  it('records with no verdict still score: name → flagged, no name → unknown', () => {
    const noVerdict = { verdict: undefined, verdictReason: undefined };
    const legacyFlagged = repeat(2, { ...noVerdict, flagged: true, domain: 'tracker.example' });
    const legacyUnknown = repeat(2, { ...noVerdict, flagged: true, domain: '' });
    const legacySafe = repeat(2, { ...noVerdict, flagged: false });

    const flaggedScore = scoreFor(legacyFlagged);
    const unknownScore = scoreFor(legacyUnknown);
    const safeScore = scoreFor(legacySafe);

    expect(Number.isFinite(flaggedScore)).toBe(true);
    expect(Number.isFinite(unknownScore)).toBe(true);
    expect(flaggedScore).toBeGreaterThan(unknownScore);
    expect(unknownScore).toBeGreaterThan(safeScore);
    // A legacy record scores exactly like the verdict it falls back to.
    expect(flaggedScore).toBe(scoreFor(repeat(2, FLAGGED)));
    expect(unknownScore).toBe(scoreFor(repeat(2, UNKNOWN)));
  });

  it('a record with neither verdict nor flagged produces a number, not NaN', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    // instanceId is present because this test is about SCORING a half-empty record, not
    // about correlation — without it the record would be quarantined and score nothing,
    // and the test would pass while checking something else entirely.
    inputs.network.set([
      {
        agent: 'Claude Code',
        pid: 100,
        instanceId: CLAUDE_ID,
        remoteIp: '203.0.113.9',
        remotePort: 443,
      },
    ]);
    const [claude] = get(enrichedAgents);
    expect(Number.isNaN(claude.riskScore)).toBe(false);
    expect(claude.riskScore).toBe(1);
    expect(claude.unknownDomains).toBe(0);
  });
});

describe('risk store — the missing-instanceId policy', () => {
  // The policy is stated at `byInstance` in stores/risk.ts: a record with no instanceId
  // is quarantined — it joins NOBODY, and it does not vanish from the UI. Both halves are
  // asserted here, because either one alone is a different (and wrong) design: dropping
  // the record hides activity, and falling back to the name is collision C1 again.

  /** A sensitive event with a real owner NAME and pid, but no instance key. */
  function unkeyed(over: Record<string, unknown> = {}) {
    return fileEvent({
      instanceId: null,
      file: '/home/user/a/.ssh/id_rsa',
      sensitive: true,
      reason: 'SSH keys/config',
      ...over,
    });
  }

  it('a file event with no instanceId raises nobody, not even its named owner', () => {
    inputs.agents.set(TWO_AGENTS);
    inputs.events.set([[unkeyed()]]);

    // Under the old name branch this event would have landed on 'Claude Code'.
    for (const a of get(enrichedAgents)) {
      expect(a.sensitiveFiles).toBe(0);
      expect(a.fileCount).toBe(0);
      expect(a.riskScore).toBe(0);
      expect(a.trustGrade).toBe('A+');
    }
  });

  it('the quarantined event is still visible in the activity feed', () => {
    // The other half of the policy, checked on the path the UI actually renders
    // (GroupedFeed reads $events directly, not the correlation map).
    const ev = unkeyed();
    const feed = buildUnifiedEvents([[ev] as unknown as FeedEvent[]], []);
    const groups = groupByAgent(feed, [{ name: 'Claude Code' }]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Claude Code');
    expect(groups[0].count).toBe(1);
  });

  it('a network connection with no instanceId scores for nobody', () => {
    inputs.agents.set([TWO_AGENTS[0]]);
    inputs.network.set(repeat(3, { ...FLAGGED, instanceId: null }));

    const [claude] = get(enrichedAgents);
    expect(claude.networkCount).toBe(0);
    expect(claude.unknownDomains).toBe(0);
    expect(claude.riskScore).toBe(0);
  });

  it('an agent with no instanceId gets an empty history, not a namesake’s', () => {
    inputs.agents.set([
      TWO_AGENTS[0],
      // Same display name, no key of its own — the `attachModels` case.
      { agent: 'Claude Code', pid: 300, cwd: null, parentEditor: null, category: 'ai' },
    ]);
    inputs.events.set([
      [fileEvent({ file: '/home/user/a/.env', sensitive: true, reason: 'Environment variables' })],
    ]);

    const [keyed, unkeyedAgent] = get(enrichedAgents);
    expect(keyed.sensitiveFiles).toBeGreaterThan(0);
    expect(unkeyedAgent.instanceId).toBe(null);
    expect(unkeyedAgent.sensitiveFiles).toBe(0);
    expect(unkeyedAgent.fileCount).toBe(0);
    expect(unkeyedAgent.riskScore).toBe(0);
  });

  it('a synthetic pid-0 agent correlates on its 0:name key like anything else', () => {
    // Value space 2 of main/process-identity.js. No pid to key on and no special case
    // for it: one lookup path, and the synthetic uses the same one.
    inputs.agents.set([{ agent: 'Kilo Code', pid: 0, instanceId: '0:kilo-code', category: 'ai' }]);
    inputs.events.set([
      [
        fileEvent({
          agent: 'Kilo Code',
          pid: 0,
          instanceId: '0:kilo-code',
          cwd: null,
          file: '/home/user/.aws/credentials',
          sensitive: true,
          reason: 'AWS credentials',
        }),
      ],
    ]);

    const [kilo] = get(enrichedAgents);
    expect(kilo.sensitiveFiles).toBeGreaterThan(0);
    expect(kilo.riskScore).toBeGreaterThan(0);
  });
});

describe('events-index store — eventsByInstance', () => {
  it('drops unattributed events before bucketing', () => {
    inputs.events.set([fileEvent(), unattributed({ pid: 0 })]);

    const map = get(eventsByInstance);
    expect(map.get(CLAUDE_ID)).toHaveLength(1);
    expect(map.size).toBe(1);
  });

  it('buckets by instance, so a recycled pid does not inherit the dead one (C6)', () => {
    inputs.events.set([
      fileEvent({ file: '/home/user/a/one.js' }),
      // Same pid, different process — the Windows pid-recycle case.
      fileEvent({ instanceId: SECOND_CLAUDE_ID, pid: 100, file: '/home/user/b/two.js' }),
    ]);

    const map = get(eventsByInstance);
    expect(map.get(CLAUDE_ID)).toHaveLength(1);
    expect(map.get(SECOND_CLAUDE_ID)).toHaveLength(1);
    expect(map.get(CLAUDE_ID)?.[0].file).toBe('/home/user/a/one.js');
  });

  it('quarantines an attributed event that carries no instanceId', () => {
    inputs.events.set([fileEvent({ instanceId: null, file: '/home/user/a/orphan.js' })]);

    const map = get(eventsByInstance);
    expect(map.size).toBe(0);
  });
});
