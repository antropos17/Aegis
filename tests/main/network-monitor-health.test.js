/**
 * Block B4 — network observation sensor health (B-S05 / B-S08).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

const require_ = createRequire(import.meta.url);

describe('network-monitor health (B4)', () => {
  let network;
  let mockGetRaw;

  beforeEach(() => {
    network = require_('../../src/main/network-monitor.js');
    mockGetRaw = vi.fn();
    network._resetForTest();
    network._setDepsForTest({
      getRawTcpConnections: mockGetRaw,
      dnsReverse: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
      dnsResolve: vi.fn().mockResolvedValue([]),
    });
  });

  it('starts STARTING with network sensor id', () => {
    const h = network.getNetworkSensorHealth();
    expect(h.sensorId).toBe('network');
    expect(h.state).toBe(SENSOR_HEALTH_STATE.STARTING);
  });

  it('B-S05: valid empty connections is HEALTHY (not FAILED)', async () => {
    mockGetRaw.mockResolvedValue([]);
    const agents = [{ agent: 'Claude', pid: 42, instanceId: '42:t' }];
    const result = await network.scanNetworkConnections(agents);
    expect(result).toEqual([]);
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.consecutiveFailures).toBe(0);
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('B-S05: valid non-empty connections preserved and HEALTHY', async () => {
    mockGetRaw.mockResolvedValue([{ pid: 42, ip: '8.8.8.8', port: 443, state: 'Established' }]);
    const agents = [{ agent: 'Claude', pid: 42, instanceId: '42:t' }];
    const result = await network.scanNetworkConnections(agents);
    expect(result.length).toBe(1);
    expect(result[0].remoteIp).toBe('8.8.8.8');
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
  });

  it('B-S05: provider throw → FAILED, lastSuccess not advanced, failures increment', async () => {
    mockGetRaw.mockRejectedValue(new Error('spawn ETIMEDOUT'));
    const agents = [{ agent: 'Claude', pid: 42, instanceId: '42:t' }];
    await expect(network.scanNetworkConnections(agents)).rejects.toThrow('ETIMEDOUT');
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(h.lastSuccessAt).toBeNull();
    expect(h.consecutiveFailures).toBe(1);
    expect(h.lastError).toMatch(/ETIMEDOUT/i);

    mockGetRaw.mockRejectedValue(new Error('spawn ETIMEDOUT'));
    await expect(network.scanNetworkConnections(agents)).rejects.toThrow();
    expect(network.getNetworkSensorHealth().consecutiveFailures).toBe(2);
  });

  it('B-S05 recovery: FAILED then valid scan → HEALTHY, failures reset', async () => {
    mockGetRaw.mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce([]);
    const agents = [{ agent: 'Claude', pid: 42, instanceId: '42:t' }];
    await expect(network.scanNetworkConnections(agents)).rejects.toThrow();
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.FAILED);
    await network.scanNetworkConnections(agents);
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.consecutiveFailures).toBe(0);
    expect(h.lastError).toBeNull();
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('B-S08: confirmed-zero skip → HEALTHY (agent-scoped vacuous success)', () => {
    network.noteNetworkSkip('confirmed-zero-agents');
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.detail).toBe('confirmed-zero-agents');
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('B-S08: process-unavailable skip → DEGRADED, not HEALTHY, lastSuccess not advanced', () => {
    const h0 = network.getNetworkSensorHealth();
    expect(h0.lastSuccessAt).toBeNull();
    network.noteNetworkSkip('process-observation-unavailable');
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    expect(h.state).not.toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.detail).toBe('process-observation-unavailable');
    expect(h.lastSuccessAt).toBeNull();
  });

  it('B-S08: prior HEALTHY + process-unavailable skip leaves HEALTHY (stale)', async () => {
    mockGetRaw.mockResolvedValue([]);
    await network.scanNetworkConnections([{ agent: 'Claude', pid: 1, instanceId: '1:t' }]);
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    const successAt = network.getNetworkSensorHealth().lastSuccessAt;

    network.noteNetworkSkip('process-observation-unavailable');
    const h = network.getNetworkSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    expect(h.state).not.toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.lastSuccessAt).toBe(successAt);
  });

  it('B-S08 recovery: process-unavailable then provider success → HEALTHY', async () => {
    network.noteNetworkSkip('process-observation-unavailable');
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    mockGetRaw.mockResolvedValue([]);
    await network.scanNetworkConnections([{ agent: 'Claude', pid: 1, instanceId: '1:t' }]);
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
  });

  it('getNetworkSensorHealth is JSON-serializable plain data', async () => {
    mockGetRaw.mockResolvedValue([]);
    await network.scanNetworkConnections([{ agent: 'X', pid: 9, instanceId: '9:t' }]);
    const h = network.getNetworkSensorHealth();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });

  it('defensive empty agents does not mark HEALTHY (orchestration owns skip)', async () => {
    const result = await network.scanNetworkConnections([]);
    expect(result).toEqual([]);
    expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.STARTING);
    expect(mockGetRaw).not.toHaveBeenCalled();
  });
});
