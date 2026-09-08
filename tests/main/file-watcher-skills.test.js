import { beforeEach, describe, expect, it, vi } from 'vitest';
import watcher from '../../src/main/file-watcher.js';

describe('skill metadata stays independent from actor attribution', () => {
  let state;
  const owner = { pid: 123, agent: 'OpenAI Codex CLI', category: 'ai', instanceId: '123:1000' };
  beforeEach(() => {
    state = {
      getCustomRules: () => [],
      getLatestAgents: () => [owner],
      getLatestAiAgents: () => [owner],
      isMonitoringPaused: () => false,
      isOtherPanelExpanded: () => false,
      activityLog: [],
      knownHandles: new Map(),
      watchers: [],
      recordFileAccess: vi.fn(),
      onFileEvent: vi.fn(),
    };
    watcher.init(state);
    watcher._resetForTest();
  });

  it('names a shared skill without guessing which online agent touched it', () => {
    watcher.handleWatcherEvent('modified', '/home/u/.agents/skills/testing/SKILL.md');
    expect(state.activityLog[0]).toMatchObject({
      agent: '',
      pid: null,
      instanceId: null,
      action: 'modified',
      skill: { name: 'testing', relativePath: 'SKILL.md' },
      attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
    });
    expect(state.recordFileAccess).not.toHaveBeenCalled();
    expect(state.onFileEvent).toHaveBeenCalledWith(state.activityLog[0]);
  });

  it('names a newly created skill root while retaining the observed action and unknown owner', () => {
    watcher.handleWatcherEvent('created', '/home/u/.claude/skills/improve-animations');
    expect(state.activityLog[0]).toMatchObject({
      action: 'created',
      agent: '',
      pid: null,
      skill: { name: 'improve-animations', relativePath: '' },
      attribution: { status: 'unattributed' },
    });
  });

  it('keeps an actual PID-backed handle observation alongside the skill name', async () => {
    watcher._setDepsForTest({
      getFileHandles: async () => ['/home/u/.agents/skills/pdf/scripts/render.py'],
      isReadDetectionAvailable: true,
    });
    const result = await watcher.scanAllFileHandles([owner]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agent: owner.agent,
      pid: 123,
      instanceId: '123:1000',
      skill: { name: 'pdf', relativePath: 'scripts/render.py' },
      attribution: { status: 'confirmed' },
    });
  });

  it('does not turn a credential under a skill folder into harmless self-access', () => {
    watcher.handleWatcherEvent('modified', '/home/u/.agents/skills/testing/.env');
    expect(state.activityLog[0]).toMatchObject({
      sensitive: true,
      selfAccess: false,
      skill: { name: 'testing', relativePath: '.env' },
    });
  });
});
