import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WorkspaceCommands from '../../../frontend/observatory/components/WorkspaceCommands.svelte';
import WorkspaceNavigation from '../../../frontend/observatory/components/WorkspaceNavigation.svelte';
import { workspaceCommands, findCommands } from '../../../frontend/observatory/runtime/navigation';

it('finds destinations through localized aliases and several search words', () => {
  expect(findCommands(workspaceCommands(), 'графики')).toMatchObject([{ target: 'stats' }]);
  expect(findCommands(workspaceCommands(), 'files skills')).toMatchObject([{ target: 'events' }]);
  expect(findCommands(workspaceCommands(), 'never-existing-destination')).toEqual([]);
});

it('opens a searched command from the keyboard and restores focus on close', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const choose = vi.fn();
  const close = vi.fn();
  const mounted = render(WorkspaceCommands, {
    open: true,
    close,
    entries: workspaceCommands(),
    choose,
  });
  const input = await screen.findByRole('combobox');
  await waitFor(() => expect(input).toHaveFocus());
  await fireEvent.input(input, { target: { value: 'статистика' } });
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ target: 'stats' }));
  await fireEvent.keyDown(input, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  await mounted.rerender({ open: false });
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});

it('keeps related destinations bounded and supports keyboard navigation', async () => {
  const navigate = vi.fn(async () => {});
  const mounted = render(WorkspaceNavigation, {
    view: 'events',
    navigate,
    back: vi.fn(),
    canBack: false,
    canForward: false,
  });
  expect(screen.getAllByRole('tab').map((el) => el.textContent.trim())).toEqual([
    'Events',
    'Network',
    'Audit',
  ]);
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'Events' }), { key: 'End' });
  expect(navigate).toHaveBeenCalledWith('audit');
  await mounted.rerender({ view: 'settings' });
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
});
