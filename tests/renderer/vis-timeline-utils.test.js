import { describe, it, expect } from 'vitest';
import {
  fileEventsToTimeline,
  networkEventsToTimeline,
  buildVisGroups,
  buildVisItems,
  VIS_TIMELINE_OPTIONS,
} from '../../src/renderer/lib/utils/vis-timeline-utils.ts';

describe('vis-timeline-utils', () => {
  describe('fileEventsToTimeline()', () => {
    it('converts file events to timeline format', () => {
      const events = [
        {
          agent: 'Cursor',
          pid: 1234,
          parentEditor: null,
          cwd: null,
          file: '/etc/passwd',
          sensitive: true,
          selfAccess: false,
          reason: 'system file',
          action: 'accessed',
          timestamp: 1700000000000,
          category: 'coding-assistant',
        },
      ];
      const result = fileEventsToTimeline(events);
      expect(result).toHaveLength(1);
      expect(result[0].agent).toBe('Cursor');
      expect(result[0].eventType).toBe('file');
      expect(result[0].timestamp).toBe(1700000000000);
      expect(result[0].flagged).toBe(true);
      expect(result[0].label).toBe('accessed passwd');
      expect(result[0].detail).toContain('(sensitive)');
    });

    it('non-sensitive file is not flagged', () => {
      const events = [
        {
          agent: 'Copilot',
          pid: 5678,
          parentEditor: 'Code.exe',
          cwd: 'C:/project',
          file: 'index.js',
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 1700000001000,
          category: 'coding-assistant',
        },
      ];
      const result = fileEventsToTimeline(events);
      expect(result[0].flagged).toBe(false);
      expect(result[0].detail).not.toContain('(sensitive)');
    });

    it('empty array returns empty', () => {
      expect(fileEventsToTimeline([])).toEqual([]);
    });
  });

  describe('networkEventsToTimeline()', () => {
    it('converts network connections to timeline events', () => {
      const conns = [
        {
          agent: 'Claude',
          pid: 9999,
          parentEditor: null,
          cwd: null,
          category: 'coding-assistant',
          remoteIp: '1.2.3.4',
          remotePort: 443,
          domain: 'api.anthropic.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
      ];
      const result = networkEventsToTimeline(conns);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('network');
      expect(result[0].agent).toBe('Claude');
      expect(result[0].label).toBe('api.anthropic.com:443');
      expect(result[0].detail).toContain('443');
    });

    it('filters out connections without agent', () => {
      const conns = [
        {
          agent: '',
          pid: 0,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '0.0.0.0',
          remotePort: 80,
          domain: '',
          state: '',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
      ];
      const result = networkEventsToTimeline(conns);
      expect(result).toHaveLength(0);
    });

    it('uses remoteIp when domain is empty', () => {
      const conns = [
        {
          agent: 'TestAgent',
          pid: 100,
          parentEditor: null,
          cwd: null,
          category: 'cli-tool',
          remoteIp: '10.0.0.1',
          remotePort: 8080,
          domain: '',
          state: 'ESTABLISHED',
          flagged: true,
          httpUnencrypted: true,
          userAgent: null,
        },
      ];
      const result = networkEventsToTimeline(conns);
      expect(result[0].label).toBe('10.0.0.1:8080');
      expect(result[0].flagged).toBe(true);
    });
  });

  describe('buildVisGroups()', () => {
    it('creates unique groups from agents', () => {
      const agents = [
        { agent: 'Cursor', process: 'cursor.exe', pid: 1, status: 'running', category: 'ai-ide' },
        { agent: 'Cursor', process: 'cursor.exe', pid: 2, status: 'running', category: 'ai-ide' },
        {
          agent: 'Claude',
          process: 'claude.exe',
          pid: 3,
          status: 'running',
          category: 'coding-assistant',
        },
      ];
      const groups = buildVisGroups(agents);
      expect(groups).toHaveLength(2);
      expect(groups[0].id).toBe('Cursor');
      expect(groups[1].id).toBe('Claude');
      expect(groups[0].className).toBe('vis-group-ai-ide');
    });

    it('empty agents returns empty groups', () => {
      expect(buildVisGroups([])).toEqual([]);
    });
  });

  describe('buildVisItems()', () => {
    it('creates vis items from timeline events', () => {
      const events = [
        {
          agent: 'Cursor',
          timestamp: 1700000000000,
          eventType: 'file',
          label: 'modified',
          detail: 'modified: index.js',
          flagged: false,
        },
        {
          agent: 'Claude',
          timestamp: 1700000001000,
          eventType: 'network',
          label: 'api.anthropic.com',
          detail: 'api.anthropic.com:443',
          flagged: true,
        },
      ];
      const items = buildVisItems(events);
      expect(items).toHaveLength(2);
      expect(items[0].group).toBe('Cursor');
      expect(items[0].className).toBe('vis-item-file');
      expect(items[0]._eventType).toBe('file');
      expect(items[0].type).toBe('box');
      expect(items[0].start).toBeInstanceOf(Date);

      expect(items[1].className).toBe('vis-item-network vis-item-flagged');
      expect(items[1]._eventType).toBe('network');
    });

    it('empty events returns empty items', () => {
      expect(buildVisItems([])).toEqual([]);
    });
  });

  describe('VIS_TIMELINE_OPTIONS', () => {
    it('has required properties', () => {
      expect(VIS_TIMELINE_OPTIONS.height).toBe('100%');
      expect(VIS_TIMELINE_OPTIONS.zoomMin).toBe(1000);
      expect(VIS_TIMELINE_OPTIONS.selectable).toBe(true);
    });
  });
});
