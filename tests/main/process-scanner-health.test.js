/**
 * Block B3 — process enumeration sensor health.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

const require_ = createRequire(import.meta.url);

describe('process-scanner health (B3)', () => {
  let scanner;
  let mockListProcesses;

  beforeEach(() => {
    // Fresh module not required — _resetForTest recreates health.
    scanner = require_('../../src/main/process-scanner.js');
    mockListProcesses = vi.fn();
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses: mockListProcesses });
    scanner.init({ trackSeenAgent: vi.fn() });
    scanner.peakAgents = 0;
  });

  it('starts STARTING with process sensor id', () => {
    const h = scanner.getProcessSensorHealth();
    expect(h.sensorId).toBe('process');
    expect(h.state).toBe(SENSOR_HEALTH_STATE.STARTING);
  });

  it('valid empty fleet is HEALTHY (not FAILED)', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'chrome', pid: 1 }]);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.reliable).toBe(true);
    const h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(scanner.isProcessPopulationReliable()).toBe(true);
  });

  it('non-empty detection is HEALTHY', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 100 }]);
    const result = await scanner.scanProcesses();
    expect(result.agents.length).toBeGreaterThan(0);
    expect(result.reliable).toBe(true);
    expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
  });

  it('B-S01: EPERM → reliable false, agents [], health FAILED, lastSuccess not advanced', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.reliable).toBe(false);
    const h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(h.lastSuccessAt).toBeNull();
    expect(h.lastError).toMatch(/Access is denied|denied/i);
    expect(h.consecutiveFailures).toBe(1);
    expect(scanner.isProcessPopulationReliable()).toBe(false);
  });

  it('reliable:false never coexists with HEALTHY', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);
    const result = await scanner.scanProcesses();
    expect(result.reliable).toBe(false);
    expect(scanner.getProcessSensorHealth().state).not.toBe(SENSOR_HEALTH_STATE.HEALTHY);
  });

  it('B-S01 recovery: EPERM then valid scan → HEALTHY, failures reset', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce([{ name: 'claude', pid: 9 }]);
    await scanner.scanProcesses();
    expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.FAILED);
    await scanner.scanProcesses();
    const h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.consecutiveFailures).toBe(0);
    expect(h.lastError).toBeNull();
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('B-S01 sibling: an enumeration with no process at all is DEGRADED, not a clean fleet', async () => {
    // The provider resolved without an error and still handed over nothing. A live OS
    // lists at least the process doing the asking, so this is an unread table, and a
    // zero-agent fleet derived from it is the same false-clean EPERM used to produce.
    mockListProcesses.mockResolvedValue([]);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.reliable).toBe(false);
    const h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    expect(h.detail).toBe('empty-process-table');
    expect(h.lastError).toBe('empty-process-table');
    // Nothing refused the observation, so this is not a failure...
    expect(h.consecutiveFailures).toBe(0);
    // ...and it is not a success either.
    expect(h.lastSuccessAt).toBeNull();
    expect(scanner.isProcessPopulationReliable()).toBe(false);
    expect(scanner.getProcessCapabilities().populationState).toBe(SENSOR_HEALTH_STATE.DEGRADED);
  });

  it('a provider that resolves a non-array is read the same way', async () => {
    mockListProcesses.mockResolvedValue(undefined);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.reliable).toBe(false);
    expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
  });

  it('EPERM stays FAILED — its own empty list must not demote it to DEGRADED', async () => {
    // The permission-denied path sets `processes = []` before falling through to the
    // shared empty-list bookkeeping. Without the reliability guard on the DEGRADED rung
    // it would be re-marked there and a total denial would report as a partial one.
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);
    await scanner.scanProcesses();
    const h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(h.detail).toBe('permission-denied');
    expect(h.consecutiveFailures).toBe(1);
  });

  it('recovery: an unread table then a read one → HEALTHY', async () => {
    mockListProcesses.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'chrome', pid: 3 }]);
    await scanner.scanProcesses();
    expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    const result = await scanner.scanProcesses();
    const h = scanner.getProcessSensorHealth();
    // A read table holding no AGENT is a confirmed clean fleet — agent cardinality was
    // never the question the DEGRADED rung answers.
    expect(result.agents).toEqual([]);
    expect(result.reliable).toBe(true);
    expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(h.lastError).toBeNull();
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('B-S02: noteProcessScanHardFailure marks FAILED and increments failures', () => {
    scanner.noteProcessScanHardFailure(new Error('spawn ENOENT'));
    let h = scanner.getProcessSensorHealth();
    expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(h.consecutiveFailures).toBe(1);
    scanner.noteProcessScanHardFailure(new Error('spawn ENOENT'));
    h = scanner.getProcessSensorHealth();
    expect(h.consecutiveFailures).toBe(2);
  });

  it('getProcessSensorHealth is JSON-serializable plain data', async () => {
    mockListProcesses.mockResolvedValue([]);
    await scanner.scanProcesses();
    const h = scanner.getProcessSensorHealth();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});
