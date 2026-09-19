import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import LocalSecurity from '../../../frontend/observatory/components/LocalSecurity.svelte';
import { previewLocalSecurity } from '../../../frontend/observatory/demo/local-security';
import { reviewRows, localReview } from '../../../frontend/observatory/runtime/local-security';
import type { Host } from '../../../frontend/observatory/runtime/host';

const reply = (mode = 'scan', tools = false) =>
  previewLocalSecurity({ action: 'run', mode, adapter: 'project', tools });
const bridge = (fn: ReturnType<typeof vi.fn>) => ({ localSecurityReview: fn }) as Host;
const start = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder and review' }));
const options = () => fireEvent.click(screen.getByText('Review options', { exact: true }));

it('does not invoke the host on mount and explains the absent capability', () => {
  render(LocalSecurity, { host: null });
  expect(screen.getByRole('heading', { name: 'No local review yet' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Choose folder and review' })).toBeDisabled();
  expect(screen.getByText(/Local review is unavailable/)).toBeVisible();
});
it('submits bounded options and shows findings, source and incomplete coverage', async () => {
  const call = vi.fn().mockResolvedValue(await reply('scan', true));
  render(LocalSecurity, { host: bridge(call) });
  expect(call).not.toHaveBeenCalled();
  await options();
  await fireEvent.click(screen.getByLabelText('Include an offline MCP tools/list file'));
  await start();
  expect(call).toHaveBeenCalledWith({
    action: 'run',
    mode: 'scan',
    adapter: 'project',
    tools: true,
    baseline: false,
  });
  expect(await screen.findByText('Findings need review')).toBeVisible();
  expect(screen.getByText('Incomplete coverage')).toBeVisible();
  expect(screen.getByText(/Offline MCP description · Tool #1 · Description line 2/)).toBeVisible();
  expect(screen.getByText('Safety not determined')).toBeVisible();
});
it('keeps no-findings and unexamined semantics explicit', async () => {
  const data = await reply();
  const reviewed = localReview(data.review)!;
  reviewed.report.findings = [];
  render(LocalSecurity, {
    host: bridge(vi.fn().mockResolvedValue({ success: true, review: reviewed })),
  });
  await start();
  expect(await screen.findByText('No patterns found in the checked subset')).toBeVisible();
  expect(screen.getByText('Incomplete coverage')).toBeVisible();
  await fireEvent.click(screen.getByRole('tab', { name: /Scope & coverage/ }));
  expect(screen.getByText('instruction semantics not analyzed')).toBeVisible();
});
it('retains the previous result and distinguishes cancellation from completion', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(await reply())
    .mockResolvedValueOnce({ success: false, cancelled: true });
  render(LocalSecurity, { host: bridge(call) });
  await start();
  await screen.findByText('Findings need review');
  await start();
  expect(await screen.findByText('Cancelled. Previous results are retained.')).toBeVisible();
  expect(screen.getByText('Findings need review')).toBeVisible();
});
it('preserves old results after failure without displaying raw filesystem error text', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(await reply())
    .mockResolvedValueOnce({ success: false, error: 'PRIVATE_SECRET C:/private/file' });
  render(LocalSecurity, { host: bridge(call) });
  await start();
  await screen.findByText('Findings need review');
  await start();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not complete');
  expect(screen.queryByText(/PRIVATE_SECRET/)).toBeNull();
  expect(screen.getByText('Findings need review')).toBeVisible();
});
it('disables duplicate actions and draft changes while the native operation is pending', async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(LocalSecurity, { host: bridge(call) });
  await start();
  expect(screen.getByRole('button', { name: 'Choose folder and review' })).toBeDisabled();
  expect(screen.getByLabelText('Review type')).toBeDisabled();
  expect(screen.getByLabelText('Directory layout')).toBeDisabled();
  finish(await reply());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Choose folder and review' })).toBeEnabled(),
  );
});
it('resets unsupported package scope and exposes inventory packages without a safety verdict', async () => {
  const call = vi.fn().mockResolvedValue(await reply('inventory'));
  render(LocalSecurity, { host: bridge(call) });
  await options();
  await fireEvent.change(screen.getByLabelText('Directory layout'), {
    target: { value: 'package' },
  });
  await fireEvent.change(screen.getByLabelText('Review type'), { target: { value: 'inventory' } });
  expect(screen.getByLabelText('Directory layout')).toHaveValue('project');
  await start();
  expect(await screen.findByText('Inventory recorded')).toBeVisible();
  expect(screen.queryByRole('tab', { name: /Findings/ })).toBeNull();
  expect(screen.getByLabelText('Review summary')).toHaveTextContent('packages recorded');
  await fireEvent.click(screen.getByRole('tab', { name: /Packages/ }));
  expect(screen.getByText('Publisher unverified · installation not established')).toBeVisible();
});
it('requires explicit review acknowledgment and sends the displayed digest', async () => {
  const data = await reply('inventory');
  const reviewed = localReview(data.review)!;
  const call = vi
    .fn()
    .mockResolvedValueOnce(data)
    .mockResolvedValueOnce({ success: true, saved: true, accepted: true });
  render(LocalSecurity, { host: bridge(call) });
  await start();
  await screen.findByText('Inventory recorded');
  await fireEvent.click(screen.getByText('Content snapshot'));
  const accept = screen.getByRole('button', { name: 'Recheck and save accepted copy' });
  expect(accept).toBeDisabled();
  expect(
    within(screen.getByText('Content snapshot').parentElement!).getByText(
      reviewed.snapshot!.digest,
    ),
  ).toBeVisible();
  await fireEvent.click(
    screen.getByLabelText('I reviewed the listed content and the displayed digest.'),
  );
  await fireEvent.click(accept);
  expect(call).toHaveBeenLastCalledWith({
    action: 'accept',
    id: reviewed.id,
    digest: reviewed.snapshot!.digest,
  });
  expect(await screen.findByText('Accepted copy saved')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Recheck and save accepted copy' })).toBeNull();
});
it('keeps acceptance pending when content changed after review', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(await reply('inventory'))
    .mockResolvedValueOnce({ success: false, error: 'snapshot-changed-since-review' });
  render(LocalSecurity, { host: bridge(call) });
  await start();
  await screen.findByText('Inventory recorded');
  await fireEvent.click(screen.getByText('Content snapshot'));
  await fireEvent.click(
    screen.getByLabelText('I reviewed the listed content and the displayed digest.'),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Recheck and save accepted copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed after review');
  expect(screen.queryByText('Accepted copy saved')).toBeNull();
});
it('submits external import options and labels claims as unverified', async () => {
  const call = vi.fn().mockResolvedValue(await reply('import'));
  render(LocalSecurity, { host: bridge(call) });
  await options();
  await fireEvent.change(screen.getByLabelText('Review type'), { target: { value: 'import' } });
  await fireEvent.change(screen.getByLabelText('Report format'), {
    target: { value: 'cisco-skill-sarif' },
  });
  await fireEvent.click(screen.getByLabelText('Compare with a previous AEGIS static report'));
  await start();
  expect(call).toHaveBeenCalledWith({
    action: 'run',
    mode: 'import',
    adapter: 'project',
    tools: false,
    baseline: true,
    format: 'cisco-skill-sarif',
  });
  expect(await screen.findByText(/External claims are unverified/)).toBeVisible();
});
it('retains every result through pagination, filtering and keyboard tabs', async () => {
  const data = await reply();
  const reviewed = localReview(data.review)!;
  reviewed.report.findings = Array.from({ length: 25 }, (_, index) => ({
    title: 'Finding ' + index,
    path: 'file-' + index + '.sh',
    severity: 'medium',
  }));
  render(LocalSecurity, {
    host: bridge(vi.fn().mockResolvedValue({ success: true, review: reviewed })),
  });
  await start();
  await screen.findByText('Findings need review');
  const panel = screen.getByRole('tabpanel', { name: /Findings/ });
  expect(within(panel).queryByText('Finding 24')).toBeNull();
  await fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
  expect(within(panel).getByText('Finding 24', { selector: 'strong' })).toBeVisible();
  await fireEvent.input(within(panel).getByLabelText('Filter results'), {
    target: { value: 'Finding 0' },
  });
  expect(within(panel).getByText('Finding 0', { selector: 'strong' })).toBeVisible();
  await fireEvent.keyDown(screen.getByRole('tab', { name: /Findings/ }), { key: 'End' });
  await waitFor(() => expect(screen.getByRole('tab', { name: /Scope & coverage/ })).toHaveFocus());
});
it('keeps preview data explicit and disables persistent actions', async () => {
  const call = vi.fn().mockResolvedValue(await reply('inventory'));
  render(LocalSecurity, { host: bridge(call), preview: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Show example result' }));
  expect(await screen.findByText('Simulated review loaded. No files were read.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
  await fireEvent.click(screen.getByText('Content snapshot'));
  expect(screen.getByRole('button', { name: 'Save unreviewed snapshot' })).toBeDisabled();
});
it('preserves uncertainty in partial changes and paginated MCP catalogs', () => {
  const rows = reviewRows(
    { changes: { components: { unobserved: ['missing.sh'], newlyObserved: ['new.sh'] } } },
    'changes',
  );
  expect(rows.map((row) => row.subtitle)).toEqual([
    'components · newly observed',
    'components · unobserved',
  ]);
  expect(reviewRows({ catalog: { complete: false } }, 'coverage')[0].title).toBe(
    'MCP catalog is incomplete',
  );
});

it('starts with one default project review and keeps advanced choices collapsed', async () => {
  const call = vi.fn().mockResolvedValue(await reply());
  render(LocalSecurity, { host: bridge(call) });
  const disclosure = screen.getByText('Review options', { exact: true }).parentElement!;
  expect(disclosure).not.toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Choose folder and review' })).toBeVisible();
  expect(screen.getByText(/Ready to review:/)).toHaveTextContent('Security scan');
  await start();
  expect(call).toHaveBeenCalledWith({
    action: 'run',
    mode: 'scan',
    adapter: 'project',
    tools: false,
    baseline: false,
  });
});

it('keeps chosen expert options when the disclosure closes and leaves the captured result unchanged', async () => {
  const call = vi.fn().mockResolvedValue(await reply());
  render(LocalSecurity, { host: bridge(call) });
  await start();
  await screen.findByText('Findings need review');
  await options();
  await fireEvent.change(screen.getByLabelText('Review type'), { target: { value: 'inventory' } });
  await options();
  expect(screen.getByText(/Ready to review:/)).toHaveTextContent('Component inventory');
  expect(screen.getByRole('heading', { name: 'Findings need review' })).toBeVisible();
  await start();
  expect(call).toHaveBeenLastCalledWith({
    action: 'run',
    mode: 'inventory',
    adapter: 'project',
    tools: false,
    baseline: false,
  });
});

it('moves focus to the suggested evidence tab while captured source stays visible', async () => {
  const data = await reply();
  render(LocalSecurity, { host: bridge(vi.fn().mockResolvedValue(data)) });
  await start();
  await screen.findByText('Findings need review');
  expect(screen.getByText(localReview(data.review)!.directory)).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Review findings' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Findings/ })).toHaveFocus());
  expect(screen.getByText(localReview(data.review)!.directory)).toBeVisible();
});

it('directs a no-findings result to coverage without implying safety', async () => {
  const data = await reply();
  const reviewed = localReview(data.review)!;
  reviewed.report.findings = [];
  render(LocalSecurity, {
    host: bridge(vi.fn().mockResolvedValue({ success: true, review: reviewed })),
  });
  await start();
  await fireEvent.click(await screen.findByRole('button', { name: 'Review coverage' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Scope & coverage/ })).toHaveFocus());
  expect(screen.getByText('Safety not determined')).toBeVisible();
  expect(screen.getByText('Incomplete coverage')).toBeVisible();
});

it('keeps captured evidence before setup and moves focus only through explicit controls', async () => {
  render(LocalSecurity, { host: bridge(vi.fn().mockResolvedValue(await reply())) });
  const trigger = screen.getByRole('button', { name: 'Choose folder and review' });
  trigger.focus();
  await start();
  const result = await screen.findByRole('region', { name: 'Local review results' });
  const setup = screen.getByRole('region', { name: 'Local review setup' });
  expect(result.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'View captured result' }));
  expect(result).toHaveFocus();
  await fireEvent.click(screen.getByRole('button', { name: 'Change review setup' }));
  expect(trigger).toHaveFocus();
});

it('does not move delayed evidence-tab focus into a hidden workspace', async () => {
  const view = render(LocalSecurity, { host: bridge(vi.fn().mockResolvedValue(await reply())) });
  await start();
  await screen.findByRole('region', { name: 'Local review results' });
  const button = screen.getByRole('button', { name: 'Review findings' });
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  view.container.hidden = true;
  await fireEvent.click(button);
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});
