import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../../../frontend/observatory/App.svelte';
import Settings from '../../../frontend/observatory/components/Settings.svelte';
import AgentContext from '../../../frontend/observatory/components/AgentContext.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

afterEach(() => {
  language.set('en');
  localStorage.removeItem('aegis.language');
});

it('switches mounted navigation, radar and accessible names without changing route IDs', async () => {
  render(App, { host: null });
  expect(await screen.findByRole('heading', { name: 'Agent radar' })).toBeVisible();
  language.set('pt');
  await tick();
  expect(screen.getByRole('heading', { name: 'Radar de agentes' })).toBeVisible();
  expect(document.documentElement.lang).toBe('pt-BR');
  expect(localStorage.getItem('aegis.language')).toBe('pt');
  const nav = within(screen.getByRole('navigation', { name: 'Navegação principal' }));
  await fireEvent.click(nav.getByRole('button', { name: 'Eventos', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Eventos', level: 1 })).toBeVisible();
  language.set('en');
  await tick();
  expect(screen.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
  expect(document.documentElement.lang).toBe('en');
});

it('saves language immediately while retaining an independent unsaved settings draft', async () => {
  const host = {
    getSettings: async () => ({ uiScale: 1, scanIntervalSec: 10 }),
    getUpdateStatus: async () => ({}),
    saveSettings: vi.fn(async () => ({ success: true })),
  };
  render(Settings, { host, appearance: vi.fn(), navigate: vi.fn() });
  await screen.findByText('Settings saved');
  await fireEvent.input(screen.getByLabelText('Interface scale percent'), {
    target: { value: '125' },
  });
  await fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pt' } });
  await waitFor(() => expect(screen.getByLabelText('Idioma')).toHaveValue('pt'));
  expect(screen.getByLabelText('Escala da interface em porcentagem')).toHaveValue(125);
  expect(screen.getByText('Alterações não salvas')).toBeVisible();
  expect(localStorage.getItem('aegis.language')).toBe('pt');
  expect(host.saveSettings).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Escala da interface em porcentagem')).toHaveValue(100),
  );
  expect(screen.getByLabelText('Idioma')).toHaveValue('pt');
});

it('retains literal agent names and stamped process IDs that resemble translatable UI copy', async () => {
  language.set('pt');
  const change = vi.fn();
  render(AgentContext, {
    telemetry: {
      ...emptyTelemetry(),
      agents: [{ agent: 'Network', instanceId: '2:birth', pid: 2, process: 'agent.exe' }],
    },
    scope: { agent: 'Network', instanceId: '' },
    change,
  });
  expect(screen.getByRole('option', { name: 'Network', exact: true })).toHaveValue('Network');
  await fireEvent.change(screen.getByLabelText('Processo selecionado'), {
    target: { value: '2:birth' },
  });
  expect(change).toHaveBeenCalledWith({ agent: 'Network', instanceId: '2:birth' });
});
