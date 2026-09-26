import { expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import RouteEvidence from '../../../frontend/observatory/components/RouteEvidence.svelte';
import {
  parseActionCheck,
  type ActionCheck,
} from '../../../frontend/observatory/runtime/action-coverage';
import {
  parseRouteObservation,
  type RouteObservation,
} from '../../../frontend/observatory/runtime/action-observation';
import { previewActionCoverage } from '../../../frontend/observatory/demo/action-coverage';

const firstConnection = '12345678-1234-1234-1234-123456789012';
const secondConnection = '87654321-4321-4321-4321-210987654321';

async function check(route = 'mcp-stdio', catalog = false): Promise<ActionCheck> {
  const response = await previewActionCoverage({
    action: catalog ? 'check-catalog' : 'check-route',
    route,
  });
  const parsed = parseActionCheck(response.check);
  if (!parsed) throw new Error('Invalid test check');
  return parsed;
}

function observed({
  state = 'observed',
  route = 'mcp-stdio',
  selection = 'single-action',
  invocations = 0,
  connectionId = firstConnection,
}: {
  state?: RouteObservation['state'];
  route?: NonNullable<RouteObservation['snapshot']>['route'];
  selection?: NonNullable<RouteObservation['snapshot']>['selection'];
  invocations?: number;
  connectionId?: string;
} = {}): RouteObservation {
  const snapshotState =
    state === 'coverage-lost' ? 'coverage-lost' : state === 'awaiting-client' ? state : 'observed';
  const parsed = parseRouteObservation({
    state,
    reason:
      state === 'coverage-lost'
        ? 'connection-closed'
        : state === 'stopped'
          ? 'observer-stopped'
          : null,
    lastObservedAt: '2026-09-26T07:00:00.000Z',
    snapshot: {
      schemaVersion: 1,
      connectionId,
      sequence: 1,
      route,
      state: snapshotState,
      selection,
      client: state === 'awaiting-client' ? null : { name: 'claude-code', version: '2.1.263' },
      selectedActionCount: state === 'awaiting-client' ? 0 : 1,
      actionAttempts: invocations,
      selectionRejected: 0,
      ownerInvocations: invocations,
      ownerSettled: invocations,
      ownerFailures: 0,
      cancellationRequests: 0,
    },
  });
  if (!parsed) throw new Error('Invalid test observation');
  return parsed;
}

it('keeps a captured check separate from an owner awaiting MCP initialization', async () => {
  const mounted = render(RouteEvidence, {
    check: await check(),
    observation: observed({ state: 'awaiting-client' }),
  });
  const panel = screen.getByRole('region', { name: 'Route evidence' });
  expect(within(panel).getByText('Selected inputs checked?')).toBeVisible();
  expect(within(panel).getByText('Captured check')).toBeVisible();
  expect(within(panel).getByText('Configuration valid')).toBeVisible();
  expect(within(panel).getByText('Waiting for MCP initialization')).toBeVisible();
  expect(within(panel).getByText('No call evidence')).toBeVisible();
  expect(within(panel).queryByText('Live observation')).toBeNull();
  mounted.unmount();
});

it('shows a fresh observed owner with zero selected tool calls and no execution claim', async () => {
  render(RouteEvidence, { check: await check(), observation: observed() });
  const panel = screen.getByRole('region', { name: 'Route evidence' });
  expect(within(panel).getByText('Live observation')).toBeVisible();
  expect(within(panel).getByText('No selected tool call observed')).toBeVisible();
  expect(within(panel).getByText(/labels match.*not a configuration binding/i)).toBeVisible();
  expect(within(panel).queryByText('Reached AEGIS owner')).toBeNull();
  expect(within(panel).queryByText(/blocking verified/i)).toBeNull();
});

it('shows an owner invocation independently when no selected inputs were checked', () => {
  render(RouteEvidence, { check: null, observation: observed({ invocations: 1 }) });
  expect(screen.getByText('Not checked')).toBeVisible();
  expect(screen.getByText('Live observation')).toBeVisible();
  expect(screen.getByText('Reached AEGIS owner')).toBeVisible();
  expect(screen.queryByText(/labels match/i)).toBeNull();
});

it.each(['coverage-lost', 'stopped'] as const)(
  'retains only past owner and call evidence after %s',
  async (state) => {
    const checked = await check();
    const mounted = render(RouteEvidence, {
      check: checked,
      observation: observed({ invocations: 1 }),
    });
    expect(screen.getByText('Reached AEGIS owner')).toBeVisible();
    expect(screen.getByText('Live observation')).toBeVisible();
    await mounted.rerender({ check: checked, observation: observed({ state, invocations: 1 }) });
    expect(screen.getByText('Past connection evidence')).toBeVisible();
    expect(screen.getByText('Previously reached AEGIS owner')).toBeVisible();
    expect(screen.getByText('Owner invocations: 1')).toBeVisible();
    expect(screen.getByText(/An owner invocation can return ask or deny/)).toBeVisible();
    expect(screen.queryByText('Live observation')).toBeNull();
  },
);

it.each([
  { route: 'mcp-review', selection: 'single-action' },
  { route: 'mcp-stdio', selection: 'catalog' },
] as const)(
  'shows a $route / $selection mismatch without converting label comparison to binding',
  async ({ route, selection }) => {
    render(RouteEvidence, {
      check: await check('mcp-stdio'),
      observation: observed({ route, selection }),
    });
    expect(screen.getByText(/Check and connection labels differ/)).toBeVisible();
    expect(screen.queryByText(/labels match/)).toBeNull();
    expect(screen.getByText('No selected tool call observed')).toBeVisible();
  },
);

it('states that selected-file deletion has no matching configuration preflight', async () => {
  render(RouteEvidence, {
    check: await check('mcp-review'),
    observation: observed({
      route: 'mcp-review',
      selection: 'selected-file-delete',
      invocations: 1,
    }),
  });
  expect(screen.getByText(/Selected file deletion has no matching preflight mode/)).toBeVisible();
  expect(screen.getByText('Reached AEGIS owner')).toBeVisible();
  expect(screen.queryByText(/labels match/)).toBeNull();
});

it('starts a new connection with fresh counters after prior call and coverage loss', async () => {
  const checked = await check();
  const mounted = render(RouteEvidence, {
    check: checked,
    observation: observed({ invocations: 1 }),
  });
  await mounted.rerender({
    check: checked,
    observation: observed({ state: 'coverage-lost', invocations: 1 }),
  });
  expect(screen.getByText('Previously reached AEGIS owner')).toBeVisible();
  await mounted.rerender({
    check: checked,
    observation: { state: 'connecting', reason: null, lastObservedAt: null, snapshot: null },
  });
  expect(screen.getByText('Waiting for MCP initialization')).toBeVisible();
  expect(screen.queryByText('Previously reached AEGIS owner')).toBeNull();
  await mounted.rerender({
    check: checked,
    observation: observed({ connectionId: secondConnection }),
  });
  expect(screen.getByText('Live observation')).toBeVisible();
  expect(screen.getByText('No selected tool call observed')).toBeVisible();
  expect(screen.queryByText('Previously reached AEGIS owner')).toBeNull();
});
