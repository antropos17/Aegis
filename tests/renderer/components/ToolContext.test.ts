import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import ToolContext from '../../../frontend/observatory/components/ToolContext.svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';
import { withoutToolContext } from '../../../frontend/observatory/runtime/tool-context-display';
import { language } from '../../../frontend/observatory/runtime/i18n';

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

it('refreshes the same retained UUID after restart instead of retaining its prior positive explanation', async () => {
  const eventId = '12345678-1234-4234-9234-123456789abc';
  const explainToolContext = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      availability: 'available',
      toolContext: capsule({
        strength: 'inferred',
        reasons: ['clock-skew-assumed-local'],
        candidates: [
          candidate({
            toolName: 'Write',
            argsShape: { operation: 'write', objectKind: 'path' },
            strength: 'inferred',
          }),
        ],
      }),
    })
    .mockResolvedValueOnce({
      success: true,
      availability: 'unavailable',
      toolContext: capsule({
        strength: 'unattributed',
        sessionBinding: 'unavailable',
        objectMatch: 'unavailable',
        candidateCount: 0,
        candidates: [],
        reasons: ['process-identity-unavailable'],
      }),
    });
  render(ToolContext, {
    row: observation({ eventId, action: 'created' }),
    host: { explainToolContext },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByText('Claude Code · Write')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(
    await screen.findByText('The process identity needed for binding is unavailable.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Claude Code · Write')).toBeNull();
  expect(explainToolContext.mock.calls).toEqual([[eventId], [eventId]]);
});

it('loads local history through the host using only the retained event ID', async () => {
  const eventId = '98765432-1234-4234-9234-123456789abc';
  const explainToolContext = vi.fn(async () => ({
    success: true,
    availability: 'partial',
    toolContext: capsule({
      strength: 'inferred',
      sessionBinding: 'unavailable',
      reasons: ['session-binding-inferred', 'clock-skew-assumed-local'],
      candidates: [candidate({ strength: 'inferred' })],
    }),
  }));
  render(ToolContext, { row: observation({ eventId }), host: { explainToolContext } });
  expect(explainToolContext).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  await waitFor(() => expect(screen.getByText('Claude Code · Read')).toBeInTheDocument());
  expect(explainToolContext).toHaveBeenCalledExactlyOnceWith(eventId);
  expect(screen.getByRole('region', { name: 'Preceding tool call' })).toHaveTextContent(
    'clock alignment was not measured',
  );
  expect(screen.queryByText('Matched preceding call')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'does not modify the recorded audit evidence',
  );
});

it('does not attach a delayed explanation to a newly selected observation', async () => {
  let complete!: (_value: unknown) => void;
  const host = {
    explainToolContext: vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
  };
  const { rerender } = render(ToolContext, { row: observation({ eventId: 'old-event' }), host });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  await rerender({ row: observation({ eventId: 'new-event' }), host });
  complete({ success: true, availability: 'available', toolContext: capsule() });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Explain from local history' })).toBeEnabled(),
  );
  expect(screen.queryByText('Claude Code · Read')).not.toBeInTheDocument();
});

it('labels a complete source as checked while keeping the association limits', async () => {
  const host = {
    explainToolContext: vi.fn(async () => ({
      success: true,
      availability: 'available',
      toolContext: capsule({
        prompt: 'PRIVATE_PROMPT',
        candidates: [candidate({ arguments: { path: 'PRIVATE_PATH' } })],
      }),
    })),
  };
  const { container } = render(ToolContext, {
    row: observation({ eventId: 'available-event' }),
    host,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Local history checked.');
  expect(screen.getByText('Claude Code · Read')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/PRIVATE_PROMPT|PRIVATE_PATH/);
});

it('marks a partial source and never upgrades a positive capsule to an exact association', async () => {
  const host = {
    explainToolContext: vi.fn(async () => ({
      success: true,
      availability: 'partial',
      toolContext: capsule(),
    })),
  };
  render(ToolContext, { row: observation({ eventId: 'partial-event' }), host });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Local history is partially available.',
  );
  const section = screen.getByRole('region', { name: 'Preceding tool call' });
  expect(section).toHaveTextContent('Only part of the tool history was available.');
  expect(section).toHaveTextContent('Claude Code · Read');
  expect(section).not.toHaveTextContent('Matched preceding call');
});

it.each([
  ['source-unavailable', 'The tool history source is unavailable.'],
  ['process-binding-mismatch', 'The process binding did not match.'],
])(
  'shows unavailable history and a fixed %s reason without a positive candidate',
  async (reason, label) => {
    const host = {
      explainToolContext: vi.fn(async () => ({
        success: true,
        availability: 'unavailable',
        toolContext: capsule({
          strength: 'unattributed',
          candidateCount: 0,
          candidates: [],
          objectMatch: 'unavailable',
          sessionBinding: 'unavailable',
          reasons: [reason],
        }),
      })),
    };
    render(ToolContext, { row: observation({ eventId: 'unavailable-event' }), host });
    await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Local history is unavailable.');
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('Claude Code · Read')).toBeNull();
    expect(screen.queryByText(/Local history checked/)).toBeNull();
  },
);

it('suppresses a contradictory positive capsule when availability is unavailable', async () => {
  const host = {
    explainToolContext: vi.fn(async () => ({
      success: true,
      availability: 'unavailable',
      toolContext: capsule(),
    })),
  };
  render(ToolContext, { row: observation({ eventId: 'contradictory-event' }), host });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Local history is unavailable.');
  expect(screen.queryByText('Claude Code · Read')).toBeNull();
  expect(screen.queryByText('Matched preceding call')).toBeNull();
});

it.each([undefined, null, 'bad', { prompt: 'PRIVATE_AVAILABILITY' }])(
  'rejects malformed availability %# without reflecting private data',
  async (availability) => {
    const host = {
      explainToolContext: vi.fn(async () => ({
        success: true,
        availability,
        toolContext: capsule({
          prompt: 'PRIVATE_PROMPT',
          candidates: [candidate({ arguments: { path: 'PRIVATE_PATH' } })],
        }),
      })),
    };
    const { container } = render(ToolContext, {
      row: observation({ eventId: 'invalid-event' }),
      host,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Local history response could not be validated.',
    );
    expect(screen.queryByText('Claude Code · Read')).toBeNull();
    expect(container.textContent).not.toMatch(/PRIVATE_AVAILABILITY|PRIVATE_PROMPT|PRIVATE_PATH/);
  },
);

it('clears an earlier live candidate after a failed refresh and keeps recorded metadata', async () => {
  const host = {
    explainToolContext: vi
      .fn()
      .mockResolvedValueOnce({ success: true, availability: 'available', toolContext: capsule() })
      .mockRejectedValueOnce(Error('PRIVATE_ERROR')),
  };
  const recorded = capsule({ candidates: [candidate({ toolName: 'Edit' })] });
  const { container } = render(ToolContext, {
    row: observation({ eventId: 'failed-event', toolContext: recorded }),
    host,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByText('Claude Code · Read')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Local history could not be read.');
  expect(screen.queryByText('Claude Code · Read')).toBeNull();
  expect(screen.getByText('Claude Code · Edit')).toBeInTheDocument();
  expect(container.textContent).not.toContain('PRIVATE_ERROR');
});

it('clears an earlier live candidate when the refreshed capsule is malformed', async () => {
  const host = {
    explainToolContext: vi
      .fn()
      .mockResolvedValueOnce({ success: true, availability: 'available', toolContext: capsule() })
      .mockResolvedValueOnce({
        success: true,
        availability: 'available',
        toolContext: { prompt: 'PRIVATE_RAW' },
      }),
  };
  const { container } = render(ToolContext, {
    row: observation({ eventId: 'malformed-refresh' }),
    host,
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByText('Claude Code · Read')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Local history response could not be validated.',
  );
  expect(screen.queryByText('Claude Code · Read')).toBeNull();
  expect(container.textContent).not.toContain('PRIVATE_RAW');
});

it('translates partial and unavailable live status in Portuguese', async () => {
  language.set('pt');
  try {
    const host = {
      explainToolContext: vi
        .fn()
        .mockResolvedValueOnce({ success: true, availability: 'partial', toolContext: capsule() })
        .mockResolvedValueOnce({
          success: true,
          availability: 'unavailable',
          toolContext: capsule({
            strength: 'unattributed',
            candidateCount: 0,
            candidates: [],
            objectMatch: 'unavailable',
            sessionBinding: 'unavailable',
            reasons: ['source-unavailable'],
          }),
        }),
    };
    render(ToolContext, { row: observation({ eventId: 'portuguese-event' }), host });
    const button = screen.getByRole('button', { name: 'Explicar a partir do histórico local' });
    await fireEvent.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'O histórico local está parcialmente disponível.',
    );
    await fireEvent.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'O histórico local está indisponível.',
    );
  } finally {
    language.set('en');
  }
});

it('discards an in-flight result when the selection changes away and back', async () => {
  let complete!: (_value: unknown) => void;
  const host = {
    explainToolContext: vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
  };
  const { rerender } = render(ToolContext, { row: observation({ eventId: 'first-event' }), host });
  await fireEvent.click(screen.getByRole('button', { name: 'Explain from local history' }));
  await rerender({ row: observation({ eventId: 'second-event' }), host });
  await rerender({ row: observation({ eventId: 'first-event' }), host });
  complete({ success: true, availability: 'available', toolContext: capsule() });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Explain from local history' })).toBeEnabled(),
  );
  expect(screen.queryByText('Claude Code · Read')).toBeNull();
  expect(screen.queryByText(/Local history checked/)).toBeNull();
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

it('renders Portuguese timing and bounded metadata markers while retaining literal evidence and tool names', async () => {
  language.set('pt');
  try {
    const { rerender, container } = show(observation({ toolContext: capsule() }));
    const section = screen.getByRole('region', { name: 'Chamada de ferramenta anterior' });
    expect(within(section).getByText('Claude Code · Read')).toBeInTheDocument();
    expect(section).toHaveTextContent(
      'Observação 250 ms após o início informado da ferramenta; dentro do intervalo informado da ferramenta',
    );
    expect(section).not.toHaveTextContent('Observation 250');
    await rerender({
      row: observation({
        toolContext: capsule({
          candidates: [candidate({ endMs: null, reasons: ['end-time-unavailable'] })],
        }),
      }),
      telemetry: emptyTelemetry(),
    });
    expect(section).toHaveTextContent('horário de conclusão indisponível');
    const limited: RecordData = { toolContext: { prompt: 'DO-NOT-DISPLAY' } };
    limited.cycle = limited;
    await rerender({
      row: { source: 'OS evidence retained', detail: limited },
      telemetry: emptyTelemetry(),
    });
    expect(screen.getAllByText('Metadados adicionais indisponíveis').length).toBeGreaterThan(0);
    expect(screen.getByText('OS evidence retained')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Additional metadata unavailable|DO-NOT-DISPLAY/);
  } finally {
    language.set('en');
  }
});
