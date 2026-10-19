import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';
import { withoutToolContext } from '../../../frontend/observatory/runtime/tool-context-display';

const candidate = (extra: RecordData = {}) => ({
  source: 'claude-code',
  sessionRef: 'a'.repeat(64),
  callRef: 'b'.repeat(64),
  toolName: 'Read',
  argsDigest: 'c'.repeat(64),
  objectDigest: 'd'.repeat(64),
  argsShape: { operation: 'read', objectKind: 'path' },
  startMs: 1000,
  endMs: 2000,
  deltaMs: 250,
  strength: 'confirmed',
  reasons: [],
  ...extra,
});
const capsule = (extra: RecordData = {}) => ({
  schemaVersion: 1,
  relation: 'preceded-by',
  strength: 'confirmed',
  reasons: ['exact-binding-object-and-interval'],
  candidateCount: 1,
  candidatesTruncated: false,
  ambiguous: false,
  objectMatch: 'matched',
  sessionBinding: 'confirmed',
  candidates: [candidate()],
  ...extra,
});
const observation = (extra: RecordData = {}) => ({
  type: 'file-accessed',
  file: 'X:/Synthetic/.env',
  timestamp: 1250,
  attribution: { status: 'unattributed', evidence: [] },
  ...extra,
});
const show = (row: RecordData, section = 'overview') =>
  render(DetailSummary, {
    row,
    telemetry: emptyTelemetry(),
    section,
  });

it('shows preceding metadata after Observation without converting tool strength into PID attribution', () => {
  const { container } = show(observation({ toolContext: capsule() }));
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(within(section).getByText('Claude Code · Read')).toBeInTheDocument();
  expect(within(section).getAllByText('Matched preceding call')).toHaveLength(2);
  expect(within(section).getByText('Recorded session binding matched')).toBeInTheDocument();
  expect(within(section).getByText('Recorded object matched')).toBeInTheDocument();
  expect(within(section).getByText(/250 ms after reported tool start/)).toBeInTheDocument();
  expect(section.previousElementSibling).toHaveTextContent('Observation');
  expect(section).toHaveTextContent('does not establish causation or change PID attribution');
  expect(section).toHaveTextContent('Live tool correlation is unavailable');
  expect(section).not.toHaveTextContent('PID confirmed');
  expect(container.textContent).not.toContain('a'.repeat(64));
});

it('retains ambiguity and truncation instead of selecting or presenting a complete association', () => {
  show(
    observation({
      toolContext: capsule({
        candidateCount: 12,
        ambiguous: true,
        candidatesTruncated: true,
        candidates: [candidate(), candidate({ callRef: 'e'.repeat(64), toolName: 'Edit' })],
      }),
    }),
  );
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(
    within(section).getByText('Multiple candidates; no single tool call is established.'),
  ).toBeInTheDocument();
  expect(
    within(section).getByText('Candidate list is truncated; additional context is unavailable.'),
  ).toBeInTheDocument();
  expect(within(section).getAllByText('Possible preceding call')).toHaveLength(3);
  expect(within(section).getByText('12')).toBeInTheDocument();
  expect(within(section).getAllByRole('listitem')).toHaveLength(3);
});

it('exposes incomplete timing and historical wrappers without claiming an exact match', () => {
  show(
    observation({
      details: {
        toolContext: capsule({
          strength: 'inferred',
          reasons: ['end-time-unavailable'],
          candidates: [
            candidate({ endMs: null, strength: 'inferred', reasons: ['end-time-unavailable'] }),
          ],
        }),
      },
    }),
  );
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(within(section).getAllByText('Possible preceding call')).toHaveLength(2);
  expect(section).toHaveTextContent('completion time unavailable');
  expect(section).toHaveTextContent('A tool completion time was not recorded.');
});

it('preserves absence and fixed unavailable diagnostics without reflecting raw strings', async () => {
  const { rerender, container } = show(observation());
  expect(screen.getByRole('region', { name: 'Preceding tool call' })).not.toHaveTextContent('0');
  expect(
    screen.getByText('Tool context was not recorded for this observation.'),
  ).toBeInTheDocument();
  await rerender({
    row: observation({
      toolContext: capsule({
        strength: 'unattributed',
        candidateCount: 0,
        candidates: [],
        objectMatch: 'unavailable',
        sessionBinding: 'unavailable',
        reasons: ['clock-skew-unavailable', 'source-unavailable'],
      }),
    }),
    telemetry: emptyTelemetry(),
  });
  expect(screen.getByText('Clock alignment is unavailable.')).toBeInTheDocument();
  expect(screen.getByText('The tool history source is unavailable.')).toBeInTheDocument();
  await rerender({
    row: observation({
      toolContext: capsule({
        candidates: [candidate({ toolName: 'DO-NOT-DISPLAY https://secret/ prompt' })],
      }),
    }),
    telemetry: emptyTelemetry(),
  });
  expect(screen.getByText('Recorded tool context could not be validated.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/DO-NOT-DISPLAY|https:\/\/secret|prompt/);
});

it('hides capsules in generic historical attributes and preserves independent OS evidence', () => {
  const { container } = show(
    { type: 'security-event', details: { toolContext: capsule(), source: 'OS evidence retained' } },
    'attributes',
  );
  expect(screen.getByText('OS evidence retained')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/Session ref|Args digest|Call ref|PID confirmed/);
  expect(container.querySelector('pre')).toBeNull();
});

it('preserves compact unavailable summaries and gives an invalid top-level capsule precedence', async () => {
  const { rerender, container } = show(
    observation({
      toolContext: capsule({
        strength: 'unattributed',
        candidateCount: 24,
        candidatesTruncated: true,
        ambiguous: true,
        candidates: [],
        objectMatch: 'unavailable',
        sessionBinding: 'unavailable',
        reasons: ['context-unavailable', 'context-truncated'],
      }),
    }),
  );
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(within(section).getByText('24')).toBeInTheDocument();
  expect(section).toHaveTextContent('The retained tool context is incomplete.');
  expect(within(section).queryByRole('list', { name: 'Recorded tool candidates' })).toBeNull();
  await rerender({
    row: observation({ toolContext: null, extra: { toolContext: capsule() } }),
    telemetry: emptyTelemetry(),
  });
  expect(screen.getByText('Recorded tool context could not be validated.')).toBeInTheDocument();
  expect(container.textContent).not.toContain('Matched preceding call');
});

it('ignores raw tool payloads even when a known candidate is otherwise displayable', () => {
  const { container } = show(
    observation({
      toolContext: capsule({
        candidates: [
          candidate({
            arguments: {
              path: 'DO-NOT-DISPLAY',
              endpoint: 'DO-NOT-DISPLAY',
              command: 'DO-NOT-DISPLAY',
            },
            prompt: 'DO-NOT-DISPLAY',
            response: 'DO-NOT-DISPLAY',
          }),
        ],
      }),
    }),
  );
  expect(screen.getByText('Claude Code · Read')).toBeInTheDocument();
  expect(container.textContent).not.toContain('DO-NOT-DISPLAY');
  expect(container.querySelector('pre')).toBeNull();
});

it('keeps the section in the existing modal overview and preserves keyboard tab navigation', async () => {
  render(Details, {
    host: null,
    telemetry: emptyTelemetry(),
    request: { title: 'Synthetic observation', row: observation({ toolContext: capsule() }) },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(),
  });
  expect(await screen.findByRole('region', { name: 'Preceding tool call' })).toBeInTheDocument();
  const overview = screen.getByRole('tab', { name: 'Overview' });
  overview.focus();
  await fireEvent.keyDown(overview, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Attributes' })).toHaveFocus());
  expect(screen.queryByRole('region', { name: 'Preceding tool call' })).toBeNull();
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'Attributes' }), {
    key: 'Home',
  });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus());
  expect(screen.getByRole('region', { name: 'Preceding tool call' })).toBeInTheDocument();
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
});

const hostile = { toString: null, valueOf: null };
it.each([
  capsule({ strength: hostile }),
  capsule({ objectMatch: hostile }),
  capsule({ sessionBinding: hostile }),
  ...['strength', 'source', 'toolName', 'callRef'].map((key) =>
    capsule({ candidates: [candidate({ [key]: hostile })] }),
  ),
  ...['operation', 'objectKind'].map((key) =>
    capsule({
      candidates: [
        candidate({ argsShape: { operation: 'read', objectKind: 'path', [key]: hostile } }),
      ],
    }),
  ),
])('r2 keeps OS Details usable when a tool enum is a hostile JSON object %#', (toolContext) => {
  show(observation({ toolContext, action: 'OS observation retained' }));
  expect(screen.getByText('Recorded tool context could not be validated.')).toBeInTheDocument();
  expect(screen.getByText('OS observation retained')).toBeInTheDocument();
});

it.each([
  capsule({ reasons: ['exact-binding-object-and-interval', 'partial-source'] }),
  capsule({ reasons: ['exact-session-binding', 'clock-skew-unavailable'] }),
  capsule({ reasons: ['exact-binding-object-and-interval', 'context-truncated'] }),
  capsule({ reasons: ['exact-binding-object-and-interval', 'end-time-unavailable'] }),
  capsule({ ambiguous: true }),
  capsule({ candidateCount: 2, candidatesTruncated: true }),
  capsule({ sessionBinding: 'unavailable' }),
  capsule({ objectMatch: 'unavailable' }),
  capsule({ strength: 'inferred' }),
  capsule({ candidates: [candidate({ strength: 'inferred' })] }),
  capsule({ candidates: [candidate({ endMs: null, reasons: ['end-time-unavailable'] })] }),
  capsule({ candidates: [candidate({ reasons: ['end-time-unavailable'] })] }),
])('r2 applies evidence limits to every candidate, badge and diagnostic %#', (toolContext) => {
  show(observation({ toolContext }));
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(section.textContent).not.toMatch(/\bmatched\b|\bconfirmed\b/i);
  expect(section).not.toHaveTextContent('Preceded this observation');
});

it.each(['attributes', 'overview', 'signatures'])(
  'r2 excludes nested malformed capsules in every generic Metadata route: %s',
  (section) => {
    const raw = { prompt: 'DO-NOT-DISPLAY prompt', arguments: { path: 'DO-NOT-DISPLAY path' } };
    const wrapped = { records: [{ toolContext: raw, source: 'Nested OS evidence retained' }] };
    const { container } = show(
      {
        type: 'security-event',
        source: 'OS evidence retained',
        details: wrapped,
        detail: wrapped,
        names: [wrapped],
      },
      section,
    );
    expect(screen.getAllByText('Nested OS evidence retained').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('DO-NOT-DISPLAY');
    expect(container.textContent).not.toContain('Tool context');
  },
);

const cyclic: RecordData = { toolContext: { prompt: 'DO-NOT-DISPLAY' } };
cyclic.cycle = cyclic;
it.each([
  { cyclic },
  { deep: { a: { b: { c: { d: { e: { f: { g: cyclic } } } } } } } },
  {
    records: Array.from({ length: 2000 }, () => ({
      toolContext: { prompt: 'DO-NOT-DISPLAY' },
      source: 'ordinary metadata',
    })),
  },
  { payload: 'x'.repeat(1000000), toolContext: { prompt: 'DO-NOT-DISPLAY' } },
])('r2 independently bounds cycles, depth, arrays and oversized metadata %#', (details) => {
  const row = { source: 'OS evidence retained', details };
  const safe = withoutToolContext(row);
  const serialized = JSON.stringify(safe);
  expect(safe.source).toBe('OS evidence retained');
  expect(serialized).not.toContain('DO-NOT-DISPLAY');
  expect(serialized.length).toBeLessThan(65536);
  expect(serialized).toContain('Additional metadata unavailable');
});
