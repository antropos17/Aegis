import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import AgentWorkspace from '../../../frontend/observatory/components/AgentWorkspace.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import type { DetectedAgent, FileEvent, NetworkConnection } from '../../../src/shared/types';

const agent = (pid: number, instanceId: string): DetectedAgent => ({
  agent: 'Codex',
  process: 'codex.exe',
  pid,
  instanceId,
  instanceIdSource: 'os',
  status: 'running',
  category: 'cli-tool',
});
const file = (owner: DetectedAgent): FileEvent => ({
  agent: owner.agent,
  pid: owner.pid,
  instanceId: owner.instanceId ?? null,
  parentEditor: null,
  cwd: null,
  file: 'X:/review/file-' + owner.pid + '.txt',
  action: 'holding',
  timestamp: Date.now(),
  category: 'source',
  sensitive: false,
  selfAccess: false,
  reason: '',
  attribution: { status: 'confirmed', evidence: [] },
});
const connection = (owner: DetectedAgent): NetworkConnection => ({
  agent: owner.agent,
  pid: owner.pid,
  instanceId: owner.instanceId ?? null,
  parentEditor: null,
  cwd: null,
  category: 'cli-tool',
  remoteIp: '192.0.2.10',
  remotePort: 443,
  domain: '',
  state: 'ESTABLISHED',
  flagged: true,
  verdict: 'unknown',
  httpUnencrypted: false,
  userAgent: null,
});
function telemetry(): Telemetry {
  const agents = [agent(101, '101:first'), agent(102, '102:first')];
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents,
    events: agents.map(file),
    network: [connection(agents[0])],
    networkAt: Date.now(),
    resources: [
      { instanceId: '101:first', cpu: 10, memMb: 100 },
      { instanceId: '102:first', cpu: 20, memMb: 200 },
      { instanceId: '101:replacement', cpu: 99, memMb: 999 },
    ],
  };
}
function start(state = telemetry(), instanceId = '') {
  return render(AgentWorkspace, {
    telemetry: state,
    liveTelemetry: state,
    host: null,
    scope: { agent: 'Codex', instanceId },
    change: vi.fn(),
    inspect: vi.fn(),
    navigate: vi.fn(),
  });
}
const summary = () => within(screen.getByRole('region', { name: 'Agent context summary' }));

it('shows complete scoped resource readings and retained evidence while the risk panel stays open', async () => {
  const state = telemetry();
  state.events.push({ ...file(state.agents[0]), selfAccess: true });
  state.events.push({
    ...file(state.agents[0]),
    attribution: { status: 'unattributed', evidence: [] },
  });
  const mounted = start(state);
  const resources = summary().getByRole('button', { name: /Resources/ });
  expect(resources).toHaveTextContent('30 %');
  expect(resources).toHaveTextContent('300 MB');
  expect(resources).not.toHaveTextContent('999');
  expect(summary().getByRole('button', { name: /Activity/ })).toHaveTextContent('2');
  expect(summary().getByRole('button', { name: /Worker processes/ })).toHaveTextContent('2');
  expect(screen.getByRole('region', { name: 'Observed risk' })).toBeVisible();

  await mounted.rerender({ telemetry: { ...state, resources: state.resources.slice(0, 1) } });
  expect(resources.querySelectorAll('strong')[0]).toHaveTextContent('—');
  expect(resources.querySelectorAll('strong')[1]).toHaveTextContent('—');
  await mounted.rerender({
    telemetry: {
      ...state,
      resources: [state.resources[0], { instanceId: '102:first', cpu: 20, memMb: null }],
    },
  });
  expect(resources.querySelectorAll('strong')[0]).toHaveTextContent('30 %');
  expect(resources.querySelectorAll('strong')[1]).toHaveTextContent('—');
  expect(resources).toHaveTextContent('Resource measurements incomplete');
});

it('focuses the section destination and preserves its resource metric without jumping from hidden workspaces', async () => {
  const mounted = start();
  const resources = summary().getByRole('button', { name: /Resources/ });
  resources.focus();
  await fireEvent.click(resources);
  const panel = screen.getByRole('region', { name: 'Resources' });
  expect(panel).toHaveFocus();
  expect(resources).not.toHaveAttribute('aria-expanded');
  expect(resources).toHaveAttribute('aria-controls', panel.id);
  const memory = within(panel).getByRole('button', { name: /memory/i });
  await fireEvent.click(memory);
  await fireEvent.click(summary().getByRole('button', { name: /Activity/ }));
  expect(screen.getByRole('region', { name: 'Activity' })).toHaveFocus();
  await fireEvent.click(resources);
  expect(screen.getByRole('region', { name: 'Resources' })).toBe(panel);
  expect(panel).toHaveFocus();
  expect(memory).toHaveAttribute('aria-pressed', 'true');

  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  try {
    memory.focus();
    await mounted.rerender({ visible: false, sectionRequest: { id: 'resources', revision: 1 } });
    expect(scroll).not.toHaveBeenCalled();
    expect(memory).toHaveFocus();
    await mounted.rerender({ visible: true });
    expect(scroll.mock.contexts).toContain(panel);
    expect(panel).toHaveFocus();
    expect(memory).toHaveAttribute('aria-pressed', 'true');

    scroll.mockClear();
    memory.focus();
    mounted.container.setAttribute('inert', '');
    await mounted.rerender({ sectionRequest: { id: 'resources', revision: 2 } });
    expect(scroll).not.toHaveBeenCalled();
    expect(memory).toHaveFocus();
    mounted.container.removeAttribute('inert');
    mounted.container.hidden = true;
    await mounted.rerender({ sectionRequest: { id: 'resources', revision: 3 } });
    expect(scroll).not.toHaveBeenCalled();
    expect(memory).toHaveFocus();
    mounted.container.hidden = false;
    await mounted.rerender({ sectionRequest: { id: 'resources', revision: 4 } });
    expect(panel).toHaveFocus();
    expect(scroll.mock.contexts).toContain(panel);
  } finally {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
    else
      delete (HTMLElement.prototype as { scrollIntoView?: HTMLElement['scrollIntoView'] })
        .scrollIntoView;
  }
});

it('preserves an absent stamped process and retained evidence through PID reuse and sensor outage', async () => {
  const state = telemetry();
  const mounted = start(state, '101:first');
  const resources = summary().getByRole('button', { name: /Resources/ });
  expect(resources).toHaveTextContent('10 %');
  const replacement = agent(101, '101:replacement');
  const departed = { ...state, agents: [replacement, state.agents[1]] };
  await mounted.rerender({ telemetry: departed });
  expect(resources.querySelectorAll('strong')[0]).toHaveTextContent('—');
  expect(resources.querySelectorAll('strong')[1]).toHaveTextContent('—');
  expect(summary().getByRole('button', { name: /Activity/ })).toHaveTextContent('1');
  expect(summary().getByRole('button', { name: /Activity/ })).toHaveTextContent(
    'Retained network snapshot',
  );
  await fireEvent.click(summary().getByRole('button', { name: /Activity/ }));
  expect(screen.getByRole('region', { name: 'Activity' })).toHaveTextContent('file-101.txt');

  await mounted.rerender({ telemetry: { ...state, stale: true } });
  expect(resources.querySelectorAll('strong')[0]).toHaveTextContent('—');
  expect(summary().getByRole('button', { name: /Activity/ })).toHaveTextContent(
    'Retained network snapshot',
  );
});

it('keeps unobserved initial counts unavailable and opens exact-process controls only for that selection', async () => {
  const mounted = start(emptyTelemetry());
  expect(
    summary()
      .getByRole('button', { name: /Activity/ })
      .querySelectorAll('strong')[0],
  ).toHaveTextContent('—');
  expect(
    summary()
      .getByRole('button', { name: /Activity/ })
      .querySelectorAll('strong')[1],
  ).toHaveTextContent('—');
  expect(
    summary()
      .getByRole('button', { name: /Worker processes/ })
      .querySelector('strong'),
  ).toHaveTextContent('—');

  expect(summary().getByRole('button', { name: /Worker processes/ })).toHaveTextContent(
    'Waiting for observed agents',
  );

  const state = telemetry();
  await mounted.rerender({
    telemetry: state,
    liveTelemetry: state,
    scope: { agent: 'Codex', instanceId: '101:first' },
  });
  const workers = summary().getByRole('button', { name: /Worker processes/ });
  workers.focus();
  await fireEvent.click(workers);
  expect(screen.getByRole('region', { name: 'Processes' })).toBeVisible();
  const panel = screen.getByRole('region', { name: 'Process attributes and controls' });
  expect(panel).toHaveFocus();
  expect(workers).toHaveAttribute('aria-controls', panel.id);
  expect(screen.getByRole('region', { name: 'Attributes' })).toBeVisible();
  expect(panel.querySelector('details')).toBeNull();
});
