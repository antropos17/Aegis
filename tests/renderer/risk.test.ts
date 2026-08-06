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
import { eventsByPid } from '../../src/renderer/lib/stores/events-index.js';
import * as ipc from '../../src/renderer/lib/stores/ipc.js';

const inputs = ipc as unknown as {
  agents: { set: (v: unknown[]) => void };
  events: { set: (v: unknown[]) => void };
  anomalies: { set: (v: Record<string, number>) => void };
  network: { set: (v: unknown[]) => void };
  falsePositives: { set: (v: unknown[]) => void };
};

const NOW = Date.now();

/** A confirmed, non-sensitive file event owned by Claude Code (pid 100). */
function fileEvent(over: Record<string, unknown> = {}) {
  return {
    agent: 'Claude Code',
    pid: 100,
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

/** An unattributed event: no owner, agent '' and pid null (C-01). */
function unattributed(over: Record<string, unknown> = {}) {
  return fileEvent({
    agent: '',
    pid: null,
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
  { agent: 'Claude Code', pid: 100, cwd: '/home/user/a', category: 'ai' },
  { agent: 'opencode', pid: 200, cwd: '/home/user/b', category: 'ai' },
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
      { agent: 'grok', pid: 0, category: 'ai' },
      { agent: 'Ollama', pid: 0, category: 'local-llm-runtime' },
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

/** One connection owned by Claude Code (pid 100), allowlisted unless overridden. */
function conn(over: Record<string, unknown> = {}) {
  return {
    agent: 'Claude Code',
    pid: 100,
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
    inputs.network.set([
      { agent: 'Claude Code', pid: 100, remoteIp: '203.0.113.9', remotePort: 443 },
    ]);
    const [claude] = get(enrichedAgents);
    expect(Number.isNaN(claude.riskScore)).toBe(false);
    expect(claude.riskScore).toBe(1);
    expect(claude.unknownDomains).toBe(0);
  });
});

describe('events-index store — eventsByPid', () => {
  it('drops unattributed events before bucketing by pid', () => {
    inputs.events.set([fileEvent(), unattributed({ pid: 0 })]);

    const map = get(eventsByPid);
    expect(map.get(100)).toHaveLength(1);
    expect(map.has(0)).toBe(false);
  });
});
