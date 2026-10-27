import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('navigates detail history with Alt arrows without stealing editable or nested dialog keys', async () => {
  const agent = {
    agent: 'Codex',
    process: 'agent.exe',
    pid: 23,
    instanceId: '23:live',
    instanceIdSource: 'os',
    generationWitness: 'generation-23',
    generationWitnessSource: 'createTime100ns',
    cwd: 'X:/project-23',
  };
  const telemetry = { ...emptyTelemetry(), ready: true, stale: false, agents: [agent] };
  render(Details, {
    host: {},
    telemetry,
    request: { title: 'Codex', row: { agentGroupKey: 'Codex', name: 'Codex' } },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(),
  });
  await fireEvent.click(await screen.findByRole('tab', { name: /Processes/ }));
  const process = screen.getByRole('button', { name: 'Open process PID 23' });
  process.focus();
  await fireEvent.click(process);
  const dialog = screen.getByRole('dialog');
  await fireEvent.click(
    await within(dialog).findByRole('tab', { name: 'Attributes', exact: true }),
  );
  expect(within(dialog).getByText('23:live')).toBeInTheDocument();

  const nested = document.createElement('dialog');
  nested.setAttribute('open', '');
  const nestedButton = document.createElement('button');
  nested.append(nestedButton);
  dialog.append(nested);
  await fireEvent.keyDown(nestedButton, { key: 'ArrowLeft', altKey: true });
  await fireEvent.keyDown(dialog, { key: 'ArrowLeft', altKey: true, ctrlKey: true });
  expect(within(dialog).getByText('23:live')).toBeInTheDocument();
  nested.remove();

  await fireEvent.keyDown(dialog, { key: 'ArrowLeft', altKey: true });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true'),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open process PID 23' })).toHaveFocus(),
  );
  const search = screen.getByLabelText('Find a process');
  search.focus();
  await fireEvent.keyDown(search, { key: 'ArrowRight', altKey: true });
  expect(screen.getByLabelText('Find a process')).toBeInTheDocument();
  await fireEvent.keyDown(dialog, { key: 'ArrowRight', altKey: true });
  await waitFor(() => expect(within(dialog).getByText('23:live')).toBeInTheDocument());
});
