import { describe, it, expect, beforeEach, vi } from 'vitest';
import fileWatcher from '../../src/main/file-watcher.js';
import { EVIDENCE_CODES, deriveStatus } from '../../src/main/attribution.js';

/**
 * Two AI agents online with DISJOINT working directories. This is the fixture the
 * old C-01 tests lacked: with a single agent in the list, "attributed correctly"
 * and "fell back to aiAgents[0]" are indistinguishable.
 */
function makeMultiAgentState(overrides = {}) {
  const ai = [
    { pid: 100, agent: 'Claude Code', category: 'ai', cwd: '/home/user/a' },
    { pid: 200, agent: 'opencode', category: 'ai', cwd: '/home/user/b' },
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
    expect(state.recordFileAccess.mock.calls[0][0]).toBe('opencode');
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
      'opencode',
      expect.stringContaining('.env'),
      true,
      'Environment variables',
    );
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
        { pid: 200, group: '/home/user/.ssh', reason: 'SSH keys/config' },
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
        { pid: 200, group: '/home/user/.opencode', reason: 'AI agent config — opencode' },
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

  it('exposes exactly the six documented codes', () => {
    expect([...EVIDENCE_CODES]).toEqual([
      'rm-holder-pid',
      'handle-scan-pid',
      'self-config-path',
      'cwd-containment',
      'no-owner-match',
      'no-ai-agents-online',
    ]);
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
