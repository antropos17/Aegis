import { expect, it, vi, afterEach } from 'vitest';
import {
  calculateRiskScore,
  calculateRiskFactors,
} from '../../src/renderer/lib/utils/risk-scoring';
import { instances, emptyTelemetry } from '../../frontend/observatory/runtime/host';
import { riskContext, leadingRiskReason } from '../../frontend/observatory/runtime/risk-context';

const agent = (id, pid) => ({ agent: 'Codex', process: 'codex.exe', instanceId: id, pid });
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent('one', 1), agent('two', 2)],
  events: [
    {
      instanceId: 'two',
      file: 'C:/settings',
      sensitive: true,
      reason: 'Sensitive configuration',
      timestamp: Date.now(),
    },
  ],
  network: [
    { instanceId: 'one', verdict: 'flagged' },
    { instanceId: 'one', verdict: 'flagged' },
  ],
});
afterEach(() => vi.useRealTimers());

it('exposes the same capped factors used by the existing score', () => {
  const input = {
    sensitiveFiles: 2,
    configFiles: 4,
    sshAwsFiles: 1,
    networkCount: 4,
    flaggedDomains: 1,
    unknownDomains: 1,
    fileCount: 10,
    httpUnencryptedCount: 1,
  };
  expect(calculateRiskScore(input)).toBe(44);
  expect(calculateRiskFactors(input)).toEqual([
    { id: 'sensitive', points: (2 * 5) / 1.2 },
    { id: 'config', points: 2 },
    { id: 'network', points: 2 },
    { id: 'endpoints', points: 11 },
    { id: 'files', points: 0.2 },
    { id: 'credentials', points: 5 },
    { id: 'http', points: 15 },
  ]);
  expect(
    calculateRiskScore({
      sensitiveFiles: 100,
      configFiles: 100,
      sshAwsFiles: 100,
      networkCount: 100,
      flaggedDomains: 100,
      fileCount: 1000,
      httpUnencryptedCount: 1,
    }),
  ).toBe(100);
});

it('explains the highest exact process instead of summing different workers', () => {
  const telemetry = state();
  const context = riskContext({ agentGroupKey: 'Codex' }, telemetry);
  expect(context.subject.instanceId).toBe('one');
  expect(context.score).toBe(17);
  expect(context.processCount).toBe(2);
  expect(context.contributions.map((f) => f.id)).toEqual(['endpoints', 'network']);
  expect(leadingRiskReason(instances(telemetry)[0])).toBe('Destination checks');
});

it('captures actual saved adjustments and excludes unlinked namesakes', () => {
  const telemetry = state();
  telemetry.falsePositives = [{ agentName: 'Codex' }];
  telemetry.events.push({
    instanceId: null,
    agent: 'Codex',
    sensitive: true,
    timestamp: Date.now(),
  });
  const context = riskContext({ agentGroupKey: 'Codex' }, telemetry);
  expect(context.score).toBe(0);
  expect(context.adjustment).toBe(-17);
  expect(context.contributions.map((f) => f.id)).not.toContain('sensitive');
});

it('retains the explanation of a captured process when new telemetry changes its score', () => {
  const telemetry = state();
  const captured = instances(telemetry)[0];
  telemetry.network = [];
  expect(riskContext(captured, telemetry)).toMatchObject({ score: 17, captured: true });
  expect(riskContext({ agentGroupKey: 'Codex' }, telemetry).score).toBe(5);
  telemetry.agents = [agent('replacement', 1)];
  expect(
    riskContext({ process: 'codex.exe', instanceId: 'one', pid: 1 }, telemetry).subject,
  ).toBeUndefined();
  expect(riskContext(captured, telemetry).score).toBe(17);
});

it('keeps missing identity explicit and does not invent a group when it has disappeared', () => {
  const telemetry = { ...emptyTelemetry(), agents: [agent(null, 1)] };
  const context = riskContext({ agentGroupKey: 'Codex' }, telemetry);
  expect(context.unlinked).toBe(1);
  expect(context.contributions).toEqual([]);
  expect(leadingRiskReason(instances(telemetry)[0])).toContain('cannot be linked');
  expect(riskContext({ agentGroupKey: 'Gone' }, telemetry).subject).toBeUndefined();
});
