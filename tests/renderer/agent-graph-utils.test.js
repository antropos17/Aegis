import { describe, it, expect } from 'vitest';
import {
  buildGraphNodes,
  buildFileLinks,
  buildNetworkLinks,
  buildGraphData,
} from '../../src/renderer/lib/utils/agent-graph-utils.ts';

describe('agent-graph-utils', () => {
  /** Mock grade colors for tests (no DOM available) */
  const mockGradeColors = {
    'A+': '#4a7a5a',
    A: '#5a8a6a',
    'B+': '#7a8a9e',
    B: '#9aafcc',
    C: '#c8a84e',
    D: '#c8907a',
    F: '#c87a7a',
  };

  const mockAgents = [
    {
      agent: 'Cursor',
      pid: 1,
      process: 'cursor.exe',
      status: 'running',
      category: 'ai-ide',
      name: 'Cursor',
      parentEditor: null,
      cwd: null,
      projectName: null,
      instanceKey: 'cursor-1',
      sensitiveFiles: 3,
      unknownDomains: 1,
      anomalyScore: 0.2,
      riskScore: 35,
      trustGrade: 'B+',
      fileCount: 50,
      networkCount: 5,
      hasApiCalls: true,
    },
    {
      agent: 'Claude',
      pid: 2,
      process: 'claude.exe',
      status: 'running',
      category: 'coding-assistant',
      name: 'Claude Code',
      parentEditor: 'Code.exe',
      cwd: 'C:/project',
      projectName: 'aegis',
      instanceKey: 'claude-2',
      sensitiveFiles: 0,
      unknownDomains: 0,
      anomalyScore: 0,
      riskScore: 10,
      trustGrade: 'A',
      fileCount: 20,
      networkCount: 2,
      hasApiCalls: true,
    },
    {
      agent: 'Devin',
      pid: 3,
      process: 'devin.exe',
      status: 'running',
      category: 'autonomous-agent',
      name: 'Devin',
      parentEditor: null,
      cwd: null,
      projectName: null,
      instanceKey: 'devin-3',
      sensitiveFiles: 10,
      unknownDomains: 5,
      anomalyScore: 0.8,
      riskScore: 75,
      trustGrade: 'D',
      fileCount: 200,
      networkCount: 15,
      hasApiCalls: true,
    },
  ];

  describe('buildGraphNodes()', () => {
    it('creates nodes from enriched agents', () => {
      const nodes = buildGraphNodes(mockAgents, mockGradeColors);
      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('Cursor');
      expect(nodes[0].label).toBe('Cursor');
      expect(nodes[0].riskScore).toBe(35);
      expect(nodes[0].trustGrade).toBe('B+');
    });

    it('deduplicates agents by name', () => {
      const duped = [...mockAgents, { ...mockAgents[0], pid: 99 }];
      const nodes = buildGraphNodes(duped, mockGradeColors);
      expect(nodes).toHaveLength(3);
    });

    it('radius scales with risk score', () => {
      const nodes = buildGraphNodes(mockAgents, mockGradeColors);
      const low = nodes.find((n) => n.id === 'Claude');
      const high = nodes.find((n) => n.id === 'Devin');
      expect(high.radius).toBeGreaterThan(low.radius);
    });

    it('radius is bounded 5-25', () => {
      const nodes = buildGraphNodes(mockAgents, mockGradeColors);
      for (const n of nodes) {
        expect(n.radius).toBeGreaterThanOrEqual(5);
        expect(n.radius).toBeLessThanOrEqual(25);
      }
    });

    it('empty agents returns empty', () => {
      expect(buildGraphNodes([], mockGradeColors)).toEqual([]);
    });
  });

  describe('buildFileLinks()', () => {
    it('creates links for shared file access', () => {
      const events = [
        {
          agent: 'Cursor',
          file: '/etc/passwd',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: true,
          selfAccess: false,
          reason: '',
          action: 'accessed',
          timestamp: 1,
          category: '',
        },
        {
          agent: 'Devin',
          file: '/etc/passwd',
          pid: 3,
          parentEditor: null,
          cwd: null,
          sensitive: true,
          selfAccess: false,
          reason: '',
          action: 'accessed',
          timestamp: 2,
          category: '',
        },
      ];
      const nodeIds = new Set(['Cursor', 'Claude', 'Devin']);
      const links = buildFileLinks(events, nodeIds);
      expect(links).toHaveLength(1);
      expect(links[0].type).toBe('file');
      expect(links[0].source).toBe('Cursor');
      expect(links[0].target).toBe('Devin');
      expect(links[0].weight).toBe(1);
    });

    it('no links when only one agent touches a file', () => {
      const events = [
        {
          agent: 'Cursor',
          file: 'a.js',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 1,
          category: '',
        },
      ];
      const nodeIds = new Set(['Cursor']);
      const links = buildFileLinks(events, nodeIds);
      expect(links).toHaveLength(0);
    });

    it('accumulates weight for multiple shared files', () => {
      const events = [
        {
          agent: 'Cursor',
          file: 'a.js',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 1,
          category: '',
        },
        {
          agent: 'Claude',
          file: 'a.js',
          pid: 2,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 2,
          category: '',
        },
        {
          agent: 'Cursor',
          file: 'b.js',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 3,
          category: '',
        },
        {
          agent: 'Claude',
          file: 'b.js',
          pid: 2,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 4,
          category: '',
        },
      ];
      const nodeIds = new Set(['Cursor', 'Claude']);
      const links = buildFileLinks(events, nodeIds);
      expect(links).toHaveLength(1);
      expect(links[0].weight).toBe(2);
    });

    it('ignores agents not in nodeIds', () => {
      const events = [
        {
          agent: 'Unknown',
          file: 'x.js',
          pid: 0,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 1,
          category: '',
        },
        {
          agent: 'Cursor',
          file: 'x.js',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: false,
          selfAccess: false,
          reason: '',
          action: 'modified',
          timestamp: 2,
          category: '',
        },
      ];
      const nodeIds = new Set(['Cursor']);
      const links = buildFileLinks(events, nodeIds);
      expect(links).toHaveLength(0);
    });
  });

  describe('buildNetworkLinks()', () => {
    it('creates links for shared endpoints', () => {
      const conns = [
        {
          agent: 'Cursor',
          pid: 1,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '1.1.1.1',
          remotePort: 443,
          domain: 'api.openai.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
        {
          agent: 'Claude',
          pid: 2,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '1.1.1.1',
          remotePort: 443,
          domain: 'api.openai.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
      ];
      const nodeIds = new Set(['Cursor', 'Claude']);
      const links = buildNetworkLinks(conns, nodeIds);
      expect(links).toHaveLength(1);
      expect(links[0].type).toBe('network');
      expect(links[0].resource).toBe('api.openai.com');
    });

    it('no links for different endpoints', () => {
      const conns = [
        {
          agent: 'Cursor',
          pid: 1,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '1.1.1.1',
          remotePort: 443,
          domain: 'api.openai.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
        {
          agent: 'Claude',
          pid: 2,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '2.2.2.2',
          remotePort: 443,
          domain: 'api.anthropic.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
      ];
      const nodeIds = new Set(['Cursor', 'Claude']);
      const links = buildNetworkLinks(conns, nodeIds);
      expect(links).toHaveLength(0);
    });
  });

  describe('buildGraphData()', () => {
    it('combines nodes and links', () => {
      const events = [
        {
          agent: 'Cursor',
          file: '/etc/passwd',
          pid: 1,
          parentEditor: null,
          cwd: null,
          sensitive: true,
          selfAccess: false,
          reason: '',
          action: 'accessed',
          timestamp: 1,
          category: '',
        },
        {
          agent: 'Devin',
          file: '/etc/passwd',
          pid: 3,
          parentEditor: null,
          cwd: null,
          sensitive: true,
          selfAccess: false,
          reason: '',
          action: 'accessed',
          timestamp: 2,
          category: '',
        },
      ];
      const conns = [
        {
          agent: 'Cursor',
          pid: 1,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '1.1.1.1',
          remotePort: 443,
          domain: 'api.openai.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
        {
          agent: 'Claude',
          pid: 2,
          parentEditor: null,
          cwd: null,
          category: '',
          remoteIp: '1.1.1.1',
          remotePort: 443,
          domain: 'api.openai.com',
          state: 'ESTABLISHED',
          flagged: false,
          httpUnencrypted: false,
          userAgent: null,
        },
      ];
      const data = buildGraphData(mockAgents, events, conns, mockGradeColors);
      expect(data.nodes).toHaveLength(3);
      expect(data.links.length).toBeGreaterThanOrEqual(2);

      const fileLink = data.links.find((l) => l.type === 'file');
      const netLink = data.links.find((l) => l.type === 'network');
      expect(fileLink).toBeDefined();
      expect(netLink).toBeDefined();
    });

    it('empty inputs return empty graph', () => {
      const data = buildGraphData([], [], [], mockGradeColors);
      expect(data.nodes).toEqual([]);
      expect(data.links).toEqual([]);
    });
  });
});
