import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import networkMonitor from '../../src/main/network-monitor.js';

describe('network-monitor', () => {
  describe('isKnownDomain()', () => {
    it('recognizes the published Claude Code endpoints', () => {
      expect(networkMonitor.isKnownDomain('api.anthropic.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('code.claude.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('mcp-proxy.anthropic.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('registry.npmjs.org')).toBe(true);
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

    it('accepts a trailing dot and mixed case (PTR names carry both)', () => {
      expect(networkMonitor.isKnownDomain('API.Anthropic.COM.')).toBe(true);
    });

    it('rejects unknown domains', () => {
      expect(networkMonitor.isKnownDomain('evil-hacker.xyz')).toBe(false);
      expect(networkMonitor.isKnownDomain('malware.ru')).toBe(false);
    });

    it('matches on a label boundary, not a bare suffix', () => {
      // `evilclaude.ai` ends with the allowlisted string `claude.ai` but is a different
      // domain, registered by someone else. The old suffix regex accepted it.
      expect(networkMonitor.isKnownDomain('evilclaude.ai')).toBe(false);
      expect(networkMonitor.isKnownDomain('notapi.anthropic.com')).toBe(false);
      expect(networkMonitor.isKnownDomain('claude.ai')).toBe(true);
    });

    it('includes agent-database.json domains', () => {
      expect(networkMonitor.isKnownDomain('claude.ai')).toBe(true);
    });

    it('does not allowlist generic cloud tenancy suffixes', () => {
      // Every one of these is a name any renter of the platform can obtain. Matching one
      // proves who owns the hardware, not who owns the endpoint.
      expect(networkMonitor.isKnownDomain('10.104.79.160.bc.googleusercontent.com')).toBe(false);
      expect(networkMonitor.isKnownDomain('ec2-52-1-2-3.compute-1.amazonaws.com')).toBe(false);
      expect(networkMonitor.isKnownDomain('s3.amazonaws.com')).toBe(false);
      expect(networkMonitor.isKnownDomain('blob.core.windows.net')).toBe(false);
      expect(networkMonitor.isKnownDomain('d123.cloudfront.net')).toBe(false);
      expect(networkMonitor.isKnownDomain('cdn.fastly.net')).toBe(false);
      expect(networkMonitor.isKnownDomain('any-host.1e100.net')).toBe(false);
      expect(networkMonitor.isKnownDomain('tenant.repl.co')).toBe(false);
    });

    it('keeps the named service while its generic parent is rejected', () => {
      expect(networkMonitor.isKnownDomain('storage.googleapis.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('anything-else.googleapis.com')).toBe(false);
      expect(networkMonitor.isKnownDomain('raw.githubusercontent.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('copilot-telemetry.githubusercontent.com')).toBe(true);
      expect(networkMonitor.isKnownDomain('pages.githubusercontent.com')).toBe(false);
    });

    it('recognizes new AI-agent vendor domains (Kilo, opencode, grok/xAI)', () => {
      expect(networkMonitor.isKnownDomain('kilo.ai')).toBe(true);
      expect(networkMonitor.isKnownDomain('kilocode.ai')).toBe(true);
      expect(networkMonitor.isKnownDomain('api.kilocode.ai')).toBe(true);
      expect(networkMonitor.isKnownDomain('opencode.ai')).toBe(true);
      // The database lists `api.x.ai`, not a bare `x.ai` — so only the listed host matches.
      expect(networkMonitor.isKnownDomain('api.x.ai')).toBe(true);
      expect(networkMonitor.isKnownDomain('x.ai')).toBe(false);
    });

    it('does not let the short x.ai pattern match unrelated .ai domains', () => {
      expect(networkMonitor.isKnownDomain('netflix.ai')).toBe(false);
      expect(networkMonitor.isKnownDomain('phoenix.ai')).toBe(false);
    });

    it('rejects an empty domain', () => {
      expect(networkMonitor.isKnownDomain('')).toBe(false);
    });
  });

  describe('isAllowlistedIp()', () => {
    it('matches the published inbound range 160.79.104.0/23', () => {
      expect(networkMonitor.isAllowlistedIp('160.79.104.10')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('160.79.104.0')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('160.79.105.255')).toBe(true);
    });

    it('does not extend to the outbound /21 around it', () => {
      // 160.79.106.1 and 160.79.111.255 sit inside Anthropic's OUTBOUND /21 but outside the
      // inbound /23 an agent actually dials. The allowlist covers what is dialled, no more.
      expect(networkMonitor.isAllowlistedIp('160.79.106.1')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('160.79.111.255')).toBe(false);
    });

    it('matches numerically, not by string prefix', () => {
      // Shares the textual prefix `160.79.1` with the range address but sits outside it.
      expect(networkMonitor.isAllowlistedIp('160.79.112.0')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('160.79.103.255')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('160.79.1.1')).toBe(false);
    });

    it('unwraps an IPv4-mapped IPv6 address', () => {
      expect(networkMonitor.isAllowlistedIp('::ffff:160.79.104.10')).toBe(true);
    });

    it('matches the published IPv6 range 2607:6bc0::/48', () => {
      // The API is reachable over IPv6, and an IPv6-preferring host will use it. Without
      // this range that connection would fall through to a name check it can never pass.
      expect(networkMonitor.isAllowlistedIp('2607:6bc0::10')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('2607:6bc0:0:0:0:0:0:10')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('2607:6BC0::ABCD')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('2607:6bc0:0:ffff::1')).toBe(true);
      // The prefix is 48 bits, so the third group is inside it and must match.
      expect(networkMonitor.isAllowlistedIp('2607:6bc0:1::1')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('2607:6bc1::1')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('2606:4700::1111')).toBe(false);
    });

    it('never matches an address against the other family prefix', () => {
      expect(networkMonitor.isAllowlistedIp('160.79.104.10%eth0')).toBe(true);
      expect(networkMonitor.isAllowlistedIp('::a04f:680a')).toBe(false);
    });

    it('returns false for malformed input', () => {
      expect(networkMonitor.isAllowlistedIp('160.79.104')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('160.79.104.999')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('not-an-address')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('2607:6bc0:::1')).toBe(false);
      expect(networkMonitor.isAllowlistedIp('')).toBe(false);
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
  let mockDnsResolve;

  /**
   * Forward-confirming resolver: every hostname maps back to the address it came from.
   * @param {Record<string, string[]>} map hostname → addresses
   */
  const forwardMap = (map) => (hostname) => Promise.resolve(map[hostname] || []);

  beforeEach(() => {
    mockGetRawTcp = vi.fn();
    mockDnsReverse = vi.fn();
    mockDnsResolve = vi.fn().mockResolvedValue([]);
    networkMonitor._resetForTest();
    networkMonitor._setDepsForTest({
      getRawTcpConnections: mockGetRawTcp,
      dnsReverse: mockDnsReverse,
      dnsResolve: mockDnsResolve,
    });
  });

  afterEach(() => {
    networkMonitor._resetForTest();
  });

  describe('resolveIp()', () => {
    it('resolves IP via DNS reverse lookup when the name forward-confirms', async () => {
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      mockDnsResolve.mockResolvedValue(['1.2.3.4']);
      const domain = await networkMonitor.resolveIp('1.2.3.4');
      expect(domain).toBe('api.anthropic.com');
      expect(mockDnsReverse).toHaveBeenCalledWith('1.2.3.4');
      expect(mockDnsResolve).toHaveBeenCalledWith('api.anthropic.com');
    });

    it('discards a PTR name that does not resolve back to the same address', async () => {
      // The owner of an address writes its own PTR record. Without forward confirmation
      // that record is attacker-supplied text, not an identity.
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      mockDnsResolve.mockResolvedValue(['160.79.104.10']);
      const domain = await networkMonitor.resolveIp('45.33.32.156');
      expect(domain).toBeNull();
    });

    it('discards a PTR name whose forward lookup fails', async () => {
      mockDnsReverse.mockResolvedValue(['ghost.example.com']);
      mockDnsResolve.mockRejectedValue(new Error('ENOTFOUND'));
      expect(await networkMonitor.resolveIp('45.33.32.157')).toBeNull();
    });

    it('caches within TTL', async () => {
      mockDnsReverse.mockResolvedValue(['cached.example.com']);
      mockDnsResolve.mockResolvedValue(['5.5.5.5']);
      await networkMonitor.resolveIp('5.5.5.5');
      await networkMonitor.resolveIp('5.5.5.5');
      expect(mockDnsReverse).toHaveBeenCalledTimes(1);
      expect(mockDnsResolve).toHaveBeenCalledTimes(1);
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
      expect(mockDnsResolve).not.toHaveBeenCalled();
    });
  });

  describe('scanNetworkConnections()', () => {
    it('returns empty for no agents', async () => {
      const results = await networkMonitor.scanNetworkConnections([]);
      expect(results).toEqual([]);
      expect(mockGetRawTcp).not.toHaveBeenCalled();
    });

    it('allowlists the published Anthropic range without any DNS lookup', async () => {
      // api.anthropic.com resolves to 160.79.104.10, which publishes no PTR record at all.
      // The old check read that absence as evidence and marked the agent's own API
      // endpoint FLAGGED. Range membership is published and verifiable; a PTR is not.
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results[0]).toMatchObject({
        remoteIp: '160.79.104.10',
        verdict: 'allowlisted',
        verdictReason: networkMonitor.VERDICT_REASONS.IP_ALLOWLIST,
        flagged: false,
        domain: '',
      });
      expect(mockDnsReverse).not.toHaveBeenCalled();
    });

    it('allowlists the API endpoint over IPv6 as well', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '2607:6bc0::10', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results[0]).toMatchObject({
        verdict: 'allowlisted',
        verdictReason: networkMonitor.VERDICT_REASONS.IP_ALLOWLIST,
        flagged: false,
      });
      expect(mockDnsReverse).not.toHaveBeenCalled();
    });

    it('does not allowlist a host whose PTR is a generic cloud name', async () => {
      // A rented GCE instance gets a bc.googleusercontent.com PTR for free. Under the old
      // hardcoded suffix that made it SAFE.
      const ip = '34.83.12.7';
      const ptr = '7.12.83.34.bc.googleusercontent.com';
      mockGetRawTcp.mockResolvedValue([{ pid: 100, ip, port: 443, state: 'ESTAB' }]);
      mockDnsReverse.mockResolvedValue([ptr]);
      mockDnsResolve.mockImplementation(forwardMap({ [ptr]: [ip] }));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results[0]).toMatchObject({
        domain: ptr,
        verdict: 'flagged',
        verdictReason: networkMonitor.VERDICT_REASONS.DOMAIN_NOT_ALLOWLISTED,
        flagged: true,
      });
    });

    it('discards a PTR that fails forward confirmation and reports unknown', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '45.33.32.156', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      mockDnsResolve.mockResolvedValue(['160.79.104.10']);

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results[0]).toMatchObject({
        domain: '',
        verdict: 'unknown',
        verdictReason: networkMonitor.VERDICT_REASONS.PTR_UNCONFIRMED,
      });
      // An unconfirmed name never reaches the record — not as the domain, not anywhere.
      expect(results[0].domain).not.toContain('anthropic');
    });

    it('reports an address with no name at all as unknown, not flagged', async () => {
      mockGetRawTcp.mockResolvedValue([{ pid: 100, ip: '99.99.99.99', port: 443, state: 'ESTAB' }]);
      mockDnsReverse.mockRejectedValue(new Error('ENOTFOUND'));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results[0].verdict).toBe('unknown');
      expect(results[0].verdictReason).toBe(networkMonitor.VERDICT_REASONS.PTR_MISSING);
      expect(results[0].domain).toBe('');
      // `flagged` keeps its original meaning — "not confirmed allowlisted" — so the
      // existing consumers do not start reporting an unidentified endpoint as safe.
      expect(results[0].flagged).toBe(true);
    });

    it('every verdict carries a reason code', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '99.99.99.99', port: 443, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockImplementation((ip) =>
        ip === '52.1.2.3' ? Promise.resolve(['api.github.com']) : Promise.reject(new Error('ENO')),
      );
      mockDnsResolve.mockImplementation(forwardMap({ 'api.github.com': ['52.1.2.3'] }));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);

      expect(results).toHaveLength(3);
      const codes = Object.values(networkMonitor.VERDICT_REASONS);
      for (const r of results) {
        expect(['allowlisted', 'unknown', 'flagged']).toContain(r.verdict);
        expect(codes).toContain(r.verdictReason);
      }
      expect(results[1]).toMatchObject({
        verdict: 'allowlisted',
        verdictReason: networkMonitor.VERDICT_REASONS.DOMAIN_ALLOWLIST,
      });
    });

    it('enriches connections with agent info and domain', async () => {
      mockGetRawTcp.mockResolvedValue([{ pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' }]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      mockDnsResolve.mockImplementation(forwardMap({ 'api.anthropic.com': ['52.1.2.3'] }));

      const agents = [
        { pid: 100, agent: 'Claude Code', parentEditor: 'VS Code', cwd: '/proj', category: 'ai' },
      ];
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
        verdict: 'allowlisted',
        verdictReason: networkMonitor.VERDICT_REASONS.DOMAIN_ALLOWLIST,
        flagged: false,
      });
    });

    it('flags unknown domains', async () => {
      mockGetRawTcp.mockResolvedValue([{ pid: 100, ip: '99.99.99.99', port: 443, state: 'ESTAB' }]);
      mockDnsReverse.mockResolvedValue(['evil-server.xyz']);
      mockDnsResolve.mockImplementation(forwardMap({ 'evil-server.xyz': ['99.99.99.99'] }));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results[0].flagged).toBe(true);
      expect(results[0].verdict).toBe('flagged');
    });

    it('deduplicates by pid:ip:port', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 443, state: 'ESTAB' },
        { pid: 100, ip: '52.1.2.3', port: 80, state: 'ESTAB' },
      ]);
      mockDnsReverse.mockResolvedValue(['api.anthropic.com']);
      mockDnsResolve.mockImplementation(forwardMap({ 'api.anthropic.com': ['52.1.2.3'] }));

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
      mockDnsResolve.mockImplementation(forwardMap({ 'api.anthropic.com': ['52.1.2.3'] }));

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
        if (ip === '1.1.1.1') return Promise.resolve(['api.anthropic.com']);
        return Promise.resolve(['unknown.xyz']);
      });
      mockDnsResolve.mockImplementation(
        forwardMap({ 'api.anthropic.com': ['1.1.1.1'], 'unknown.xyz': ['2.2.2.2'] }),
      );

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

    it('keeps no agent name when the pid is not in the map (C-01)', async () => {
      // Previously this synthesized `PID 999`. That name reaches the audit log, where a
      // fabricated agent is indistinguishable from a real one — and under Event Schema v1
      // it would sit beside an attribution status, dressing a guess as a resolved owner.
      mockGetRawTcp.mockResolvedValue([{ pid: 999, ip: '8.8.8.8', port: 53, state: 'ESTAB' }]);
      mockDnsReverse.mockResolvedValue(['dns.google']);
      mockDnsResolve.mockImplementation(forwardMap({ 'dns.google': ['8.8.8.8'] }));

      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai' }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('');
      // The pid itself is still reported — it is an observation, not a guess.
      expect(results[0].pid).toBe(999);
    });
  });

  // A NetworkConnection must carry the process-INSTANCE key of the agent whose pid
  // the OS reported as owning the socket, read off that agent object inside this
  // same call. Without it the renderer can only correlate connections by pid or by
  // display name, and neither survives a pid recycle or a second instance.
  describe('scanNetworkConnections() — instanceId', () => {
    it('stamps the matched agent exact key', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
      ]);
      const agents = [
        {
          pid: 100,
          agent: 'Claude Code',
          category: 'ai',
          instanceId: '100:1700000000111',
        },
      ];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('Claude Code');
      expect(results[0].instanceId).toBe('100:1700000000111');
    });

    // Same C-01 rule that keeps `agent` blank: an unowned connection gets no key.
    // The agent that IS online sits right there in the map and must not be borrowed.
    it('leaves instanceId null when the pid matches no agent (C-01)', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 999, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
      ]);
      const agents = [
        { pid: 100, agent: 'Claude Code', category: 'ai', instanceId: '100:1700000000111' },
      ];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('');
      expect(results[0].instanceId).toBeNull();
      expect(results[0].instanceId).not.toBe('100:1700000000111');
    });

    // Read, never re-derive: this agent has a pid and a startTime, so
    // buildInstanceId() would return a plausible '100:1700000000111' — a key that
    // appears in no scan-batch and joins to nothing.
    it('leaves instanceId null for an agent that carries no key of its own', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
      ]);
      const agents = [{ pid: 100, agent: 'Claude Code', category: 'ai', startTime: 1700000000111 }];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('Claude Code');
      expect(results[0].instanceId).toBeNull();
    });

    // Two live instances of ONE agent name, each with its own socket. The display
    // name is identical, so only the key separates them.
    it('gives two same-name instances two different keys', async () => {
      mockGetRawTcp.mockResolvedValue([
        { pid: 100, ip: '160.79.104.10', port: 443, state: 'ESTAB' },
        { pid: 200, ip: '160.79.104.11', port: 443, state: 'ESTAB' },
      ]);
      const agents = [
        {
          pid: 100,
          agent: 'Claude Code',
          category: 'ai',
          cwd: '/home/user/projA',
          instanceId: '100:1700000000111',
        },
        {
          pid: 200,
          agent: 'Claude Code',
          category: 'ai',
          cwd: '/home/user/projB',
          instanceId: '200:1700000000222',
        },
      ];
      const results = await networkMonitor.scanNetworkConnections(agents);
      expect(results).toHaveLength(2);
      expect(results.map((c) => c.agent)).toEqual(['Claude Code', 'Claude Code']);
      expect(results[0].instanceId).toBe('100:1700000000111');
      expect(results[1].instanceId).toBe('200:1700000000222');
      expect(new Set(results.map((c) => c.instanceId)).size).toBe(2);
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
