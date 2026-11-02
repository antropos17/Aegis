import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import fileWatcher from '../../src/main/file-watcher.js';
import { EVIDENCE_CODES, deriveStatus } from '../../src/main/attribution.js';

/**
 * Two AI agents online with DISJOINT working directories. This is the fixture the
 * old C-01 tests lacked: with a single agent in the list, "attributed correctly"
 * and "fell back to aiAgents[0]" are indistinguishable.
 */
function makeMultiAgentState(overrides = {}) {
  const ai = [
    {
      pid: 100,
      agent: 'Claude Code',
      category: 'ai',
      cwd: '/home/user/a',
      instanceId: '100:1700000000000',
      createTime100ns: '133444736000000000',
    },
    {
      pid: 200,
      agent: 'opencode',
      category: 'ai',
      cwd: '/home/user/b',
      instanceId: '200:1700000005000',
      createTime100ns: '133444736050000000',
    },
  ];
  return {
    getCustomRules: () => [],
    getLatestAgents: () => ai,
    getLatestAiAgents: () => ai,
    isMonitoringPaused: () => false,
    isOtherPanelExpanded: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: vi.fn(),
    onFileEvent: vi.fn(),
    onActivityPush: vi.fn(),
    ...overrides,
  };
}

describe('file-watcher attribution — chokidar path (no PID available)', () => {
  let state;

  beforeEach(() => {
    state = makeMultiAgentState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
  });

  it('case 1: ~/.ssh/id_rsa with two live agents → unattributed, nobody blamed', () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/.ssh/id_rsa');

    expect(state.activityLog).toHaveLength(1);
    const event = state.activityLog[0];
    expect(event.attribution).toEqual({ status: 'unattributed', evidence: ['no-owner-match'] });
    expect(event.agent).toBe('');
    expect(event.pid).toBeNull();
    expect(event.cwd).toBeNull();
    expect(event.parentEditor).toBeNull();
    // The sensitive fact survives — only the (unknown) owner is withheld.
    expect(event.sensitive).toBe(true);
    expect(event.reason).toBe('SSH keys/config');
    expect(event.selfAccess).toBe(false);
    // No agent's behaviour baseline may absorb an event with no known owner.
    expect(state.recordFileAccess).not.toHaveBeenCalled();
    // It stays visible downstream.
    expect(state.onFileEvent).toHaveBeenCalledTimes(1);
  });

  it('case 2: a file inside the SECOND agent cwd → inferred via cwd-containment', () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/b/src/index.js');

    const event = state.activityLog[0];
    expect(event.attribution).toEqual({ status: 'inferred', evidence: ['cwd-containment'] });
    expect(event.agent).toBe('opencode');
    expect(event.pid).toBe(200);
    expect(event.selfAccess).toBe(false);
    // Decision "inferred rides on equal terms": it DOES reach baselines.
    expect(state.recordFileAccess).toHaveBeenCalledTimes(1);
    // The inferred owner's OWN instance key leads, its name follows — the bucket is
    // per instance, so a namesake in another project cannot inherit this record.
    expect(state.recordFileAccess.mock.calls[0][0]).toBe('200:1700000005000');
    expect(state.recordFileAccess.mock.calls[0][1]).toBe('opencode');
  });

  it('case 2b: a SENSITIVE file inside an agent cwd → inferred, and it feeds baselines', () => {
    // The common real-world shape, and the only path where inferred evidence adds
    // to baselines.sensitiveCount (decision: inferred rides on equal terms).
    fileWatcher.handleWatcherEvent('modified', '/home/user/b/.env');

    const event = state.activityLog[0];
    expect(event.attribution).toEqual({ status: 'inferred', evidence: ['cwd-containment'] });
    expect(event.agent).toBe('opencode');
    expect(event.sensitive).toBe(true);
    expect(event.selfAccess).toBe(false);
    expect(state.recordFileAccess).toHaveBeenCalledWith(
      '200:1700000005000',
      'opencode',
      expect.stringContaining('.env'),
      true,
      'Environment variables',
    );
  });

  it.each(['same', 'nested', 'same-reversed', 'nested-reversed'])(
    'retains a write without selecting an arbitrary %s cwd candidate',
    (layout) => {
      const agents = state.getLatestAiAgents();
      agents[0].cwd = '/home/user/b';
      agents[1].cwd = layout.startsWith('nested') ? '/home/user/b/src' : '/home/user/b';
      if (layout.endsWith('reversed')) agents.reverse();
      fileWatcher.handleWatcherEvent('created', '/home/user/b/src/output.txt');
      const event = state.activityLog[0];
      expect(event).toMatchObject({
        pid: null,
        instanceId: null,
        cwd: null,
        agent: '',
        attribution: { status: 'unattributed', evidence: ['ambiguous-owner-match'] },
      });
      expect(event).not.toHaveProperty('createTime100ns');
      expect(state.recordFileAccess).not.toHaveBeenCalled();
      expect(state.onFileEvent).toHaveBeenCalledExactlyOnceWith(event);
      expect(state.onActivityPush).toHaveBeenCalledExactlyOnceWith(event);
    },
  );

  it('preserves a unique candidate snapshot full birth without promoting path attribution', () => {
    const candidate = state.getLatestAiAgents()[1];
    Object.assign(candidate, {
      startTime: 1700000005000,
      instanceIdSource: 'os',
      createTime100ns: '133444736050000007',
      generationWitnessSource: 'createTime100ns',
      generationWitness: '133444736050000007',
    });
    fileWatcher.handleWatcherEvent('created', '/home/user/b/output.txt');
    expect(state.activityLog[0]).toMatchObject({
      pid: 200,
      instanceId: '200:1700000005000',
      createTime100ns: '133444736050000007',
      attribution: { status: 'inferred', evidence: ['cwd-containment'] },
    });
  });

  it.each([null, '0133444736050000000', '18446744073709551616', '133444736000000000'])(
    'keeps prior unique-owner inference without copying invalid or contradictory birth %s',
    (ticks) => {
      const candidate = state.getLatestAiAgents()[1];
      Object.assign(candidate, {
        startTime: 1700000005000,
        instanceIdSource: 'os',
        createTime100ns: ticks,
        generationWitnessSource: 'createTime100ns',
        generationWitness: ticks,
      });
      fileWatcher.handleWatcherEvent('modified', '/home/user/b/output.txt');
      const event = state.activityLog[0];
      expect(event).toMatchObject({
        pid: 200,
        instanceId: candidate.instanceId,
        attribution: { status: 'inferred', evidence: ['cwd-containment'] },
      });
      expect(event).not.toHaveProperty('createTime100ns');
    },
  );

  it('withholds a full birth that contradicts the generation proof used for cwd', () => {
    Object.assign(state.getLatestAiAgents()[1], {
      startTime: 1700000005000,
      instanceIdSource: 'os',
      createTime100ns: '133444736050000007',
      generationWitnessSource: 'createTime100ns',
      generationWitness: '133444736050000001',
    });
    fileWatcher.handleWatcherEvent('created', '/home/user/b/output.txt');
    expect(state.activityLog[0].attribution.status).toBe('inferred');
    expect(state.activityLog[0]).not.toHaveProperty('createTime100ns');
  });

  it.each(['missing-to-known', 'same-ms-reuse'])(
    'delivers both modifications when candidate birth changes through %s inside the debounce window',
    (transition) => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000010000);
      try {
        const candidate = state.getLatestAiAgents()[1];
        const firstTicks = transition === 'missing-to-known' ? null : '133444736050000001';
        Object.assign(candidate, {
          startTime: 1700000005000,
          instanceIdSource: 'os',
          createTime100ns: firstTicks,
          generationWitnessSource: 'createTime100ns',
          generationWitness: firstTicks,
        });
        fileWatcher.handleWatcherEvent('modified', '/home/user/b/output.txt');
        Object.assign(candidate, {
          createTime100ns: '133444736050000007',
          generationWitness: '133444736050000007',
        });
        fileWatcher.handleWatcherEvent('modified', '/home/user/b/output.txt');
        expect(state.activityLog).toHaveLength(2);
        expect(state.onFileEvent).toHaveBeenCalledTimes(2);
        expect(state.activityLog.map((event) => event.createTime100ns ?? null)).toEqual([
          firstTicks,
          '133444736050000007',
        ]);
        expect(state.activityLog.every((event) => event.attribution.status === 'inferred')).toBe(
          true,
        );
        expect(state.activityLog[0].eventId).not.toBe(state.activityLog[1].eventId);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it('does not select the first same-named process for a shared self-config path', () => {
    state.getLatestAiAgents()[1].agent = 'Claude Code';
    fileWatcher.handleWatcherEvent('modified', '/home/user/.claude/settings.json');
    expect(state.activityLog[0]).toMatchObject({
      pid: null,
      instanceId: null,
      selfAccess: false,
      attribution: { status: 'unattributed', evidence: ['ambiguous-owner-match'] },
    });
    expect(state.recordFileAccess).not.toHaveBeenCalled();
  });

  it('case 3: an agent own config dir → inferred via self-config-path, exempted', () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/.opencode/auth.json');

    const event = state.activityLog[0];
    expect(event.attribution).toEqual({ status: 'inferred', evidence: ['self-config-path'] });
    expect(event.agent).toBe('opencode');
    expect(event.pid).toBe(200);
    expect(event.selfAccess).toBe(true);
    expect(event.sensitive).toBe(false);
  });

  it('case 4 (D2): a foreign agent self-config pattern cannot clear `sensitive`', () => {
    // No AI agent online; the only detected process is a non-AI one whose NAME
    // matches the AGENT_SELF_CONFIG keyword "docker". Old code substituted
    // agents[0] and then ran isSelfAccess against it → selfAccess true →
    // sensitive false → a real hit on ~/.docker/config.json disappeared.
    state = makeMultiAgentState({
      getLatestAgents: () => [{ pid: 50, agent: 'Docker Desktop', category: 'other' }],
      getLatestAiAgents: () => [],
    });
    fileWatcher.init(state);
    fileWatcher._resetForTest();

    fileWatcher.handleWatcherEvent('modified', '/home/user/.docker/config.json');

    const event = state.activityLog[0];
    expect(event.attribution).toEqual({
      status: 'unattributed',
      evidence: ['no-ai-agents-online'],
    });
    expect(event.agent).toBe('');
    expect(event.pid).toBeNull();
    expect(event.selfAccess).toBe(false);
    expect(event.sensitive).toBe(true);
    expect(event.reason).toBe('Docker credentials');
    expect(state.recordFileAccess).not.toHaveBeenCalled();
  });

  it('case 5: no AI agent online at all → no-ai-agents-online, not agents[0]', () => {
    state = makeMultiAgentState({
      getLatestAgents: () => [{ pid: 77, agent: 'VS Code', category: 'other' }],
      getLatestAiAgents: () => [],
    });
    fileWatcher.init(state);
    fileWatcher._resetForTest();

    fileWatcher.handleWatcherEvent('created', '/home/user/.ssh/known_hosts');

    const event = state.activityLog[0];
    expect(event.attribution.status).toBe('unattributed');
    expect(event.attribution.evidence).toEqual(['no-ai-agents-online']);
    expect(event.agent).not.toBe('VS Code');
    expect(event.agent).toBe('');
    expect(event.category).toBe('other');
  });

  it('self-config outranks cwd containment when both could match', () => {
    // The file lives inside agent B cwd AND is agent A own config dir.
    state = makeMultiAgentState({
      getLatestAgents: () => [
        { pid: 100, agent: 'Claude Code', category: 'ai', cwd: '/home/user/a' },
        { pid: 200, agent: 'opencode', category: 'ai', cwd: '/home/user' },
      ],
      getLatestAiAgents: () => [
        { pid: 100, agent: 'Claude Code', category: 'ai', cwd: '/home/user/a' },
        { pid: 200, agent: 'opencode', category: 'ai', cwd: '/home/user' },
      ],
    });
    fileWatcher.init(state);
    fileWatcher._resetForTest();

    fileWatcher.handleWatcherEvent('modified', '/home/user/.claude/settings.json');

    const event = state.activityLog[0];
    expect(event.attribution.evidence).toEqual(['self-config-path']);
    expect(event.agent).toBe('Claude Code');
  });

  it('reports the unattributed status to the activity-push counter hook exactly once', () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/.ssh/id_ed25519');

    expect(state.onActivityPush).toHaveBeenCalledTimes(1);
    const pushed = state.onActivityPush.mock.calls[0][0];
    expect(pushed.attribution.status).toBe('unattributed');
    expect(pushed.sensitive).toBe(true);
  });
});

describe('file-watcher attribution — confirmed (PID-backed) paths', () => {
  let state;

  beforeEach(() => {
    state = makeMultiAgentState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
  });

  it('case 7: handle scan stamps confirmed / handle-scan-pid', async () => {
    fileWatcher._setDepsForTest({
      getFileHandles: vi.fn(async () => ['/home/user/.aws/credentials']),
    });

    const events = await fileWatcher.scanAllFileHandles([
      { pid: 100, agent: 'Claude Code', category: 'ai' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].attribution).toEqual({
      status: 'confirmed',
      evidence: ['handle-scan-pid'],
    });
    expect(events[0].pid).toBe(100);
  });

  it('case 7b: handle scan on the agent OWN config adds self-config-path', async () => {
    fileWatcher._setDepsForTest({
      getFileHandles: vi.fn(async () => ['/home/user/.claude/settings.json']),
    });

    const events = await fileWatcher.scanAllFileHandles([
      { pid: 100, agent: 'Claude Code', category: 'ai' },
    ]);

    expect(events[0].attribution).toEqual({
      status: 'confirmed',
      evidence: ['handle-scan-pid', 'self-config-path'],
    });
    expect(events[0].selfAccess).toBe(true);
  });

  it('case 6: RM holder stamps confirmed / rm-holder-pid from the holder PID', async () => {
    fileWatcher._setDepsForTest({
      getSensitiveHolders: vi.fn(async () => [
        {
          pid: 200,
          createTime100ns: '133444736050000000',
          group: '/home/user/.ssh',
          reason: 'SSH keys/config',
        },
      ]),
    });

    const events = await fileWatcher.scanAllFileHandles([
      { pid: 100, agent: 'Claude Code', category: 'ai' },
      { pid: 200, agent: 'opencode', category: 'ai' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('opencode');
    expect(events[0].attribution).toEqual({ status: 'confirmed', evidence: ['rm-holder-pid'] });
  });

  it('case 6b: RM holder on its OWN config dir carries both codes', async () => {
    fileWatcher._setDepsForTest({
      getSensitiveHolders: vi.fn(async () => [
        {
          pid: 200,
          createTime100ns: '133444736050000000',
          group: '/home/user/.opencode',
          reason: 'AI agent config — opencode',
        },
      ]),
    });

    const events = await fileWatcher.scanAllFileHandles([
      { pid: 200, agent: 'opencode', category: 'ai' },
    ]);

    expect(events[0].attribution).toEqual({
      status: 'confirmed',
      evidence: ['rm-holder-pid', 'self-config-path'],
    });
    expect(events[0].selfAccess).toBe(true);
  });
});

describe('attribution evidence is a closed list (case 8)', () => {
  let state;

  beforeEach(() => {
    state = makeMultiAgentState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
  });

  it('exposes exactly the documented closed codes', () => {
    // The list is closed on purpose and deriveStatus throws on anything outside it, so this
    // assertion is the gate: adding a code means deciding its status here, in events.ts, and
    // in PID_EVIDENCE/HEURISTIC_EVIDENCE — not just at a call site.
    expect([...EVIDENCE_CODES]).toEqual([
      'rm-holder-pid',
      'handle-scan-pid',
      'os-tcp-owner-pid',
      'etw-file-object',
      'self-config-path',
      'cwd-containment',
      'no-owner-match',
      'ambiguous-owner-match',
      'no-ai-agents-online',
      'population-unavailable',
    ]);
  });

  it('population-unavailable derives unattributed — it is a negative code', () => {
    // It must never read as PID proof or as a heuristic match: nothing was matched,
    // and the reason is that there was no trustworthy list to match against.
    expect(deriveStatus(['population-unavailable'])).toBe('unattributed');
  });

  it('keeps native object evidence PID-backed and ambiguous ownership negative', () => {
    expect(deriveStatus(['etw-file-object'])).toBe('confirmed');
    expect(deriveStatus(['ambiguous-owner-match'])).toBe('unattributed');
  });

  it('the typed AttributionEvidence union mirrors EVIDENCE_CODES exactly', () => {
    // The union is the enforced boundary for every TypeScript consumer, and `tsc` cannot
    // see the runtime list — so nothing but this test connects the two halves of a closed
    // list that lives in two languages. Order included: EVIDENCE_CODES is declaration
    // order, and a mirror that agrees only as a set hides which code was appended where.
    const src = readFileSync(new URL('../../src/shared/types/events.ts', import.meta.url), 'utf-8');
    const union = src.match(/export type AttributionEvidence =([\s\S]*?);/);
    expect(union).not.toBeNull();
    // Strip the per-member JSDoc first: a comment may legally contain quoted text, and a
    // naive literal scan would then read prose as a member.
    const members = [
      ...union[1]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(members).toEqual([...EVIDENCE_CODES]);
  });

  it('every code emitted by real watcher events belongs to the closed list', async () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/.ssh/id_rsa');
    fileWatcher.handleWatcherEvent('modified', '/home/user/b/src/main.js');
    fileWatcher.handleWatcherEvent('modified', '/home/user/.opencode/auth.json');
    fileWatcher._setDepsForTest({
      getFileHandles: vi.fn(async () => ['/home/user/.aws/credentials']),
    });
    await fileWatcher.scanAllFileHandles([{ pid: 100, agent: 'Claude Code', category: 'ai' }]);

    expect(state.activityLog.length).toBeGreaterThanOrEqual(4);
    for (const event of state.activityLog) {
      expect(event.attribution).toBeDefined();
      expect(['confirmed', 'inferred', 'unattributed']).toContain(event.attribution.status);
      expect(event.attribution.evidence.length).toBeGreaterThan(0);
      for (const code of event.attribution.evidence) {
        expect(EVIDENCE_CODES).toContain(code);
      }
      // The status is always derivable from the evidence — never stored independently.
      expect(deriveStatus(event.attribution.evidence)).toBe(event.attribution.status);
    }
  });

  it('rejects an unknown code instead of degrading it to unattributed', () => {
    expect(() => deriveStatus(['made-up-code'])).toThrow(/unknown evidence code/);
    expect(() => deriveStatus([])).toThrow(/non-empty array/);
  });

  it('carries no confidence field anywhere in the attribution object', () => {
    fileWatcher.handleWatcherEvent('modified', '/home/user/b/src/index.js');
    const { attribution } = state.activityLog[0];
    expect(Object.keys(attribution).sort()).toEqual(['evidence', 'status']);
  });
});
