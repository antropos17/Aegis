import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';

// Keep the app's header and toast wiring real; tab contents are unrelated to notifications.
vi.mock('../../../src/renderer/lib/components/ShieldTab.svelte', () => ({ default: () => {} }));
vi.mock('../../../src/renderer/lib/components/ActivityTab.svelte', () => ({ default: () => {} }));
vi.mock('../../../src/renderer/lib/components/RulesTab.svelte', () => ({ default: () => {} }));
vi.mock('../../../src/renderer/lib/components/ReportsTab.svelte', () => ({ default: () => {} }));
vi.mock('../../../src/renderer/lib/components/AgentStatsPanel.svelte', () => ({
  default: () => {},
}));
vi.mock('../../../src/renderer/lib/components/OptionsPanel.svelte', () => ({ default: () => {} }));

const noop = () => {};
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', noop);
window.aegis = {
  onScanBatch: noop,
  onFileAccess: noop,
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: async () => ({}),
  getResourceUsage: async () => ({}),
  getFalsePositives: async () => [],
  getSettings: async () => ({}),
  getAppVersion: async () => 'test',
};

const { agents, anomalies, scanActive, firstScanDone } =
  await import('../../../src/renderer/lib/stores/ipc.js');
const { toasts, clearAllToasts } = await import('../../../src/renderer/lib/stores/toast.js');
const App = (await import('../../../src/renderer/App.svelte')).default;

function population(count) {
  return Array.from({ length: count }, (_, i) => ({
    agent: ['Agent A', 'Agent B', 'Agent C'][i % 3],
    pid: 100 + i,
    instanceId: `${100 + i}:1000`,
    type: 'cli',
    applicationGroup: { id: `app-${i % 3}`, rootPid: 100 + (i % 3) },
  }));
}

beforeEach(() => {
  agents.set([]);
  anomalies.set({});
  scanActive.set(false);
  firstScanDone.set(false);
  clearAllToasts();
});
afterEach(clearAllToasts);

describe('App background scan feedback', () => {
  it('updates separate agent, application and process counts without success-toast churn', async () => {
    const { container } = render(App);
    await tick();
    agents.set(population(22));
    firstScanDone.set(true);
    await tick();

    const header = container.querySelector('.header-stats');
    expect(header).toHaveTextContent('3 agents');
    expect(header).toHaveTextContent('3 App instances · 22 processes');
    expect(get(toasts)).toEqual([]);

    scanActive.set(true);
    await tick();
    expect(header).toHaveTextContent('Scanning');
    agents.set(population(23));
    scanActive.set(false);
    await tick();
    expect(header).toHaveTextContent('3 App instances · 23 processes');
    expect(header).toHaveTextContent('Idle');
    expect(get(toasts)).toEqual([]);

    agents.set([]);
    await tick();
    expect(header).toHaveTextContent('0 agents');
    expect(header).toHaveTextContent('0 App instances · 0 processes');
    expect(get(toasts)).toEqual([]);
  });

  it('still reports a new anomaly while background population changes stay quiet', async () => {
    const { getByRole } = render(App);
    anomalies.set({ 'Agent A': 5 });
    await tick();
    agents.set(population(22));
    anomalies.set({ 'Agent A': 80 });
    await tick();

    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0]).toMatchObject({ type: 'warning', message: 'Anomaly: Agent A score 80' });
    expect(getByRole('alert')).toHaveTextContent('Anomaly: Agent A score 80');
    agents.set(population(23));
    await tick();
    expect(get(toasts)).toHaveLength(1);
  });
});
