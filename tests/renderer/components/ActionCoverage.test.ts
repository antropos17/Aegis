import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ActionCoverage from '../../../frontend/observatory/components/ActionCoverage.svelte';
import { previewActionCoverage } from '../../../frontend/observatory/demo/action-coverage';
import type { Host } from '../../../frontend/observatory/runtime/host';
const bridge = (fn: ReturnType<typeof vi.fn>) => ({ localSecurityReview: fn }) as Host;
const example = (catalog = false) =>
  previewActionCoverage({ action: catalog ? 'check-catalog' : 'check-route', route: 'mcp-stdio' });
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Choose files and check' }));

it('jumps to the configuration fields without invoking a review or opening a guide', async () => {
  const localSecurityReview = vi.fn();
  const openExternalUrl = vi.fn();
  render(ActionCoverage, { host: { localSecurityReview, openExternalUrl } as unknown as Host });
  const jump = screen.getByRole('button', { name: 'Go to configuration check' });
  jump.focus();
  await fireEvent.click(jump);
  expect(screen.getByRole('combobox', { name: 'Selection type' })).toHaveFocus();
  expect(localSecurityReview).not.toHaveBeenCalled();
  expect(openExternalUrl).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Action check result' })).toBeNull();
});

it('opens in-app setup guidance without reading files or starting a check', async () => {
  const navigate = vi.fn();
  const call = vi.fn();
  render(ActionCoverage, { host: bridge(call), navigate });
  await fireEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith('guide');
  expect(call).not.toHaveBeenCalled();
});

it('opens the separate exact-file setup guide without running an executable or catalog check', async () => {
  const localSecurityReview = vi.fn();
  const openExternalUrl = vi
    .fn()
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValueOnce({ success: true });
  render(ActionCoverage, { host: { localSecurityReview, openExternalUrl } as unknown as Host });
  expect(screen.getByText(/executable\/catalog check below does not assess it/)).toBeVisible();
  const guide = within(screen.getByRole('region', { name: 'Selected-file deletion setup' }));
  const button = guide.getByRole('button', { name: 'Open selected-file deletion guide' });
  await fireEvent.click(button);
  expect(await guide.findByRole('alert')).toHaveTextContent('Could not open the guide');
  await fireEvent.click(button);
  expect(await guide.findByRole('status')).toHaveTextContent('Guide opened in your browser.');
  expect(openExternalUrl).toHaveBeenLastCalledWith(
    'https://github.com/antropos17/Aegis/blob/master/docs/ACTION-DELETE-FILE.md',
  );
  expect(localSecurityReview).not.toHaveBeenCalled();
});

it('opens the opt-in Windows Job guide without presenting it as a checked action route', async () => {
  const localSecurityReview = vi.fn();
  const openExternalUrl = vi.fn().mockResolvedValue({ success: true });
  render(ActionCoverage, { host: { localSecurityReview, openExternalUrl } as unknown as Host });
  const guide = within(screen.getByRole('region', { name: 'Protected Windows action setup' }));
  expect(guide.getByText(/does not assess this CLI route/)).toBeVisible();
  await fireEvent.click(guide.getByRole('button', { name: 'Open protected Windows action guide' }));
  expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/antropos17/Aegis/blob/master/docs/ACTION-EXECUTION.md',
  );
  expect(localSecurityReview).not.toHaveBeenCalled();
});

it('distinguishes the selected-action owner from the third-party gateway and opens its fixed guide', async () => {
  const localSecurityReview = vi.fn();
  const openExternalUrl = vi.fn().mockResolvedValue({ success: true });
  render(ActionCoverage, { host: { localSecurityReview, openExternalUrl } as unknown as Host });
  const route = screen.getByRole('combobox', { name: 'Execution route' });
  expect(route).toHaveValue('mcp-stdio');
  expect(
    (within(route).getByRole('option', { name: 'Selected-action MCP stdio' }) as HTMLOptionElement)
      .selected,
  ).toBe(true);
  expect(screen.getByText(/selected-action MCP stdio owner \(--action-mcp-stdio\)/)).toBeVisible();
  const gatewayRegion = screen.getByRole('region', { name: 'Stdio gateway setup' });
  const form = screen.getByRole('button', { name: 'Choose files and check' }).closest('form')!;
  expect(
    form.compareDocumentPosition(gatewayRegion) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const gateway = within(gatewayRegion);
  expect(gateway.getByText(/separate stdio gateway \(--mcp-gateway-stdio\)/)).toHaveTextContent(
    'Action control does not check gateway setup, a running gateway, or live coverage.',
  );
  await fireEvent.click(gateway.getByRole('button', { name: 'Open stdio gateway guide' }));
  expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/antropos17/Aegis/blob/master/docs/MCP-STDIO-GATEWAY.md',
  );
  expect(await gateway.findByRole('status')).toHaveTextContent('Guide opened in your browser.');
  expect(localSecurityReview).not.toHaveBeenCalled();
});

it('keeps the selected-file guide disabled in preview', () => {
  const openExternalUrl = vi.fn();
  render(ActionCoverage, {
    host: { openExternalUrl } as unknown as Host,
    preview: true,
  });
  expect(screen.getByRole('button', { name: 'Open selected-file deletion guide' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open stdio gateway guide' })).toBeDisabled();
  expect(screen.getByText('External guides are disabled in this simulated preview.')).toBeVisible();
  expect(openExternalUrl).not.toHaveBeenCalled();
});

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
  expect(within(result).getByText('Single action · Selected-action MCP stdio')).toBeVisible();
  expect(within(result).getByText(/retained observation, not live route status/)).toBeVisible();
  expect(
    within(result).getByText('The policy allows this selected action. Nothing was run.'),
  ).toBeVisible();
  const details = within(result).getByText('Technical details').closest('details')!;
  expect(details.open).toBe(false);
  expect(within(result).getByText(/Agent connection has not been checked/)).toBeVisible();
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'catalog' } });
  await fireEvent.change(screen.getByLabelText('Execution route'), {
    target: { value: 'mcp-review' },
  });
  expect(within(result).getByText('Single action · Selected-action MCP stdio')).toBeVisible();
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
  expect(screen.getByRole('button', { name: 'Go to configuration check' })).toBeDisabled();
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
  await fireEvent.click(within(result).getByText('Technical details'));
  expect(within(result).getByText('Not retained as a binding or authorization')).toBeVisible();
  expect(within(result).getByText('Not performed')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Blocking verified|100%|safe verdict/i);
  expect(screen.queryByRole('button', { name: /execute|export|install/i })).toBeNull();
});
it('counts captured catalog outcomes and exposes reasons for review and invalid rows', async () => {
  const reply = await example(true);
  if (!reply.success || !('check' in reply)) throw Error('fixture unavailable');
  const check = reply.check as {
    report: {
      configuration: string;
      reason: string;
      actions: { name: string; configuration: string; policyDecision: string; reason: string }[];
    };
  };
  check.report.configuration = 'invalid';
  check.report.reason = 'catalog-invalid';
  check.report.actions.push(
    {
      name: 'aegis_action_demo_invalid',
      configuration: 'invalid',
      policyDecision: 'unknown',
      reason: 'policy-invalid',
    },
    {
      name: 'aegis_action_demo_unavailable',
      configuration: 'unavailable',
      policyDecision: 'unknown',
      reason: 'input-unavailable',
    },
  );
  render(ActionCoverage, { host: bridge(vi.fn().mockResolvedValue(reply)) });
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'catalog' } });
  await start();
  const result = await screen.findByRole('region', { name: 'Action check result' });
  expect(
    within(result).getByText(
      'These counts describe the captured configuration check. No actions were run.',
    ),
  ).toBeVisible();
  const counts = result.querySelector<HTMLElement>('.outcome-counts')!;
  for (const label of ['Allow', 'Ask', 'Deny', 'Invalid configuration', 'Not assessed'])
    expect(within(counts).getByText(label).parentElement).toHaveTextContent('1');
  expect(
    [...counts.querySelectorAll('dd')].reduce((total, item) => total + Number(item.textContent), 0),
  ).toBe(check.report.actions.length);
  for (const [name, reason] of [
    ['aegis_action_demo_ask', 'Policy requires confirmation'],
    ['aegis_action_demo_deny', 'Policy denies this action'],
    ['aegis_action_demo_invalid', 'The selected policy is invalid'],
  ]) {
    const row = within(result).getByRole('heading', { name }).closest('li') as HTMLElement;
    expect(within(row).getByText(reason)).toBeVisible();
    expect(row.querySelector('details')).toBeNull();
  }
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'single' } });
  expect(within(counts).getByText('Invalid configuration').parentElement).toHaveTextContent('1');
});
it('explains selected files and routes without changing a retained next step', async () => {
  const call = vi.fn().mockResolvedValue(await example());
  render(ActionCoverage, { host: bridge(call) });
  expect(screen.getByText(/For one action, choose its policy JSON file/)).toBeVisible();
  expect(screen.getByText(/Already have AEGIS configuration files/)).toBeVisible();
  await start();
  const result = await screen.findByRole('region', { name: 'Action check result' });
  const next = within(result).getByText(
    'Review the selected command and policy before using the route with your agent.',
  );
  await fireEvent.change(screen.getByLabelText('Selection type'), { target: { value: 'catalog' } });
  await fireEvent.change(screen.getByLabelText('Execution route'), {
    target: { value: 'mcp-review' },
  });
  expect(screen.getByText(/For a catalog, choose the catalog JSON file/)).toBeVisible();
  expect(screen.getByText(/MCP terminal review connects an agent while you approve/)).toBeVisible();
  expect(next).toBeVisible();
});
it.each(['ask', 'deny'] as const)(
  'explains %s without claiming an action ran or blocking was proven',
  async (decision) => {
    const reply = await example();
    if (!reply.success || !('check' in reply)) throw Error('fixture unavailable');
    const check = reply.check as { report: { policyDecision: string; reason: string } };
    check.report.policyDecision = decision;
    check.report.reason = 'policy-' + decision;
    render(ActionCoverage, { host: bridge(vi.fn().mockResolvedValue(reply)) });
    await start();
    const result = await screen.findByRole('region', { name: 'Action check result' });
    expect(
      within(result).getByText(
        decision === 'ask'
          ? 'The policy requires your confirmation. Nothing was run.'
          : 'The policy denies this selected action. No blocking test was run.',
      ),
    ).toBeVisible();
    expect(within(result).getByText('Next step')).toBeVisible();
  },
);
it('clearly labels preview and requires an explicit example request', async () => {
  const call = vi.fn().mockResolvedValue(await example());
  render(ActionCoverage, { host: bridge(call), preview: true });
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByText(/Preview · example checks only/)).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Show example check' }));
  expect(await screen.findByText('Example check loaded. No files were read.')).toBeVisible();
});

it('shows live owner evidence separately from the retained configuration check', async () => {
  const observation = {
    state: 'observed',
    reason: null,
    lastObservedAt: '2026-09-26T07:00:00.000Z',
    snapshot: {
      schemaVersion: 1,
      connectionId: '12345678-1234-1234-1234-123456789012',
      sequence: 1,
      route: 'mcp-stdio',
      state: 'observed',
      selection: 'single-action',
      client: { name: 'claude-code', version: '2.1.263' },
      selectedActionCount: 1,
      actionAttempts: 1,
      selectionRejected: 0,
      ownerInvocations: 1,
      ownerSettled: 1,
      ownerFailures: 0,
      cancellationRequests: 0,
    },
  };
  const checkReply = await example();
  const call = vi.fn(async ({ action }) =>
    action === 'check-route' ? checkReply : { success: true, observation },
  );
  render(ActionCoverage, { host: bridge(call) });
  await fireEvent.click(screen.getByRole('button', { name: 'Choose observation endpoint' }));
  const evidence = await screen.findByRole('region', { name: 'Route evidence' });
  expect(within(evidence).getByText('Not checked')).toBeVisible();
  expect(within(evidence).getByText('Reached AEGIS owner')).toBeVisible();
  await start();
  expect(await within(evidence).findByText('Captured check')).toBeVisible();
  expect(within(evidence).getByText(/labels match.*not a configuration binding/i)).toBeVisible();
  expect(within(evidence).queryByText(/blocking verified/i)).toBeNull();
  expect(call).toHaveBeenCalledWith({ action: 'observe-route' });
  expect(call).toHaveBeenCalledWith({ action: 'check-route', route: 'mcp-stdio' });
});

it('puts captured checks first without stealing focus and provides explicit setup navigation', async () => {
  render(ActionCoverage, { host: bridge(vi.fn().mockResolvedValue(await example())) });
  const trigger = screen.getByRole('button', { name: 'Choose files and check' });
  trigger.focus();
  await start();
  const result = await screen.findByRole('region', { name: 'Action check result' });
  const setup = screen.getByRole('region', { name: 'Action check setup' });
  expect(result.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'View captured result' }));
  expect(result).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'Change check setup' }));
  expect(screen.getByLabelText('Selection type')).toHaveFocus();
});
