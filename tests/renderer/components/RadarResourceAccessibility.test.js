import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import RadarResourceExplorer from '../../../frontend/observatory/components/RadarResourceExplorer.svelte';
import RadarResourceList from '../../../frontend/observatory/components/RadarResourceList.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

it('restores focus after filtering replaces the selected resource row', async () => {
  const telemetry = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    events: [{ file: 'X:/project/example.ts', attribution: { status: 'unattributed' } }],
  };
  render(RadarResourceExplorer, { telemetry, layer: 'files', inspect: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: 'Inspect X:/project/example.ts' }));
  await fireEvent.input(screen.getByLabelText('Search radar files'), {
    target: { value: 'missing' },
  });
  const clear = screen.getByRole('button', { name: 'Clear resource selection' });
  clear.focus();
  await fireEvent.click(clear);
  expect(screen.getByLabelText('Search radar files')).toHaveFocus();
});

it('localizes resource risk and unidentified actor labels', () => {
  language.set('pt');
  const resource = {
    key: 'resource',
    address: 'X:/example.ts',
    label: 'example.ts',
    level: 'review',
    sensitive: false,
    rows: [{ file: 'X:/example.ts' }],
    relations: [{ actor: '', actions: [] }],
  };
  const { container } = render(RadarResourceList, {
    resources: [resource],
    layer: 'files',
    select: vi.fn(),
    ready: true,
  });
  const row = container.querySelector('.resource-choice');
  expect(within(row).getByText('Revisar')).toBeInTheDocument();
  expect(within(row).getByText('Agente não identificado')).toBeInTheDocument();
});
