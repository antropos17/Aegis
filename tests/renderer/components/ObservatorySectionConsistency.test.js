import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import Monitoring from '../../../frontend/observatory/components/Monitoring.svelte';
import StatsTokens from '../../../frontend/observatory/components/StatsTokens.svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agent = (pid) => ({
  agent: 'Codex',
  process: 'codex.exe',
  pid,
  instanceId: pid + ':now',
  instanceIdSource: 'os',
});
const state = () => ({
  ...emptyTelemetry(),
  ready: true,
  stale: false,
  agents: [agent(1), agent(2)],
  tokens: [
    { instanceId: '1:now', totalTokens: 100, costUsd: 0.25 },
    { instanceId: '9:retired', totalTokens: 900, costUsd: 3 },
  ],
});

it('Monitoring counts only current measured token sources and preserves partial coverage', async () => {
  const s = state();
  const { container, rerender } = render(Monitoring, {
    telemetry: s,
    selected: null,
    inspect: vi.fn(),
  });
  const summary = [...container.querySelectorAll('.summary-stat')].find(
    (el) => el.querySelector('span')?.textContent === 'Tokens',
  );
  expect(summary).toHaveTextContent('100');
  expect(summary).not.toHaveTextContent('1K');
  expect(summary).toHaveTextContent('1 / 2 current processes measured · subtotal');
  await rerender({ telemetry: { ...s, tokens: [...s.tokens, { ...s.tokens[0] }] } });
  expect(summary.querySelector('strong')).toHaveTextContent('—');
  expect(summary).toHaveTextContent('0 / 2 current processes measured');
});

it('the sensitive summary and its opened records use the same retained scope', async () => {
  const rows = [
    { file: 'X:/a', timestamp: 1000, sensitive: true, category: 'ai' },
    { file: 'X:/b', timestamp: 1100, sensitive: true, category: 'unknown' },
    { file: 'X:/c', timestamp: 1200, sensitive: false },
  ];
  const inspect = vi.fn();
  const s = { ...state(), events: rows, stats: { aiSensitive: 99 } };
  const { rerender } = render(Monitoring, { telemetry: s, selected: null, inspect });
  const button = screen.getByRole('button', { name: /Sensitive events/ });
  expect(button.querySelector('strong')).toHaveTextContent('2');
  expect(button).toHaveTextContent('Retained file observations');
  await fireEvent.click(button);
  expect(inspect).toHaveBeenLastCalledWith('Sensitive events', { observations: rows.slice(0, 2) });
  await rerender({ telemetry: { ...s, events: rows.slice(1) } });
  expect(button.querySelector('strong')).toHaveTextContent('1');
});

it('StatsTokens shows a current measured subtotal and per-field coverage without retired costs', async () => {
  const s = state();
  const { rerender } = render(StatsTokens, { telemetry: s, inspect: vi.fn() });
  const row = screen.getByRole('row', { name: /Codex/ });
  expect(row).toHaveTextContent('1 / 2');
  expect(row).toHaveTextContent('100');
  expect(row).toHaveTextContent('Measured subtotal');
  expect(row).toHaveTextContent(/\$0[.,]25/);
  expect(row).toHaveTextContent('1 / 2 processes priced · subtotal');
  expect(row).not.toHaveTextContent('$3');
  await rerender({ telemetry: { ...s, stale: true } });
  expect(row).toHaveTextContent('No current measurement');
  expect(row).not.toHaveTextContent(/\$0[.,]25/);
});

it('Statistics Processes shows either comparison or table and retains table filters when switching', async () => {
  render(Statistics, { telemetry: state(), inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('tab', { name: 'Processes', exact: true }));
  const tabs = screen.getByRole('tablist', { name: 'Process comparison view' });
  expect(screen.getByRole('heading', { name: 'Agent usage' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  await fireEvent.click(within(tabs).getByRole('tab', { name: 'Table' }));
  expect(screen.queryByRole('heading', { name: 'Agent usage' })).toBeNull();
  expect(screen.getByRole('table')).toBeInTheDocument();
  await fireEvent.input(screen.getByLabelText('Search agents'), { target: { value: 'missing' } });
  await fireEvent.click(within(tabs).getByRole('tab', { name: 'Comparison' }));
  expect(screen.queryByRole('table')).toBeNull();
  await fireEvent.click(within(tabs).getByRole('tab', { name: 'Table' }));
  expect(screen.getByLabelText('Search agents')).toHaveValue('missing');
});

it('Reports labels the same retained sensitive population as Monitoring', () => {
  const telemetry = {
    ...state(),
    stats: { totalFiles: 500, aiSensitive: 99 },
    events: [
      { sensitive: true, category: 'ai' },
      { sensitive: true, category: 'unknown' },
      { sensitive: false },
    ],
  };
  const { container } = render(Reports, {
    telemetry,
    host: null,
    navigate: vi.fn(),
    inspect: vi.fn(),
  });
  const stat = [...container.querySelectorAll('.inline-stats > div')].find((el) =>
    el.textContent.includes('retained sensitive events'),
  );
  expect(stat.querySelector('strong')).toHaveTextContent('2');
});
