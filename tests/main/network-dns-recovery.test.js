import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const network = require('../../src/main/network-monitor.js');
let reverse;
let forward;
let clock;
beforeEach(() => {
  network._resetForTest();
  reverse = vi.fn().mockResolvedValue(['api.anthropic.com']);
  forward = vi.fn().mockResolvedValue(['203.0.113.8']);
  clock = 1000000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  network._setDepsForTest({ dnsReverse: reverse, dnsResolve: forward });
});
afterEach(() => {
  network._resetForTest();
  vi.restoreAllMocks();
});

describe('network DNS completeness and recovery', () => {
  it('checks later PTR names after a failed or mismatched candidate, without repeating aliases', async () => {
    reverse.mockResolvedValue([
      'broken.example',
      ' BROKEN.EXAMPLE. ',
      'wrong.example',
      'api.anthropic.com',
    ]);
    forward.mockImplementation(async (host) => {
      if (host === 'broken.example') throw new Error('SERVFAIL');
      return host === 'wrong.example' ? ['203.0.113.9'] : ['203.0.113.8'];
    });
    expect(await network.resolveIp('203.0.113.8')).toBe('api.anthropic.com');
    expect(forward.mock.calls.map(([name]) => name)).toEqual([
      'broken.example',
      'wrong.example',
      'api.anthropic.com',
    ]);
    expect(network.classifyConnection('203.0.113.8').verdict).toBe('allowlisted');
  });

  it('keeps all unconfirmed names untrusted', async () => {
    reverse.mockResolvedValue(['api.anthropic.com', 'api.openai.com']);
    forward.mockResolvedValue(['203.0.113.9']);
    expect(await network.resolveIp('203.0.113.8')).toBeNull();
    expect(network.classifyConnection('203.0.113.8')).toEqual({
      verdict: 'unknown',
      reason: 'ptr-unconfirmed',
      domain: '',
    });
  });

  it('shares one reverse/forward lookup across 50 simultaneous consumers', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => network.resolveIp('203.0.113.8')),
    );
    expect(results).toEqual(Array(50).fill('api.anthropic.com'));
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('shares a forward query across 50 distinct socket endpoints without losing their ownership', async () => {
    const addresses = Array.from({ length: 50 }, (_, i) => '203.0.113.' + (i + 1));
    const agents = addresses.map((_, i) => ({
      pid: i + 100,
      agent: 'Codex',
      instanceId: i + 100 + ':t1',
    }));
    forward.mockResolvedValue(addresses);
    network._setDepsForTest({
      getRawTcpConnections: async () =>
        addresses.map((ip, i) => ({ pid: i + 100, ip, port: 443, state: 'Established' })),
    });
    const result = await network.scanNetworkConnections(agents);
    expect(result).toHaveLength(50);
    expect(result.map((row) => row.instanceId)).toEqual(agents.map((agent) => agent.instanceId));
    expect(result.every((row) => row.domain === 'api.anthropic.com')).toBe(true);
    expect(reverse).toHaveBeenCalledTimes(50);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('keeps every resolved endpoint in a scan larger than the shared DNS cache', async () => {
    const addresses = Array.from(
      { length: 550 },
      (_, i) => `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
    );
    forward.mockResolvedValue(addresses);
    network._setDepsForTest({
      getRawTcpConnections: async () =>
        addresses.map((ip) => ({ pid: 100, ip, port: 443, state: 'Established' })),
    });
    const rows = await network.scanNetworkConnections([
      { pid: 100, agent: 'Codex', instanceId: '100:t1' },
    ]);
    expect(rows).toHaveLength(addresses.length);
    expect(
      rows.every((row) => row.domain === 'api.anthropic.com' && row.verdict === 'allowlisted'),
    ).toBe(true);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('shares cache and in-flight work across equivalent IPv6 spellings', async () => {
    forward.mockResolvedValue(['2001:db8::8']);
    expect(
      await Promise.all([
        network.resolveIp('2001:DB8::8'),
        network.resolveIp('2001:0db8:0:0:0:0:0:8'),
      ]),
    ).toEqual(['api.anthropic.com', 'api.anthropic.com']);
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(network.classifyConnection('2001:db8::8').domain).toBe('api.anthropic.com');
  });

  it('retries an unavailable name after 30 seconds, while positive results retain their five-minute TTL', async () => {
    reverse.mockRejectedValueOnce(new Error('EAI_AGAIN'));
    expect(await network.resolveIp('203.0.113.8')).toBeNull();
    clock += 29999;
    expect(await network.resolveIp('203.0.113.8')).toBeNull();
    expect(reverse).toHaveBeenCalledTimes(1);
    clock++;
    expect(await network.resolveIp('203.0.113.8')).toBe('api.anthropic.com');
    clock += 299999;
    expect(await network.resolveIp('203.0.113.8')).toBe('api.anthropic.com');
    expect(reverse).toHaveBeenCalledTimes(2);
    clock++;
    expect(network.classifyConnection('203.0.113.8').verdict).toBe('unknown');
    await network.resolveIp('203.0.113.8');
    expect(reverse).toHaveBeenCalledTimes(3);
  });

  it('does not trust cache entries after a backwards clock jump', async () => {
    await network.resolveIp('203.0.113.8');
    clock--;
    expect(network.classifyConnection('203.0.113.8').verdict).toBe('unknown');
    reverse.mockResolvedValue([]);
    expect(await network.resolveIp('203.0.113.8')).toBeNull();
  });

  it('does not let a lookup from a reset generation overwrite the current result', async () => {
    let release;
    reverse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = network.resolveIp('203.0.113.8');
    await Promise.resolve();
    network._resetForTest();
    network._setDepsForTest({
      dnsReverse: async () => ['api.openai.com'],
      dnsResolve: async () => ['203.0.113.8'],
    });
    expect(await network.resolveIp('203.0.113.8')).toBe('api.openai.com');
    release(['api.anthropic.com']);
    await old;
    expect(network.classifyConnection('203.0.113.8').domain).toBe('api.openai.com');
  });

  it('does not launch DNS work for malformed addresses', async () => {
    expect(await network.resolveIp('not-an-address')).toBeNull();
    expect(reverse).not.toHaveBeenCalled();
  });
});
