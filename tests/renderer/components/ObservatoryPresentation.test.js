import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import Reports from '../../../frontend/observatory/components/Reports.svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';

it('shows a single report row for all processes of the same agent', async () => {
  const agents = Array.from({ length: 12 }, (_, i) => ({
    agent: 'Codex',
    process: 'codex.exe',
    pid: i + 1,
    instanceId: String(i),
    instanceIdSource: 'os',
  }));
  const inspect = vi.fn();
  const mounted = render(Reports, {
    host: null,
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, agents },
    inspect,
    navigate: vi.fn(),
  });
  expect(mounted.container.querySelectorAll('.report-agent-group')).toHaveLength(1);
  expect(screen.getByText('12')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  expect(inspect).toHaveBeenCalledWith('Codex', { agentGroupKey: 'Codex', name: 'Codex' });
});

it('groups skill observations by resource and exposes every original record on opening', async () => {
  const events = Array.from({ length: 9 }, (_, i) => ({
    agent: '',
    instanceId: null,
    file: 'C:/Users/test/.codex/skills/review/SKILL.md',
    timestamp: Date.now() - i * 1000,
    action: 'modified',
    attribution: { status: 'unattributed' },
  }));
  const inspect = vi.fn();
  const mounted = render(Events, {
    telemetry: { ...emptyTelemetry(), ready: true, events },
    inspect,
  });
  expect(mounted.container.querySelectorAll('.observation-group')).toHaveLength(1);
  expect(within(screen.getByRole('table')).getByText('Codex')).toBeInTheDocument();
  expect(screen.getByText('review')).toBeInTheDocument();
  expect(screen.queryByText('Unknown')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Open 9 observations for review' }));
  expect(inspect.mock.calls[0][1].observations).toEqual(events);
  await fireEvent.change(screen.getByLabelText('Grouping'), { target: { value: 'none' } });
  expect(mounted.container.querySelectorAll('.observation-group')).toHaveLength(9);
});

it('shows the retained ISO audit time when opening a resource record', () => {
  const timestamp = '2026-09-09T10:15:30.000Z';
  render(DetailSummary, {
    row: {
      path: 'C:/Fixture/.codex/skills/review/SKILL.md',
      type: 'config-access',
      severity: 'sensitive',
      timestamp,
      attribution: { status: 'unattributed' },
    },
    telemetry: emptyTelemetry(),
  });
  expect(screen.getByText(new Date(timestamp).toLocaleString())).toBeInTheDocument();
  expect(screen.queryByText('Invalid Date')).toBeNull();
  expect(screen.getByText('C:/Fixture/.codex/skills/review/SKILL.md')).toBeInTheDocument();
  expect(screen.getByText('Codex')).toBeInTheDocument();
  expect(screen.getByText('Sensitive')).toBeInTheDocument();
});
