import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import AgentEvidence from '../../../frontend/observatory/components/AgentEvidence.svelte';
import type { RecordData } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

function file(index: number, sensitive = false): RecordData {
  return {
    eventId: `fixture-event-${index}`,
    file: `/fixture/${sensitive ? '.env-' : 'source-'}${index}`,
    agent: 'Codex',
    instanceId: '7:first',
    timestamp: index,
    action: sensitive ? 'holding' : 'modified',
    sensitive,
    reason: sensitive ? 'Sensitive path' : '',
    attribution: { status: 'inferred', evidence: ['cwd-containment'] },
  };
}

it('reveals older sensitive evidence in the agent card without leaving the selected context', async () => {
  const sensitive = file(1, true);
  const rows = [sensitive, ...Array.from({ length: 5 }, (_, index) => file(index + 2))];
  const inspect = vi.fn();
  const more = vi.fn();
  render(AgentEvidence, { rows, agents: [], inspect, more });

  const card = within(screen.getByRole('region', { name: 'Selected agent file activity' }));
  expect(card.queryByRole('button', { name: /Open evidence.*\.env-1/ })).toBeNull();
  expect(card.getAllByRole('button', { name: /^Open evidence/ })).toHaveLength(4);
  const filter = card.getByRole('button', { name: 'Sensitive events 1' });
  filter.focus();
  await fireEvent.click(filter);
  expect(filter).toHaveFocus();
  expect(filter).toHaveAttribute('aria-pressed', 'true');
  const evidence = card.getByRole('button', { name: 'Open evidence · .env-1 · Held a file open' });
  expect(evidence).toHaveTextContent('Indirect match');
  expect(evidence).toHaveTextContent('Sensitive');
  expect(evidence).toHaveTextContent('Recorded reason: Sensitive path');
  expect(
    card.getByText('An open handle does not prove that file contents were read.'),
  ).toBeVisible();
  expect(card.queryByText('Showing 4 of 6.')).toBeNull();
  await fireEvent.click(evidence);
  expect(inspect).toHaveBeenCalledExactlyOnceWith('File observation', sensitive);
  expect(inspect.mock.calls[0][1]).toBe(sensitive);
  expect(more).not.toHaveBeenCalled();
  await fireEvent.click(card.getByRole('button', { name: 'View all' }));
  expect(more).toHaveBeenCalledOnce();
});

it('keeps the filter mounted through empty delivery and bounds the sensitive list to four records', async () => {
  const props = { rows: [file(1)], agents: [], inspect: vi.fn(), more: vi.fn() };
  const mounted = render(AgentEvidence, props);
  const filter = screen.getByRole('button', { name: 'Sensitive events 0' });
  filter.focus();
  await fireEvent.click(filter);
  expect(screen.getByText('No records match these filters.')).toBeVisible();
  await mounted.rerender({ ...props, rows: [] });
  expect(filter).toHaveFocus();
  expect(filter).toHaveAttribute('aria-pressed', 'true');
  const rows = Array.from({ length: 7 }, (_, index) => file(index + 1, true));
  await mounted.rerender({ ...props, rows });
  expect(filter).toHaveFocus();
  expect(filter).toHaveTextContent('Sensitive events 7');
  const evidence = screen.getAllByRole('button', { name: /^Open evidence/ });
  expect(evidence).toHaveLength(4);
  expect(evidence.map((button) => button.getAttribute('aria-label'))).toEqual(
    [7, 6, 5, 4].map((index) => `Open evidence · .env-${index} · Held a file open`),
  );
  expect(screen.getByText(/Showing 4 of 7/)).toBeVisible();
});

it('keeps focused evidence tied to its event identity when a newer delivery shifts its position', async () => {
  const retained = file(2);
  const props = { rows: [retained, file(1)], agents: [], inspect: vi.fn(), more: vi.fn() };
  const mounted = render(AgentEvidence, props);
  const selected = screen.getByRole('button', { name: /Open evidence.*source-2/ });
  selected.focus();
  const refreshed = { ...retained };
  await mounted.rerender({ ...props, rows: [file(3), refreshed, props.rows[1]] });
  expect(selected).toHaveFocus();
  await fireEvent.click(selected);
  expect(props.inspect.mock.calls[0][1]).toBe(refreshed);
});

it('updates the added controls and observation action with the existing Portuguese vocabulary', async () => {
  render(AgentEvidence, { rows: [file(1, true)], agents: [], inspect: vi.fn(), more: vi.fn() });
  language.set('pt');
  const filter = await screen.findByRole('button', { name: 'Eventos sensíveis 1' });
  expect(screen.getByRole('button', { name: 'Todas as atividades' })).toBeVisible();
  await fireEvent.click(filter);
  expect(
    screen.getByRole('button', { name: 'Abrir evidências · .env-1 · Manteve um arquivo aberto' }),
  ).toBeVisible();
  expect(screen.getByText('Correspondência indireta')).toBeVisible();
});

it('retains connection inspection without applying the file-only sensitive filter', async () => {
  const connection = {
    domain: 'api.fixture.invalid',
    timestamp: 1,
    sensitive: true,
    verdict: 'flagged',
    attribution: { status: 'ambiguous', evidence: [] },
  };
  const inspect = vi.fn();
  render(AgentEvidence, { rows: [connection], agents: [], network: true, inspect, more: vi.fn() });
  expect(screen.queryByRole('group', { name: 'Activity filters' })).toBeNull();
  const button = screen.getByRole('button', { name: /^Open evidence.*api\.fixture\.invalid/ });
  expect(button).toHaveTextContent('Connection observed');
  expect(
    screen.getByText('Endpoint verification is separate from process identity.'),
  ).toBeVisible();
  await fireEvent.click(button);
  expect(inspect).toHaveBeenCalledExactlyOnceWith('Connection', connection);
});
