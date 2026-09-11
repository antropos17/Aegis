import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import SectionTabs from '../../../frontend/observatory/components/SectionTabs.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

const agent = {
  agent: 'Codex',
  process: 'codex.exe',
  pid: 42,
  instanceId: '42:polish',
  instanceIdSource: 'os',
};
const props = (host = {}) => ({
  host: { blocklistList: vi.fn(async () => []), ...host },
  telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents: [agent] },
  request: { title: 'Codex', row: agent },
  close: vi.fn(),
  refreshFalsePositives: vi.fn(),
});

it('opens each new detail at the top while preserving history scroll within a visit', async () => {
  const mounted = render(Details, props());
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Codex', exact: true })).toHaveFocus(),
  );
  const body = mounted.container.querySelector('#modal-body');
  body.scrollTop = 380;
  await mounted.rerender({ request: null });
  await mounted.rerender({
    request: { title: 'Another observation', row: { file: 'X:/second.txt' } },
  });
  await waitFor(() => expect(body.scrollTop).toBe(0));
  expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
});

it('moves focus into a section opened by an in-content shortcut without stealing tab focus', async () => {
  render(Details, props());
  const shortcut = await screen.findByRole('button', { name: 'Why this score' });
  shortcut.focus();
  await fireEvent.click(shortcut);
  await waitFor(() =>
    expect(screen.getByRole('tabpanel', { name: 'Risk explanation' })).toHaveFocus(),
  );
  const overview = screen.getByRole('tab', { name: 'Overview', exact: true });
  overview.focus();
  await fireEvent.click(overview);
  expect(overview).toHaveFocus();
});

it('leaves modified arrow keys to their workspace or operating-system shortcut', async () => {
  const change = vi.fn();
  render(SectionTabs, {
    tabs: [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
    ],
    selected: 'first',
    prefix: 'polish',
    change,
  });
  const first = screen.getByRole('tab', { name: 'First' });
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(change).not.toHaveBeenCalled();
  await fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(change).toHaveBeenCalledWith('second');
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' })).toHaveFocus());
});

it('keeps an action label and its feedback slot through pending and success, rejecting duplicate clicks', async () => {
  let complete;
  const suspendProcess = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const mounted = render(Details, props({ suspendProcess }));
  await fireEvent.click(await screen.findByRole('tab', { name: 'Controls' }));
  const button = screen.getByRole('button', { name: 'Suspend', exact: true });
  const feedback = button.parentElement.querySelector('.action-feedback');
  expect(feedback).toBeInTheDocument();
  await fireEvent.click(button);
  expect(button).toHaveAccessibleName('Suspend');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toHaveAccessibleDescription('Working…');
  await fireEvent.click(button);
  expect(suspendProcess).toHaveBeenCalledOnce();
  complete({ success: true });
  await waitFor(() => expect(button).toBeEnabled());
  expect(button).toHaveAccessibleDescription('Completed');
  expect(button.parentElement.querySelector('.action-feedback')).toBe(feedback);
  expect(mounted.container.textContent).toContain('Completed');
});

it('retains the action label and announces the complete failure reason', async () => {
  const reason = 'Collector unavailable: restart the observation source and try again.';
  render(
    Details,
    props({
      suspendProcess: vi.fn(async () => {
        throw new Error(reason);
      }),
    }),
  );
  await fireEvent.click(await screen.findByRole('tab', { name: 'Controls' }));
  const button = screen.getByRole('button', { name: 'Suspend', exact: true });
  await fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(reason);
  expect(button).toHaveAccessibleName('Suspend');
  expect(button).toHaveAccessibleDescription(reason);
  expect(button).toBeEnabled();
});

it('opens an agent destination in the surrounding workspace without another modal history entry', async () => {
  const openAgent = vi.fn();
  const close = vi.fn();
  render(Details, {
    ...props(),
    request: { title: 'Codex', row: { agentGroupKey: 'Codex', name: 'Codex' } },
    openAgent,
    close,
  });
  await fireEvent.click(await screen.findByRole('tab', { name: /Processes/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Open process PID 42' }));
  expect(close).toHaveBeenCalledOnce();
  expect(openAgent).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ instanceId: '42:polish' }),
  );
  expect(screen.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
});
