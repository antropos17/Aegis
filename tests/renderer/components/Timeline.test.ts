/**
 * Timeline.test.ts — the attribution row on the timeline tooltip.
 *
 * These assert what a user actually sees. `timeline-utils.test.ts` pins that the Event
 * Schema v1 fields survive the transform; this pins that the attribution reaches the DOM,
 * that an unresolved owner reads "Unknown source" and never a name, and that a pre-v1
 * event's tooltip is byte-for-byte what it was before v1.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { AUDIT_EVENT_TYPES } from '../../../src/renderer/lib/utils/timeline-utils';

/**
 * jsdom has no ResizeObserver, which Svelte's `bind:clientWidth` needs. A no-op is enough:
 * the width stays 0, dots still render, and nothing here asserts geometry.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const globalWithRO = globalThis as unknown as { ResizeObserver?: unknown };
globalWithRO.ResizeObserver = globalWithRO.ResizeObserver ?? NoopResizeObserver;

/**
 * `window.aegis` must exist BEFORE `stores/ipc` is evaluated. Without it that module takes
 * the demo-mode branch and starts a timer that injects synthetic events into the very
 * timeline under test. Hence the dynamic imports below.
 */
const noop = () => {};
(window as unknown as { aegis: unknown }).aegis = {
  onScanBatch: noop,
  onFileAccess: noop,
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: () => Promise.resolve({}),
  getResourceUsage: () => Promise.resolve({}),
  getFalsePositives: () => Promise.resolve([]),
  getSettings: () => Promise.resolve({}),
  saveSettings: () => Promise.resolve({}),
  getAuditEntriesBefore: () => Promise.resolve([]),
};

const { events, network } = await import('../../../src/renderer/lib/stores/ipc.js');
const Timeline = (await import('../../../src/renderer/lib/components/Timeline.svelte')).default;

const AT = new Date('2026-08-04T09:00:00.000Z').getTime();

/** One live file event, shaped as the file watcher emits it. */
function fileEvent(over: Record<string, unknown>) {
  return {
    agent: 'Cursor',
    pid: 4242,
    parentEditor: null,
    cwd: null,
    file: '/home/user/.bashrc',
    sensitive: true,
    selfAccess: false,
    reason: '',
    action: 'read',
    timestamp: AT,
    category: 'ai',
    ...over,
  };
}

/** Hover the single dot and return the tooltip's text. */
async function tooltipTextFor(container: HTMLElement): Promise<string> {
  await waitFor(() => expect(container.querySelector('.dot-group')).toBeInTheDocument());
  await fireEvent.mouseEnter(container.querySelector('.dot-group') as Element);
  const tip = await waitFor(() => {
    const el = container.querySelector('.timeline-tooltip');
    expect(el).toBeInTheDocument();
    return el as HTMLElement;
  });
  return tip.textContent?.trim() ?? '';
}

describe('Timeline tooltip — attribution', () => {
  beforeEach(() => {
    events.set([]);
    network.set([]);
  });

  it('renders "Unknown source" for an unattributed event, and no agent name', async () => {
    events.set([
      fileEvent({
        // C-01: an unattributed event carries no agent name, and none is invented here.
        agent: '',
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      }),
    ] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toContain('Unknown source');
    expect(text).not.toContain('Cursor');
    // The raw status word is never surfaced — "Unknown source" is the whole statement.
    expect(text).not.toContain('unattributed');
  });

  it('keeps the status, and drops the evidence, when events cluster into one dot', async () => {
    // Two agents touching files on the same tick merge into one dot. Before the cluster
    // rule the tooltip read "2 events" and the attribution vanished from the UI entirely —
    // which for an unattributed group would have hidden an unresolved owner. The status is
    // true of both events so it survives; the codes differ, so they do not.
    events.set([
      fileEvent({ attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] } }),
      fileEvent({
        agent: 'Copilot',
        attribution: { status: 'confirmed', evidence: ['rm-holder-pid'] },
      }),
    ] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toContain('2 events');
    expect(text).toContain('confirmed');
    expect(text).not.toContain('handle-scan-pid');
    expect(text).not.toContain('rm-holder-pid');
  });

  it('renders the status and evidence codes for a confirmed event', async () => {
    events.set([
      fileEvent({ attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] } }),
    ] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toContain('Cursor');
    expect(text).toContain('confirmed via handle-scan-pid');
  });

  it('renders the status and evidence codes for an inferred event', async () => {
    events.set([
      fileEvent({
        agent: 'Copilot',
        attribution: { status: 'inferred', evidence: ['self-config-path'] },
      }),
    ] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toContain('inferred via self-config-path');
  });

  it('shows no score, percentage or count next to the attribution', async () => {
    events.set([
      fileEvent({
        pid: null,
        attribution: { status: 'confirmed', evidence: ['rm-holder-pid', 'handle-scan-pid'] },
      }),
    ] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    // The timestamp is the only digits allowed; everything after the agent name is words.
    const afterAgent = text.slice(text.indexOf('Cursor') + 'Cursor'.length);
    expect(afterAgent).not.toMatch(/[0-9]/);
    expect(afterAgent).not.toContain('%');
  });

  it('leaves a pre-v1 event with the exact tooltip it had before v1', async () => {
    // No `attribution` key at all — what every event looked like before v0.11.0.
    events.set([fileEvent({})] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toMatch(/^\d{2}:\d{2}:\d{2}\s+Cursor \[4242\]$/);
    expect(text).not.toContain('Unknown source');
    expect(text).not.toContain('confirmed');
    expect(text).not.toContain('inferred');
  });

  it('adds no attribution row when the ownership question does not apply', async () => {
    // `attribution: null` is the writer saying the question does not apply to this event —
    // not that the owner is unknown. Nothing is rendered for it.
    events.set([fileEvent({ attribution: null })] as never);

    const { container } = render(Timeline);
    const text = await tooltipTextFor(container);

    expect(text).toMatch(/^\d{2}:\d{2}:\d{2}\s+Cursor \[4242\]$/);
  });
});

describe('Timeline history — the type filter is the main process’s job', () => {
  interface AuditRow {
    timestamp: string;
    type: string;
    agent: string;
    action?: string;
    path?: string;
    severity?: string;
  }
  const bridge = (window as unknown as { aegis: Record<string, unknown> }).aegis;

  /** Five timeline-eligible rows, 10 minutes apart, all older than the live anchor at AT. */
  const FILE_ROWS: AuditRow[] = [50, 40, 30, 20, 10].map((min) => ({
    timestamp: new Date(AT - min * 60000).toISOString(),
    type: 'file-access',
    agent: 'Cursor',
    action: 'read',
    path: '/home/user/notes.md',
    severity: 'normal',
  }));
  /** 25 rows the timeline never shows, NEWER than every file row — the 25 an unfiltered fetch returns. */
  const NOISE_ROWS: AuditRow[] = Array.from({ length: 25 }, (_, i) => ({
    timestamp: new Date(AT - 300000 + i * 1000).toISOString(),
    type: 'agent-enter',
    agent: 'Cursor',
  }));
  const ALL_ROWS = [...FILE_ROWS, ...NOISE_ROWS].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  /**
   * A main process that honours every argument the way getEntriesBefore does: rows strictly
   * before the cursor, only the given types when a filter is passed, the newest `limit` of
   * them, oldest-first. The cursor matters: after a load the $effect in Timeline.svelte
   * fetches again while the thumb sits at the left edge, and null-identity rows never
   * dedup, so a mock that ignored it would grow the timeline without end.
   */
  const fetchMock = vi.fn((before: string, limit: number, types?: string[]) => {
    const rows = ALL_ROWS.filter(
      (r) => r.timestamp < before && (!Array.isArray(types) || types.includes(r.type)),
    );
    return Promise.resolve(rows.slice(-limit));
  });

  beforeEach(() => {
    events.set([]);
    network.set([]);
    fetchMock.mockClear();
    bridge.getAuditEntriesBefore = fetchMock;
  });

  afterEach(() => {
    bridge.getAuditEntriesBefore = () => Promise.resolve([]);
  });

  it('asks for the timeline event types and renders the historical rows that come back', async () => {
    events.set([fileEvent({})] as never);
    const { container } = render(Timeline);
    await waitFor(() => expect(container.querySelector('.scrub-track')).toBeInTheDocument());

    // jsdom's rect is all zeros, so the click lands at offset 0 — the left edge, where
    // handleTrackClick calls loadOlderHistory() directly.
    await fireEvent.click(container.querySelector('.scrub-track') as Element);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][2]).toEqual(AUDIT_EVENT_TYPES);
    // Five historical dots plus the live anchor. Unfiltered, the 25 newest rows are all
    // agent-enter, the mapped batch is empty and history is declared exhausted at one dot.
    await waitFor(() => expect(container.querySelectorAll('.dot-group')).toHaveLength(6));
  });
});
