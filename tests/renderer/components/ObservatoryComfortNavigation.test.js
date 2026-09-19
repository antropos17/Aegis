import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WorkspaceCommands from '../../../frontend/observatory/components/WorkspaceCommands.svelte';
import WorkspaceNavigation from '../../../frontend/observatory/components/WorkspaceNavigation.svelte';
import { workspaceCommands, findCommands } from '../../../frontend/observatory/runtime/navigation';

it('finds destinations through English aliases and several search words', () => {
  expect(findCommands(workspaceCommands(), 'graphs')).toMatchObject([{ target: 'stats' }]);
  expect(findCommands(workspaceCommands(), 'files skills')).toMatchObject([{ target: 'events' }]);
  expect(findCommands(workspaceCommands(), 'never-existing-destination')).toEqual([]);
});

it('shows one result per destination while retaining aliases and section shortcuts', () => {
  const entries = [
    { id: 'settings', target: 'settings', label: 'Settings', caption: '', keywords: 'preferences' },
    {
      id: 'appearance',
      target: 'settings',
      section: 'appearance',
      label: 'Appearance',
      caption: '',
      keywords: 'theme',
    },
    {
      id: 'task-settings',
      target: 'settings',
      label: 'Adjust AEGIS',
      caption: 'Change appearance',
      keywords: 'personalize',
    },
  ];
  expect(findCommands(entries, '').map((entry) => entry.id)).toEqual(['settings', 'appearance']);
  expect(findCommands(entries, 'personalize').map((entry) => entry.id)).toEqual(['task-settings']);
  expect(findCommands(entries, 'appearance')[0].section).toBe('appearance');
});

it('does not restore the old trigger when a chosen destination owns focus', async () => {
  const trigger = document.createElement('button');
  const destination = document.createElement('button');
  document.body.append(trigger, destination);
  trigger.focus();
  const mounted = render(WorkspaceCommands, {
    open: true,
    close: vi.fn(),
    entries: workspaceCommands(),
    choose: vi.fn(),
  });
  const input = await screen.findByRole('combobox');
  await waitFor(() => expect(input).toHaveFocus());
  await fireEvent.input(input, { target: { value: 'statistics' } });
  await fireEvent.keyDown(input, { key: 'Enter' });
  destination.focus();
  await mounted.rerender({ open: false });
  expect(destination).toHaveFocus();
  trigger.remove();
  destination.remove();
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
  await fireEvent.input(input, { target: { value: 'statistics' } });
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
