import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import {
  emptyTelemetry,
  type RecordData,
  type Telemetry,
} from '../../../frontend/observatory/runtime/host';

function telemetry(): Telemetry {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [
      {
        agent: 'Codex',
        process: 'codex.exe',
        pid: 42,
        instanceId: '42:live',
        instanceIdSource: 'os',
        status: 'running',
        category: 'cli-tool',
      },
    ],
  };
}
const context = () => screen.getByRole('region', { name: 'Assessment context' });
function count(label: string) {
  return within(context()).getByText(label, { exact: true }).closest('div')?.querySelector('dd');
}
async function title(value: string) {
  await fireEvent.input(screen.getByLabelText('Report title'), { target: { value } });
}
async function run() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled());
  await fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
}

it('keeps captured report context and the next-run draft through telemetry updates, evidence navigation and failure', async () => {
  let resolve!: (value: RecordData) => void;
  const pending = new Promise<RecordData>((yes) => (resolve = yes));
  const host = {
    getSettings: async () => ({ anthropicApiKeyConfigured: true }),
    analyzeSession: vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error('Fixture failure')),
  };
  const mounted = render(Analysis, { host, telemetry: telemetry() });
  await title('Captured assessment');
  await run();
  await waitFor(() => expect(host.analyzeSession).toHaveBeenCalledTimes(1));
  await title('Next assessment');
  await mounted.rerender({ telemetry: { ...telemetry(), agents: [], stats: { totalFiles: 999 } } });
  resolve({
    success: true,
    structured: {
      summary: 'Recorded result',
      findings: ['Inspect recorded activity'],
      recommendations: ['Review the sensitive observation', 'Inspect the connection'],
    },
    counts: { totalFiles: 18, totalSensitive: 3, totalAgents: 2, totalNet: 6 },
  });
  await screen.findByRole('heading', { name: 'Captured assessment' });
  expect(count('File observations')).toHaveTextContent('18');
  expect(count('Sensitive observations')).toHaveTextContent('3');
  expect(count('Agent products')).toHaveTextContent('2');
  expect(count('Connections')).toHaveTextContent('6');
  expect(context()).toHaveTextContent('Captured analysis request · Recorded for this assessment');
  expect(within(context()).getByText('Review the sensitive observation')).toBeVisible();
  expect(screen.getByLabelText('Report title')).toHaveValue('Next assessment');

  const shortcut = within(context()).getByRole('button', { name: 'View recorded evidence' });
  shortcut.focus();
  await fireEvent.click(shortcut);
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Recorded scope' })).toHaveFocus(),
  );
  for (const name of ['Report', 'Recorded scope', 'History']) {
    expect(screen.getByRole('region', { name })).toBeVisible();
  }
  expect(host.analyzeSession).toHaveBeenCalledTimes(1);
  await fireEvent.click(screen.getByRole('button', { name: 'Report' }));
  await run();
  await screen.findByText('Fixture failure');
  expect(count('File observations')).toHaveTextContent('18');
  expect(within(context()).getByText('Review the sensitive observation')).toBeVisible();
  expect(screen.getByLabelText('Report title')).toHaveValue('Next assessment');
});

it('restores each historical assessment with its own counts, source and first check', async () => {
  const host = {
    getSettings: async () => ({ anthropicApiKeyConfigured: true }),
    analyzeSession: vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        structured: { summary: 'First result', recommendations: [] },
        counts: { totalFiles: 999 },
      })
      .mockResolvedValueOnce({
        success: true,
        structured: { summary: 'Second result', recommendations: ['Inspect second report'] },
        counts: { totalFiles: 14, totalSensitive: 0, totalAgents: 3, totalNet: 9 },
      }),
  };
  const mounted = render(Analysis, { host, telemetry: telemetry() });
  await title('First assessment');
  await run();
  await screen.findByRole('heading', { name: 'First assessment' });
  expect(count('File observations')).toHaveTextContent('0');
  expect(count('Agent products')).toHaveTextContent('1');
  expect(context()).toHaveTextContent(
    'Retained displayed observations · Recorded for this assessment',
  );
  expect(within(context()).getByText('No recommendations returned.')).toBeVisible();
  await mounted.rerender({ telemetry: { ...telemetry(), agents: [] } });
  await title('Second assessment');
  await run();
  await screen.findByRole('heading', { name: 'Second assessment' });
  expect(count('File observations')).toHaveTextContent('14');
  expect(count('Sensitive observations')).toHaveTextContent('0');
  expect(within(context()).getByText('Inspect second report')).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'History' }));
  await fireEvent.click(screen.getByRole('button', { name: /First assessment/ }));
  expect(count('File observations')).toHaveTextContent('0');
  expect(count('Agent products')).toHaveTextContent('1');
  expect(context()).toHaveTextContent(
    'Retained displayed observations · Recorded for this assessment',
  );
  expect(within(context()).getByText('No recommendations returned.')).toBeVisible();
  expect(host.analyzeSession).toHaveBeenCalledTimes(2);
});

it('does not move focus into a hidden retained analysis workspace', async () => {
  const host = {
    getSettings: async () => ({ anthropicApiKeyConfigured: true }),
    analyzeSession: vi.fn(async () => ({
      success: true,
      structured: { summary: 'Retained result' },
    })),
  };
  const mounted = render(Analysis, { host, telemetry: telemetry() });
  await run();
  await screen.findByRole('region', { name: 'Assessment context' });
  const shortcut = within(context()).getByRole('button', { name: 'View recorded evidence' });
  const focus = vi.spyOn(HTMLHeadingElement.prototype, 'focus');
  try {
    await mounted.rerender({ visible: false });
    await fireEvent.click(shortcut);
    expect(focus).not.toHaveBeenCalled();
    await mounted.rerender({ visible: true });
    const container = mounted.container;
    container.setAttribute('inert', '');
    await fireEvent.click(shortcut);
    expect(focus).not.toHaveBeenCalled();
    container.removeAttribute('inert');
    container.hidden = true;
    await fireEvent.click(shortcut);
    expect(focus).not.toHaveBeenCalled();
  } finally {
    focus.mockRestore();
  }
});
