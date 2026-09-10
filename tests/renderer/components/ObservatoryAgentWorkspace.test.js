import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import App from '../../../frontend/observatory/App.svelte';

const stats = {
  appHealth: { state: 'HEALTHY', populationReliable: true, identityDegraded: false },
};
const agent = (name, pid, instanceId) => ({
  agent: name,
  pid,
  instanceId,
  instanceIdSource: 'os',
  process: name.toLowerCase() + '.exe',
  cwd: 'X:/test-project',
});
const initialAgents = () => [
  agent('Codex', 101, '101:first'),
  agent('Claude Code', 202, '202:first'),
];
const file = (owner, path) => ({
  agent: owner.agent,
  pid: owner.pid,
  instanceId: owner.instanceId,
  file: path,
  action: 'read',
  timestamp: Date.now(),
  sensitive: false,
  selfAccess: false,
  attribution: { status: 'confirmed', evidence: [] },
});
const connection = (owner, ip) => ({
  agent: owner.agent,
  pid: owner.pid,
  instanceId: owner.instanceId,
  remoteIp: ip,
  remotePort: 443,
  state: 'ESTABLISHED',
  verdict: 'unknown',
  verdictReason: 'ptr-missing',
});
function bridge() {
  const listeners = {};
  const host = {
    getStats: async () => stats,
    getResourceUsage: async () => ({ memMB: 35, heapMB: 20 }),
    getFalsePositives: async () => [],
    getSettings: async () => ({ darkMode: false, uiScale: 1, scanIntervalSec: 10 }),
    getAppVersion: async () => 'test',
    getUpdateStatus: async () => ({}),
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (callback) => {
      listeners[name] = callback;
      return () => {
        delete listeners[name];
      };
    };
  }
  return {
    host,
    async push(name, data) {
      await act(() => {
        listeners[name](data);
      });
    },
  };
}
let scrollDescriptor;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aegis-motion', 'reduce');
  scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  if (scrollDescriptor)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
  else delete HTMLElement.prototype.scrollIntoView;
  localStorage.clear();
});
async function start() {
  const transport = bridge();
  const mounted = render(App, { host: transport.host });
  const agents = initialAgents();
  await transport.push('onScanBatch', { stats, agents });
  await transport.push('onFileAccess', [
    file(agents[0], '/codex-only.txt'),
    file(agents[1], '/claude-only.txt'),
  ]);
  await transport.push('onNetworkUpdate', [
    connection(agents[0], '192.0.2.10'),
    connection(agents[1], '192.0.2.20'),
  ]);
  await transport.push('onAgentResourceUsage', [
    { instanceId: agents[0].instanceId, cpu: 10, memMb: 100 },
    { instanceId: agents[1].instanceId, cpu: 70, memMb: 700 },
  ]);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Selected agent', exact: true })).toBeEnabled(),
  );
  return { ...transport, ...mounted, agents };
}
async function navigate(name) {
  const button = within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole(
    'button',
    { name, exact: true },
  );
  await fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute('aria-current', 'page'));
}
async function chooseAgent(name = 'Codex') {
  await fireEvent.change(screen.getByRole('combobox', { name: 'Selected agent', exact: true }), {
    target: { value: name },
  });
}

it('keeps one agent context across the page, events, network and statistics', async () => {
  const { container } = await start();
  await chooseAgent();
  expect(screen.getByRole('region', { name: 'Agent overview' })).toBeVisible();
  expect(document.querySelector('dialog[open]')).toBeNull();
  await navigate('Events');
  expect(screen.getByRole('combobox', { name: 'Selected agent', exact: true })).toHaveValue(
    'Codex',
  );
  expect(within(screen.getByRole('table')).getByText('codex-only.txt')).toBeVisible();
  expect(within(screen.getByRole('table')).queryByText('claude-only.txt')).not.toBeInTheDocument();
  await navigate('Network');
  expect(screen.getByRole('combobox', { name: 'Selected agent', exact: true })).toHaveValue(
    'Codex',
  );
  expect(within(screen.getByRole('table')).getByText('192.0.2.10:443')).toBeVisible();
  expect(within(screen.getByRole('table')).queryByText('192.0.2.20:443')).not.toBeInTheDocument();
  await navigate('Statistics');
  expect(screen.getByRole('combobox', { name: 'Selected agent', exact: true })).toHaveValue(
    'Codex',
  );
  expect(screen.queryByLabelText('Statistics agent')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      container.querySelector('.statistics-workspace .monitor-detail .current'),
    ).toHaveTextContent('10'),
  );
  await navigate('Agents');
  expect(screen.getByRole('region', { name: 'Agent overview' })).toBeVisible();
  expect(document.querySelector('dialog[open]')).toBeNull();
});

it('opens an agent row in the page without a modal or nested detail navigation', async () => {
  await start();
  await navigate('Agents');
  const table = screen.getByRole('table');
  await fireEvent.click(within(table).getByRole('button', { name: 'Codex', exact: true }));
  expect(screen.getByRole('combobox', { name: 'Selected agent', exact: true })).toHaveValue(
    'Codex',
  );
  expect(screen.getByRole('combobox', { name: 'Selected process', exact: true })).toHaveValue('');
  expect(screen.getByRole('region', { name: 'Agent overview' })).toBeVisible();
  expect(document.querySelector('dialog[open]')).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'Detail sections' })).not.toBeInTheDocument();
});

it('retains exact process scope and its evidence after a PID is reused', async () => {
  const { push, agents, container } = await start();
  await chooseAgent();
  await fireEvent.change(screen.getByRole('combobox', { name: 'Selected process', exact: true }), {
    target: { value: '101:first' },
  });
  const replacement = agent('Codex', 101, '101:replacement');
  await push('onScanBatch', { stats, agents: [replacement, agents[1]] });
  await push('onFileAccess', [file(replacement, '/replacement-only.txt')]);
  await push('onAgentResourceUsage', [{ instanceId: replacement.instanceId, cpu: 99, memMb: 999 }]);
  expect(screen.getByRole('combobox', { name: 'Selected process', exact: true })).toHaveValue(
    '101:first',
  );
  expect(screen.getByText(/Its retained activity stays visible/)).toBeVisible();
  await navigate('Events');
  expect(within(screen.getByRole('table')).getByText('codex-only.txt')).toBeVisible();
  expect(
    within(screen.getByRole('table')).queryByText('replacement-only.txt'),
  ).not.toBeInTheDocument();
  await navigate('Statistics');
  expect(screen.getByRole('combobox', { name: 'Selected process', exact: true })).toHaveValue(
    '101:first',
  );
  expect(screen.getByText(/Selection no longer observed/)).toBeVisible();
  expect(
    container.querySelector('.statistics-workspace .monitor-detail .current'),
  ).not.toHaveTextContent('99');
});

it('leaves browser and OS shortcut combinations separate from single-key navigation and theme commands', async () => {
  await start();
  await chooseAgent();
  const theme = document.documentElement.dataset.theme;
  for (const modifier of ['ctrlKey', 'metaKey']) {
    await fireEvent.keyDown(window, { key: 's', [modifier]: true });
    await fireEvent.keyDown(window, { key: 't', [modifier]: true });
  }
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', {
      name: 'Monitoring',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('region', { name: 'Agent overview' })).toBeVisible();
  await fireEvent.keyDown(window, { key: 't' });
  expect(document.documentElement.dataset.theme).not.toBe(theme);
});
