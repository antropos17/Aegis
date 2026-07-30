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

describe('events-index store — eventsByPid', () => {
  it('drops unattributed events before bucketing by pid', () => {
    inputs.events.set([fileEvent(), unattributed({ pid: 0 })]);

    const map = get(eventsByPid);
    expect(map.get(100)).toHaveLength(1);
    expect(map.has(0)).toBe(false);
  });
});
