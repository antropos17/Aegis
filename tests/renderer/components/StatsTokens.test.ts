import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsTokens from '../../../frontend/observatory/components/StatsTokens.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

it('labels archived totals separately from exact live agent attribution in both languages', async () => {
  const telemetry: Telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      {
        agent: 'Codex',
        process: 'codex.exe',
        pid: 42,
        instanceId: '42:live',
        status: 'running',
        category: 'ai',
      },
    ],
    tokens: [
      {
        instanceId: '42:live',
        pid: 42,
        totalTokens: 12,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0.01,
      },
      {
        instanceId: null,
        pid: null,
        archived: true,
        archivedRecords: 999,
        totalTokens: 9000,
        inputTokens: 6000,
        outputTokens: 3000,
        costUsd: 9,
        estimated: true,
        models: ['old-model'],
        modelsTruncated: true,
      },
    ],
  };
  render(StatsTokens, { telemetry, inspect: vi.fn() });
  const liveRow = screen.getByRole('row', { name: /Codex/ });
  expect(within(liveRow).getByText('12')).toBeVisible();
  expect(liveRow).not.toHaveTextContent(/9[\s,]000/);
  await fireEvent.click(screen.getByRole('button', { name: /Source samples/ }));
  const archive = screen.getByRole('heading', { name: /Archived exited usage/ }).closest('article');
  expect(archive).toHaveTextContent('999 compacted records');
  expect(archive).toHaveTextContent(/9[\s,]000/);
  expect(archive).toHaveTextContent('Estimated');
  expect(archive).toHaveTextContent('Additional model labels omitted');
  expect(archive).not.toHaveTextContent('PID');
  language.set('pt');
  await tick();
  expect(archive).toHaveTextContent('Uso arquivado de processos encerrados');
  expect(archive).toHaveTextContent('999 registros compactados');
  expect(archive).toHaveTextContent('Rótulos adicionais de modelos omitidos');
});
