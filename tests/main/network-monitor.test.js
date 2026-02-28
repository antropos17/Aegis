import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const networkMonitor = require('../../src/main/network-monitor.js');

describe('network-monitor', () => {
  describe('isKnownDomain()', () => {
    it('recognizes anthropic.com', () => {
      expect(networkMonitor.isKnownDomain('api.anthropic.com')).toBe(true);
    });

    it('recognizes github.com', () => {
      expect(networkMonitor.isKnownDomain('github.com')).toBe(true);
    });

    it('recognizes cursor.sh', () => {
      expect(networkMonitor.isKnownDomain('cursor.sh')).toBe(true);
    });

    it('recognizes subdomains', () => {
      expect(networkMonitor.isKnownDomain('api.github.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('cdn.anthropic.com')).toBe(true);
    });

    it('rejects unknown domains', () => {
      expect(networkMonitor.isKnownDomain('evil-hacker.xyz')).toBe(false);
      expect(networkMonitor.isKnownDomain('malware.ru')).toBe(false);
    });

    it('includes agent-database.json domains', () => {
      expect(networkMonitor.isKnownDomain('claude.ai')).toBe(true);
    });

    it('recognizes CDN domains', () => {
      expect(networkMonitor.isKnownDomain('d123.cloudfront.net')).toBe(true);
      expect(networkMonitor.isKnownDomain('cdn.fastly.net')).toBe(true);
    });

    it('recognizes cloud provider domains', () => {
      expect(networkMonitor.isKnownDomain('s3.amazonaws.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('blob.core.windows.net')).toBe(true);
    });

    it('recognizes npm/node ecosystem domains', () => {
      expect(networkMonitor.isKnownDomain('registry.npmjs.org')).toBe(true);
      expect(networkMonitor.isKnownDomain('nodejs.org')).toBe(true);
    });
  });

  describe('isPrivateIp()', () => {
    it('127.x loopback', () => {
      expect(networkMonitor.isPrivateIp('127.0.0.1')).toBe(true);
      expect(networkMonitor.isPrivateIp('127.0.1.1')).toBe(true);
    });

    it('10.x private', () => {
      expect(networkMonitor.isPrivateIp('10.0.0.1')).toBe(true);
      expect(networkMonitor.isPrivateIp('10.255.255.255')).toBe(true);
    });

    it('172.16-31.x private', () => {
      expect(networkMonitor.isPrivateIp('172.16.0.1')).toBe(true);
      expect(networkMonitor.isPrivateIp('172.31.255.255')).toBe(true);
    });

    it('192.168.x private', () => {
      expect(networkMonitor.isPrivateIp('192.168.0.1')).toBe(true);
      expect(networkMonitor.isPrivateIp('192.168.1.100')).toBe(true);
    });

    it('::1 and fe80: IPv6 loopback/link-local', () => {
      expect(networkMonitor.isPrivateIp('::1')).toBe(true);
      expect(networkMonitor.isPrivateIp('fe80::1')).toBe(true);
    });

    it('rejects public IPs', () => {
      expect(networkMonitor.isPrivateIp('8.8.8.8')).toBe(false);
      expect(networkMonitor.isPrivateIp('52.1.2.3')).toBe(false);
      expect(networkMonitor.isPrivateIp('172.32.0.1')).toBe(false);
    });

    it('0.0.0.0 is private', () => {
      expect(networkMonitor.isPrivateIp('0.0.0.0')).toBe(true);
    });

    it(':: is private', () => {
      expect(networkMonitor.isPrivateIp('::')).toBe(true);
    });
  });
});

describe('network-monitor DI tests', () => {
  let mockGetRawTcp;
  let mockDnsReverse;

  beforeEach(() => {
    mockGetRawTcp = vi.fn();
    mockDnsReverse = vi.fn();
    networkMonitor._resetForTest();
    networkMonitor._setDepsForTest({
      getRawTcpConnections: mockGetRawTcp,
      dnsReverse: mockDnsReverse,
    });
  });

  afterEach(() => {
    networkMonitor._resetForTest();
  });

  describe('resolveIp()', () => {
    it('resolves IP via DNS reverse lookup', async () => {
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      const domain = await networkMonitor.resolveIp('1.2.3.4');
      expect(domain).toBe('api.anthropic.com');
      expect(mockDnsReverse).toHaveBeenCalledWith('1.2.3.4');
    });

    it('caches within TTL', async () => {
      mockDnsReverse.mockResolvedValue(['cached.example.com']);
      await networkMonitor.resolveIp('5.5.5.5');
      await networkMonitor.resolveIp('5.5.5.5');
      expect(mockDnsReverse).toHaveBeenCalledTimes(1);
    });

    it('returns null on DNS error', async () => {
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));
      const domain = await networkMonitor.resolveIp('99.99.99.99');
      expect(domain).toBeNull();
    });

    it('caches null results from DNS errors', async () => {
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));
      await networkMonitor.resolveIp('99.99.99.99');
      const result = await networkMonitor.resolveIp('99.99.99.99');
      expect(result).toBeNull();
      expect(mockDnsReverse).toHaveBeenCalledTimes(1);
    });

    it('returns null when reverse returns empty array', async () => {
      mockDnsReverse.mockResolvedValue([]);
      const domain = await networkMonitor.resolveIp('4.4.4.4');
      expect(domain).toBeNull();
    });
  });

  describe('scanNetworkConnections()', () => {
    it('returns empty for no agents', async () => {
      const results = await networkMonitor.scanNetworkConnections([]);
      expect(results).toEqual([]);
      expect(mockGetRawTcp).not.toHaveBeenCalled();
    });

    it('enriches connections with agent info and domain', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);

      const agents = [{ pid: 100, agent: 'Claude Code', parentEditor: 'VS Code', cwd: '/proj', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        agent: 'Claude Code',
        pid: 100,
        parentEditor: 'VS Code',
        cwd: '/proj',
        remoteIp: '52.1.2.3',
        remotePort: 443,
        domain: 'api.anthropic.com',
        flagged: false,
      });
    });

    it('flags unknown domains', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '99.99.99.99', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['evil-server.xyz']);

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results[0].flagged).toBe(true);
    });

    it('flags connections with no domain resolution', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '99.99.99.99', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results[0].flagged).toBe(true);
      expect(results[0].domain).toBe('');
    });

    it('deduplicates by pid:ip:port', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 80, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(2);
    });

    it('filters out private IPs from raw connections', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '192.168.1.1', port: 3000, state: 'ESTAB' },
        { pid: 100, ip: '10.0.0.1', port: 8080, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].remoteIp).toBe('52.1.2.3');
    });

    it('handles multiple agents', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '1.1.1.1', port: 443, state: 'ESTAB' },
        { pid: 200, ip: '2.2.2.2', port: 80, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockImplementation((ip) => {
        if (ip === '1.1.1.1') return Promise.resolve(['a.anthropic.com']);
        return Promise.resolve(['unknown.xyz']);
      });

      const agents = [
        { pid: 100, agent: 'Claude Code', category: 'ai' },
        { pid: 200, agent: 'Copilot', category: 'ai' },
      ];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(2);
      expect(results[0].agent).toBe('Claude Code');
      expect(results[0].flagged).toBe(false);
      expect(results[1].agent).toBe('Copilot');
      expect(results[1].flagged).toBe(true);
    });

    it('uses PID label when agent not found in map', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 999, ip: '8.8.8.8', port: 53, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['dns.google']);

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('PID 999');
    });
  });

  describe('isNetworkScanRunning / setNetworkScanRunning', () => {
    it('tracks scan running state', () => {
      expect(networkMonitor.isNetworkScanRunning()).toBe(false);
      networkMonitor.setNetworkScanRunning(true);
      expect(networkMonitor.isNetworkScanRunning()).toBe(true);
      networkMonitor.setNetworkScanRunning(false);
      expect(networkMonitor.isNetworkScanRunning()).toBe(false);
    });
  });
});
