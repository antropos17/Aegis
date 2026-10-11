import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsTokens from '../../../frontend/observatory/components/StatsTokens.svelte';
import { emptyTelemetry, type Telemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

it('shows prior-run usage without inventing a process identity or exited-record count', async () => {
  const telemetry: Telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    tokens: [
      {
        pid: null,
        instanceId: null,
        archived: true,
        historical: true,
        source: 'claude-code',
        inputTokens: 60,
        outputTokens: 40,
        totalTokens: 100,
        costUsd: 0.25,
        models: [],
        modelsTruncated: true,
      },
    ],
  };
  render(StatsTokens, { telemetry, inspect: vi.fn() });
  expect(screen.getByText('No current agents with token attribution.')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: /Source samples/ }));
  const baseline = screen
    .getByRole('heading', { name: /Prior runs · Claude Code/ })
    .closest('article');
  expect(baseline).toHaveTextContent('Retained usage · process identity unavailable');
  expect(baseline).toHaveTextContent('100');
  expect(baseline).not.toHaveTextContent(/PID|Sample|exited|compacted records|undefined/);
  language.set('pt');
  await tick();
  expect(baseline).toHaveTextContent('Execuções anteriores · Claude Code');
  expect(baseline).toHaveTextContent('Uso retido · identidade do processo indisponível');
});

it('shows paused accounting with retained incomplete totals and removes the warning on recovery', async () => {
  const telemetry: Telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    tokensAt: Date.now(),
    lastScan: Date.now(),
    agents: [
      {
        agent: 'Claude Code',
        process: 'claude.exe',
        pid: 42,
        instanceId: '42:live',
        status: 'running',
        category: 'ai',
      },
    ],
    tokens: [{ instanceId: '42:live', pid: 42, totalTokens: 12, costUsd: 0.01 }],
    tokenCollection: [
      {
        adapter: 'claude-code',
        state: 'storage-paused',
        reason: 'capacity',
        retryAt: Date.now() + 30000,
      },
    ],
  };
  const { rerender } = render(StatsTokens, { telemetry, inspect: vi.fn() });
  expect(screen.getByRole('status')).toHaveTextContent('storage capacity');
  expect(screen.getByRole('status')).toHaveTextContent('retained and incomplete');
  expect(screen.getByText('Recorded subtotal · collection paused')).toBeVisible();
  expect(within(screen.getByRole('row', { name: /Claude Code/ })).getByText('12')).toBeVisible();
  language.set('pt');
  await tick();
  expect(screen.getByRole('status')).toHaveTextContent('capacidade de armazenamento');
  await rerender({
    telemetry: { ...telemetry, tokenCollection: [{ adapter: 'claude-code', state: 'ready' }] },
    inspect: vi.fn(),
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

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
