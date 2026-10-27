import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Analysis from '../../../frontend/observatory/components/Analysis.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => {
  language.set('en');
  localStorage.removeItem('aegis.language');
});

it('localizes the provider dialog section label when language changes', async () => {
  const host = { getSettings: vi.fn(async () => ({})) };
  render(Analysis, { host, telemetry: emptyTelemetry(), preview: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect AI analysis' }));
  expect(
    within(screen.getByRole('dialog')).getByRole('tablist', { name: 'AI analysis sections' }),
  ).toBeVisible();

  language.set('pt');
  await tick();
  const dialog = screen.getByRole('dialog', { name: 'Conexão com a Anthropic' });
  expect(within(dialog).getByRole('tablist', { name: 'Seções da análise de IA' })).toBeVisible();
  expect(within(dialog).getByRole('tab', { name: 'Conexão' })).toBeVisible();
});
