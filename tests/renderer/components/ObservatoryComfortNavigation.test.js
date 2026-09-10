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

it('keeps history controls available without duplicating workspace destinations', async () => {
  const back = vi.fn();
  const mounted = render(WorkspaceNavigation, { back, canBack: false, canForward: false });
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  await mounted.rerender({ canBack: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(back).toHaveBeenLastCalledWith(-1);
  await mounted.rerender({ canForward: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  expect(back).toHaveBeenLastCalledWith(1);
});
