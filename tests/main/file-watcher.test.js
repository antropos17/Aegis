import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fileWatcher = require('../../src/main/file-watcher.js');

function makeState(overrides = {}) {
  return {
    getCustomRules: () => [],
    getLatestAgents: () => [{ pid: 100, agent: 'Claude Code', category: 'ai' }],
    getLatestAiAgents: () => [{ pid: 100, agent: 'Claude Code', category: 'ai' }],
    isMonitoringPaused: () => false,
    isOtherPanelExpanded: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: vi.fn(),
    onFileEvent: vi.fn(),
    ...overrides,
  };
}

describe('file-watcher', () => {
  describe('classifySensitive()', () => {
    it('.env → "Environment variables"', () => {
      expect(fileWatcher.classifySensitive('/home/user/.env')).toBe('Environment variables');
    });

    it('.ssh/ → "SSH keys/config"', () => {
      expect(fileWatcher.classifySensitive('/home/user/.ssh/config')).toBe('SSH keys/config');
    });

    it('.aws/ → "AWS credentials"', () => {
      expect(fileWatcher.classifySensitive('/home/user/.aws/config')).toBe('AWS credentials');
    });

    it('.gnupg/ → "GPG keys"', () => {
      expect(fileWatcher.classifySensitive('/home/user/.gnupg/pubring.kbx')).toBe('GPG keys');
    });

    it('.kube/ → "Kubernetes config"', () => {
      expect(fileWatcher.classifySensitive('/home/user/.kube/config')).toBe('Kubernetes config');
    });

    it('agent config dirs (.claude/, .cursor/)', () => {
      const claudeResult = fileWatcher.classifySensitive('/home/user/.claude/config.json');
      expect(claudeResult).toContain('Claude');
      const cursorResult = fileWatcher.classifySensitive('/home/user/.cursor/settings.json');
      expect(cursorResult).toContain('Cursor');
    });

    it('null for non-sensitive', () => {
      expect(fileWatcher.classifySensitive('/home/user/Documents/readme.txt')).toBeNull();
    });

    it('includes custom rules when state is initialized', () => {
      fileWatcher.init(makeState({
        getCustomRules: () => [{ pattern: /my-internal-project/, reason: 'Custom: my-internal-project' }],
      }));
      expect(fileWatcher.classifySensitive('/home/my-internal-project/data')).toBe('Custom: my-internal-project');
    });

    it('built-in rules take priority over custom rules', () => {
      fileWatcher.init(makeState({
        getCustomRules: () => [{ pattern: /\.ssh/, reason: 'Custom SSH' }],
      }));
      expect(fileWatcher.classifySensitive('/home/user/.ssh/id_rsa')).toBe('SSH keys/config');
    });
  });

  describe('shouldIgnore()', () => {
    it('.tmp files', () => {
      expect(fileWatcher.shouldIgnore('/home/user/file.tmp')).toBe(true);
    });

    it('platform-specific patterns (macOS)', () => {
      expect(fileWatcher.shouldIgnore('/System/Library/something')).toBe(true);
      expect(fileWatcher.shouldIgnore('/Users/test/.DS_Store')).toBe(true);
    });

    it('does not ignore normal files', () => {
      expect(fileWatcher.shouldIgnore('/home/user/project/index.js')).toBe(false);
    });

    it('/private/var/ on macOS', () => {
      expect(fileWatcher.shouldIgnore('/private/var/folders/xx/tmp')).toBe(true);
    });

    it('/dev/ paths', () => {
      expect(fileWatcher.shouldIgnore('/dev/null')).toBe(true);
    });
  });

  describe('isSelfAccess()', () => {
    it('Claude → .claude/ is true', () => {
      expect(fileWatcher.isSelfAccess('Claude Code', '/home/user/.claude/config.json')).toBe(true);
    });

    it('Cursor → .cursor/ is true', () => {
      expect(fileWatcher.isSelfAccess('Cursor', '/home/user/.cursor/settings.json')).toBe(true);
    });

    it('Claude → .cursor/ is false (cross-agent)', () => {
      expect(fileWatcher.isSelfAccess('Claude Code', '/home/user/.cursor/settings.json')).toBe(false);
    });

    it('case-insensitive matching', () => {
      expect(fileWatcher.isSelfAccess('CLAUDE CODE', '/home/user/.claude/config.json')).toBe(true);
    });

    it('non-matching agent returns false', () => {
      expect(fileWatcher.isSelfAccess('SomeAgent', '/home/user/.ssh/id_rsa')).toBe(false);
    });
  });
});

describe('file-watcher event handling', () => {
  let state;

  beforeEach(() => {
    state = makeState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
  });

  describe('handleWatcherEvent()', () => {
    it('creates event with correct structure', () => {
      fileWatcher.handleWatcherEvent('modified', '/home/user/project/index.js');
      expect(state.activityLog).toHaveLength(1);
      const event = state.activityLog[0];
      expect(event.agent).toBe('Claude Code');
      expect(event.pid).toBe(100);
      expect(event.action).toBe('modified');
      expect(event.sensitive).toBe(false);
      expect(event.reason).toBe('');
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it('marks sensitive files', () => {
      fileWatcher.handleWatcherEvent('accessed', '/home/user/.ssh/id_rsa');
      const event = state.activityLog[0];
      expect(event.sensitive).toBe(true);
      expect(event.reason).toBe('SSH keys/config');
    });

    it('marks self-access correctly', () => {
      fileWatcher.handleWatcherEvent('modified', '/home/user/.claude/config.json');
      const event = state.activityLog[0];
      expect(event.selfAccess).toBe(true);
      expect(event.sensitive).toBe(false);
    });

    it('debounces rapid events for same file', () => {
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      expect(state.activityLog).toHaveLength(1);
    });

    it('allows events for different files', () => {
      fileWatcher.handleWatcherEvent('modified', '/home/user/a.js');
      fileWatcher.handleWatcherEvent('modified', '/home/user/b.js');
      expect(state.activityLog).toHaveLength(2);
    });

    it('skips when monitoring is paused', () => {
      state.isMonitoringPaused = () => true;
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      expect(state.activityLog).toHaveLength(0);
    });

    it('skips when no agents detected', () => {
      state.getLatestAgents = () => [];
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      expect(state.activityLog).toHaveLength(0);
    });

    it('skips ignored files', () => {
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.tmp');
      expect(state.activityLog).toHaveLength(0);
    });

    it('calls recordFileAccess', () => {
      fileWatcher.handleWatcherEvent('created', '/home/user/.ssh/key');
      expect(state.recordFileAccess).toHaveBeenCalledWith(
        'Claude Code',
        expect.stringContaining('.ssh'),
        true,
        'SSH keys/config',
      );
    });

    it('calls onFileEvent callback', () => {
      fileWatcher.handleWatcherEvent('created', '/home/user/file.js');
      expect(state.onFileEvent).toHaveBeenCalledTimes(1);
    });

    it('caps activity log at 10000', () => {
      state.activityLog.length = 9999;
      state.activityLog.fill({ dummy: true });
      fileWatcher._resetForTest();
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      expect(state.activityLog.length).toBeLessThanOrEqual(10000);
    });

    it('uses AI agent over generic agent when available', () => {
      state.getLatestAgents = () => [
        { pid: 50, agent: 'Generic', category: 'other' },
      ];
      state.getLatestAiAgents = () => [
        { pid: 100, agent: 'Claude Code', category: 'ai' },
      ];
      fileWatcher.handleWatcherEvent('modified', '/home/user/file.js');
      expect(state.activityLog[0].agent).toBe('Claude Code');
    });
  });

  describe('pruneKnownHandles()', () => {
    it('removes handles for inactive PIDs', () => {
      state.knownHandles.set(100, new Set(['/a']));
      state.knownHandles.set(200, new Set(['/b']));
      state.knownHandles.set(300, new Set(['/c']));
      fileWatcher.pruneKnownHandles([{ pid: 100 }, { pid: 300 }]);
      expect(state.knownHandles.has(100)).toBe(true);
      expect(state.knownHandles.has(200)).toBe(false);
      expect(state.knownHandles.has(300)).toBe(true);
    });

    it('removes all when no active agents', () => {
      state.knownHandles.set(100, new Set(['/a']));
      fileWatcher.pruneKnownHandles([]);
      expect(state.knownHandles.size).toBe(0);
    });
  });
});

describe('file-watcher scanFileHandles', () => {
  let state;
  let mockGetFileHandles;

  beforeEach(() => {
    mockGetFileHandles = vi.fn();
    state = makeState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
    fileWatcher._setDepsForTest({ getFileHandles: mockGetFileHandles });
  });

  describe('scanAllFileHandles()', () => {
    it('scans AI agents and returns new events', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/project/file.js', '/home/user/.ssh/id_rsa']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(state.activityLog.length).toBeGreaterThanOrEqual(1);
    });

    it('skips ignored files from handle scan', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/file.tmp', '/home/user/real.js']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events.every((e) => !e.file.endsWith('.tmp'))).toBe(true);
    });

    it('deduplicates via knownHandles', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/file.js']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];

      await fileWatcher.scanAllFileHandles(agents);
      const firstLen = state.activityLog.length;

      await fileWatcher.scanAllFileHandles(agents);
      expect(state.activityLog.length).toBe(firstLen);
    });

    it('returns empty on getFileHandles error', async () => {
      mockGetFileHandles.mockRejectedValue(new Error('permission denied'));
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events).toEqual([]);
    });

    it('returns empty when getFileHandles returns empty', async () => {
      mockGetFileHandles.mockResolvedValue([]);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events).toEqual([]);
    });

    it('marks sensitive files in handle scan', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/.ssh/id_rsa']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events[0].sensitive).toBe(true);
      expect(events[0].reason).toBe('SSH keys/config');
    });

    it('marks self-access in handle scan', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/.claude/config.json']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const events = await fileWatcher.scanAllFileHandles(agents);
      expect(events[0].selfAccess).toBe(true);
      expect(events[0].sensitive).toBe(false);
    });

    it('only scans AI category unless panel expanded', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/file.js']);
      const agents = [
        { pid: 100, agent: 'Claude Code', category: 'ai' },
        { pid: 200, agent: 'Other', category: 'other' },
      ];
      await fileWatcher.scanAllFileHandles(agents);
      expect(mockGetFileHandles).toHaveBeenCalledTimes(1);
      expect(mockGetFileHandles).toHaveBeenCalledWith(100);
    });

    it('scans all categories when panel expanded', async () => {
      state.isOtherPanelExpanded = () => true;
      mockGetFileHandles.mockResolvedValue(['/home/user/file.js']);
      const agents = [
        { pid: 100, agent: 'Claude Code', category: 'ai' },
        { pid: 200, agent: 'Other', category: 'other' },
      ];
      await fileWatcher.scanAllFileHandles(agents);
      expect(mockGetFileHandles).toHaveBeenCalledTimes(2);
    });

    it('calls recordFileAccess for each new event', async () => {
      mockGetFileHandles.mockResolvedValue(['/home/user/a.js', '/home/user/b.js']);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      await fileWatcher.scanAllFileHandles(agents);
      expect(state.recordFileAccess).toHaveBeenCalledTimes(2);
    });
  });
});
