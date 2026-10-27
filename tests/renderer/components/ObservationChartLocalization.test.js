import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import StatsChart from '../../../frontend/observatory/components/StatsChart.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { statisticsMetrics } from '../../../frontend/observatory/runtime/statistics-metrics';

afterEach(() => language.set('en'));

it('translates the count of distinct activities in a grouped observation', async () => {
  const events = [
    { agent: 'Codex', file: 'C:/work/notes.txt', action: 'read', timestamp: 1000 },
    { agent: 'Codex', file: 'c:\\WORK\\NOTES.txt', action: 'modified', timestamp: 2000 },
  ];
  render(Events, { telemetry: { ...emptyTelemetry(), ready: true, events }, inspect: vi.fn() });
  expect(screen.getByText('2 activity types')).toBeInTheDocument();
  language.set('pt');
  expect(await screen.findByText('2 tipos de atividade')).toBeInTheDocument();
});

it('translates an unavailable source in chart text and the slider description', async () => {
  language.set('pt');
  render(StatsChart, {
    samples: [],
    metrics: statisticsMetrics.filter((metric) => metric.id === 'cpu'),
    now: 3000,
  });
  expect(await screen.findByText(/Aguardando esta fonte/)).toBeInTheDocument();
  expect(screen.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    expect.stringContaining('Aguardando esta fonte'),
  );
});
