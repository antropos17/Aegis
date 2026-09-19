import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ActionCoverage from '../../../frontend/observatory/components/ActionCoverage.svelte';
import { previewActionCoverage } from '../../../frontend/observatory/demo/action-coverage';
import type { Host } from '../../../frontend/observatory/runtime/host';
const bridge = (fn: ReturnType<typeof vi.fn>) => ({ localSecurityReview: fn }) as Host;
const example = (catalog = false) =>
  previewActionCoverage({ action: catalog ? 'check-catalog' : 'check-route', route: 'mcp-stdio' });
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Choose files and check' }));

it('explains absent capability without checking on mount and labels keyboard controls', () => {
  render(ActionCoverage, { host: null });
  expect(screen.getByRole('button', { name: 'Choose files and check' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Selection type' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Execution route' })).toBeVisible();
  expect(screen.getByText(/Action checks are unavailable/)).toBeVisible();
  expect(
    screen.getByText('Configuration check only; blocking has not been verified.'),
  ).toBeVisible();
});
it('submits only action and route and preserves captured context through draft changes', async () => {
  const call = vi.fn().mockResolvedValue(await example());
  render(ActionCoverage, { host: bridge(call) });
  expect(call).not.toHaveBeenCalled();
  await start();
  expect(call).toHaveBeenCalledExactlyOnceWith({ action: 'check-route', route: 'mcp-stdio' });
  const result = await screen.findByRole('region', { name: 'Action check result' });
  expect(within(result).getByText('Single action · MCP stdio')).toBeVisible();
  expect(within(result).getByText(/retained observation, not live route status/)).toBeVisible();
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'catalog' } });
  await fireEvent.change(screen.getByLabelText('Execution route'), {
    target: { value: 'mcp-review' },
  });
  expect(within(result).getByText('Single action · MCP stdio')).toBeVisible();
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('option', { name: 'Direct execution' })).toBeNull();
});
it('serializes pending requests and ignores a destroyed component response', async () => {
  let complete!: (value: unknown) => void;
  const call = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(ActionCoverage, { host: bridge(call) });
  await start();
  expect(screen.getByLabelText('Selection type')).toBeDisabled();
  expect(screen.getByLabelText('Execution route')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Choose files and check' })).toBeDisabled();
  await fireEvent.submit(view.container.querySelector('form')!);
  expect(call).toHaveBeenCalledTimes(1);
  view.unmount();
  complete(await example());
  await Promise.resolve();
  expect(screen.queryByRole('region', { name: 'Action check result' })).toBeNull();
});
it.each(['cancel', 'error', 'malformed', 'throw'])(
  'retains the previous observation after %s',
  async (kind) => {
    const call = vi.fn().mockResolvedValueOnce(await example());
    render(ActionCoverage, { host: bridge(call) });
    await start();
    const result = await screen.findByRole('region', { name: 'Action check result' });
    if (kind === 'throw') call.mockRejectedValueOnce(Error('PRIVATE_EXCEPTION'));
    else
      call.mockResolvedValueOnce(
        kind === 'cancel'
          ? { cancelled: true }
          : kind === 'error'
            ? { success: false, error: 'PRIVATE_ERROR' }
            : { success: true, check: { report: 'PRIVATE' } },
      );
    await start();
    expect(screen.getByRole('region', { name: 'Action check result' })).toBe(result);
    expect(screen.getByText(/Previous results are retained/)).toBeVisible();
    expect(document.body.textContent).not.toContain('PRIVATE');
  },
);
it('shows all catalog decisions without a protection verdict and excludes non-MCP routes', async () => {
  const call = vi.fn().mockResolvedValue(await example(true));
  render(ActionCoverage, { host: bridge(call) });
  await fireEvent.change(screen.getByLabelText('Execution route'), { target: { value: 'direct' } });
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'catalog' } });
  expect(screen.getByLabelText('Execution route')).toHaveValue('mcp-stdio');
  await start();
  expect(call).toHaveBeenCalledWith({ action: 'check-catalog', route: 'mcp-stdio' });
  const result = await screen.findByRole('region', { name: 'Action check result' });
  for (const decision of ['allow', 'ask', 'deny'])
    expect(
      within(result).getByRole('heading', { name: 'aegis_action_demo_' + decision }),
    ).toBeVisible();
  expect(within(result).getByText('Not retained as a binding or authorization')).toBeVisible();
  expect(within(result).getByText('Not performed')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Blocking verified|100%|safe verdict/i);
  expect(screen.queryByRole('button', { name: /execute|export|install/i })).toBeNull();
});
it('clearly labels preview and requires an explicit example request', async () => {
  const call = vi.fn().mockResolvedValue(await example());
  render(ActionCoverage, { host: bridge(call), preview: true });
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByText(/Preview · example checks only/)).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Show example check' }));
  expect(await screen.findByText('Example check loaded. No files were read.')).toBeVisible();
});
