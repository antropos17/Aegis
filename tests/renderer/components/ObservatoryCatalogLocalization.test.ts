import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import Catalog from '../../../frontend/observatory/components/Catalog.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => {
  language.set('en');
  localStorage.removeItem('aegis.language');
});

it('localizes the catalog editor sections and required-field feedback', async () => {
  language.set('pt');
  const host = {
    getAgentDatabase: vi.fn(async () => ({ agents: [] })),
    getCustomAgents: vi.fn(async () => []),
    saveCustomAgents: vi.fn(),
  };
  render(Catalog, { host, inspect: vi.fn() });
  const add = await screen.findByRole('button', { name: 'Adicionar agente' });
  await fireEvent.click(add);
  const dialog = screen.getByRole('dialog', { name: 'Adicionar agente personalizado' });
  expect(
    within(dialog).getByRole('tablist', { name: 'Seções do catálogo de agentes' }),
  ).toBeVisible();

  await fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar agente' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nome é obrigatório');
  await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Nome' }), {
    target: { value: 'Example agent' },
  });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar agente' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Assinatura do processo é obrigatória',
  );
  expect(host.saveCustomAgents).not.toHaveBeenCalled();
});
