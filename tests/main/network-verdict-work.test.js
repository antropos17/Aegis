import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const network = require('../../src/main/network-monitor.js');
const ip = '203.0.113.8';
const host = 'api.openai.com';
let raw, reverse, forward, now;
const agent = { pid: 100, agent: 'Codex', instanceId: '100:first', category: 'ai' };

beforeEach(() => {
  network._resetForTest();
  now = 1000000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  raw = vi.fn();
  reverse = vi.fn().mockResolvedValue([host]);
  forward = vi.fn().mockResolvedValue([ip]);
  network._setDepsForTest({ getRawTcpConnections: raw, dnsReverse: reverse, dnsResolve: forward });
});
afterEach(() => {
  network._resetForTest();
  vi.restoreAllMocks();
});

describe('per-scan endpoint verdict work', () => {
  it('keeps domain classification work independent of sockets sharing an address', async () => {
    network.isKnownDomain(host);
    await network.resolveIp(ip);
    const lower = String.prototype.toLowerCase;
    let domainChecks = 0;
    vi.spyOn(String.prototype, 'toLowerCase').mockImplementation(function () {
      if (String(this) === host) domainChecks++;
      return lower.call(this);
    });
    const run = async (count) => {
      raw.mockResolvedValue(
        Array.from({ length: count }, (_, i) => ({
          pid: 100,
          ip,
          port: 443,
          localIp: '192.0.2.1',
          localPort: 10000 + i,
          state: 'Established',
        })),
      );
      domainChecks = 0;
      const result = await network.scanNetworkConnections([agent]);
      expect(result).toHaveLength(count);
      expect(
        result.every(
          (row, i) =>
            row.localPort === 10000 + i &&
            row.domain === host &&
            row.instanceId === agent.instanceId,
        ),
      ).toBe(true);
      return domainChecks;
    };
    const small = await run(10);
    const large = await run(1000);
    expect(large).toBeLessThanOrEqual(small + 1);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('shares equivalent address verdicts without sharing socket or owner fields', async () => {
    const other = { ...agent, pid: 200, instanceId: '200:first', cwd: '/other' };
    raw.mockResolvedValue([
      { pid: 100, ip, port: 80, localIp: '192.0.2.1', localPort: 1234, state: 'Established' },
      {
        pid: 200,
        ip: '::ffff:203.0.113.8',
        port: 443,
        localIp: '192.0.2.1',
        localPort: 1235,
        state: 'CloseWait',
      },
      { pid: 999, ip, port: 443, state: 'Established' },
      { pid: 999, ip, port: 443, state: 'Established' },
    ]);
    const rows = await network.scanNetworkConnections([agent, other]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      pid: 100,
      instanceId: '100:first',
      remoteIp: ip,
      httpUnencrypted: true,
    });
    expect(rows[1]).toMatchObject({
      pid: 200,
      instanceId: '200:first',
      remoteIp: '::ffff:203.0.113.8',
      cwd: '/other',
      state: 'CloseWait',
      httpUnencrypted: false,
    });
    expect(rows[2]).toMatchObject({ agent: '', instanceId: null, localPort: null });
    expect(rows[3]).not.toBe(rows[2]);
    expect(rows.every((row) => row.verdict === 'allowlisted' && row.domain === host)).toBe(true);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('reclassifies after DNS expiry and keeps new process identity and failure health', async () => {
    raw.mockResolvedValue([{ pid: 100, ip, port: 443, state: 'Established' }]);
    expect((await network.scanNetworkConnections([agent]))[0].verdict).toBe('allowlisted');
    now += 300001;
    reverse.mockResolvedValue(['untrusted.fixture.invalid']);
    const replacement = { ...agent, instanceId: '100:second' };
    expect((await network.scanNetworkConnections([replacement]))[0]).toMatchObject({
      instanceId: '100:second',
      verdict: 'flagged',
      verdictReason: 'domain-not-allowlisted',
      domain: 'untrusted.fixture.invalid',
    });
    now += 300001;
    forward.mockResolvedValue(['203.0.113.9']);
    expect((await network.scanNetworkConnections([replacement]))[0]).toMatchObject({
      verdict: 'unknown',
      verdictReason: 'ptr-unconfirmed',
      domain: '',
    });
    expect(reverse).toHaveBeenCalledTimes(3);
    raw.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(network.scanNetworkConnections([replacement])).rejects.toThrow(
      'provider unavailable',
    );
    expect(network.getNetworkSensorHealth().state).toBe('FAILED');
    raw.mockResolvedValue([]);
    expect(await network.scanNetworkConnections([replacement])).toEqual([]);
    expect(network.getNetworkSensorHealth().state).toBe('HEALTHY');
  });
});
