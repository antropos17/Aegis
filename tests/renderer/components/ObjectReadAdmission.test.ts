import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { BoundObjectReadEvent, DetectedAgent } from '../../../src/shared/types';
import InvestigationInspector from '../../../frontend/observatory/components/InvestigationInspector.svelte';
import Details from '../../../frontend/observatory/components/Details.svelte';
import Events from '../../../frontend/observatory/components/Events.svelte';
import SensitiveAlertCenter from '../../../frontend/observatory/components/SensitiveAlertCenter.svelte';
import EntityLinks from '../../../frontend/observatory/components/EntityLinks.svelte';
import { emptyTelemetry, type RecordData } from '../../../frontend/observatory/runtime/host';
import {
  createSensitiveAlertTracker,
  alertControlTarget,
  parseJournalAlerts,
} from '../../../frontend/observatory/runtime/sensitive-alerts';
import { exactExceptionTarget } from '../../../frontend/observatory/runtime/false-positive-control';
import {
  radarResources,
  resourceProcess,
} from '../../../frontend/observatory/runtime/radar-resources';
import { detailActivity } from '../../../frontend/observatory/runtime/detail-model';
import { scopeEvidence } from '../../../frontend/observatory/runtime/agent-scope';
import { scopeStatistics } from '../../../frontend/observatory/runtime/statistics-scope';
import {
  groupEvidence,
  groupActivity,
  radarGroups,
} from '../../../frontend/observatory/runtime/radar';
import { riskContext } from '../../../frontend/observatory/runtime/risk-context';
import { createProtectionActivityReader } from '../../../frontend/observatory/runtime/protection';
import {
  OBJECT_READ_EXPLANATION,
  observationLabel,
  pathActionTarget,
} from '../../../frontend/observatory/runtime/object-read';

const observed = {
  eventId: '00000000-0000-4000-8000-000000000901',
  observationKind: 'bound-object-read',
  agent: 'Codex',
  pid: 101,
  instanceId: '101:first',
  createTime100ns: '134000000000001111',
  parentEditor: null,
  cwd: 'X:/fixture',
  sensitive: true,
  selfAccess: false,
  reason: 'Sensitive bound policy',
  action: 'accessed',
  timestamp: 1000,
  category: 'ai',
  attribution: { status: 'confirmed', evidence: ['etw-file-object'] },
  object: {
    objectKey: 'opaque-object-A',
    bindingId: 'lease-A',
    label: 'X:/fixture/.env',
    scopeGeneration: 'scope-A',
    policyGeneration: 'policy-A',
    provenance: 'issuer-handle-file-id',
    policy: { sensitive: true, reason: 'Sensitive bound policy', classification: 'sensitive' },
  },
} satisfies BoundObjectReadEvent;

it('requires the exact full Windows birth for object alert controls despite equal rounded instance IDs', () => {
  const birth = '134000000000001111';
  const collision = '134000000000001112';
  const canonical = '71:' + ((BigInt(birth) - 116444736000000000n) / 10000n).toString();
  expect('71:' + ((BigInt(collision) - 116444736000000000n) / 10000n).toString()).toBe(canonical);
  const event = { ...observed, pid: 71, instanceId: canonical, createTime100ns: birth };
  const current = {
    agent: event.agent,
    process: 'aider.exe',
    pid: 71,
    instanceId: canonical,
    instanceIdSource: 'os' as const,
    status: 'running' as const,
    category: 'cli-tool',
    createTime100ns: birth,
    generationWitness: birth,
    generationWitnessSource: 'createTime100ns' as const,
  } satisfies DetectedAgent;
  const state = { ...emptyTelemetry(), ready: true, stale: false, agents: [current] };
  expect(alertControlTarget(event, state)).toBe(current);
  expect(
    alertControlTarget(event, {
      ...state,
      agents: [{ ...current, createTime100ns: collision, generationWitness: collision }],
    }),
  ).toBeNull();
  expect(
    alertControlTarget(
      { ...event, createTime100ns: undefined } as unknown as BoundObjectReadEvent,
      state,
    ),
  ).toBeNull();
  expect(
    alertControlTarget(event, { ...state, agents: [{ ...current, createTime100ns: undefined }] }),
  ).toBeNull();
  expect(alertControlTarget({ ...event, createTime100ns: '' }, state)).toBeNull();
});

it('keeps historical object reads out of a reused process lifetime across details, scopes and radar links', async () => {
  const reused = {
    agent: observed.agent,
    process: 'codex.exe',
    pid: observed.pid,
    instanceId: observed.instanceId,
    instanceIdSource: 'os' as const,
    createTime100ns: '134000000000001112',
    status: 'running' as const,
    category: 'cli-tool',
  } satisfies DetectedAgent;
  const currentRead = { ...observed, createTime100ns: reused.createTime100ns, timestamp: 900 };
  const state = {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    agents: [reused],
    events: [observed, currentRead],
  };
  const scope = { agent: reused.agent, instanceId: reused.instanceId };
  const rows = state.events as unknown as RecordData[];
  expect(scopeEvidence(rows, state, scope)).toEqual([currentRead]);
  expect(scopeStatistics(state, scope).events).toEqual([currentRead]);
  expect(detailActivity(reused, state)).toEqual([currentRead]);
  expect(state.events).toEqual([observed, currentRead]);
  const group = radarGroups([
    {
      ...reused,
      name: reused.agent,
      riskScore: 0,
    },
  ] as unknown as Parameters<typeof radarGroups>[0])[0];
  expect(groupEvidence(group, state).latest).toBe(currentRead.timestamp);
  expect(groupActivity(group, state, 3000).flatMap((bin) => bin.events)).toEqual([currentRead]);
  const relations = radarResources(state, 'files')[0].relations;
  expect(relations).toHaveLength(2);
  expect(
    resourceProcess(
      relations.find((relation) => relation.rows.includes(observed as unknown as RecordData))!,
      state,
    ),
  ).toBeNull();
  expect(
    resourceProcess(
      relations.find((relation) => relation.rows.includes(currentRead as unknown as RecordData))!,
      state,
    ),
  ).toBe(reused);
  expect(riskContext(observed as unknown as RecordData, state).subject).toBeUndefined();
  const mounted = render(EntityLinks, {
    row: observed as unknown as RecordData,
    telemetry: state,
    navigate: vi.fn(async () => {}),
  });
  expect(mounted.container.querySelector('[data-detail-focus="exact-process"]')).toBeNull();
  await mounted.rerender({ row: currentRead as unknown as RecordData });
  expect(mounted.container.querySelector('[data-detail-focus="exact-process"]')).not.toBeNull();
});

it('keeps resource grouping on opaque object identity and excludes incomplete object records', () => {
  const other = { ...observed, object: { ...observed.object, objectKey: 'opaque-object-B' } };
  const invalid = {
    ...observed,
    object: { ...observed.object, objectKey: '' },
    file: observed.object.label,
  };
  const state = {
    ...emptyTelemetry(),
    events: [observed, other, invalid as unknown as BoundObjectReadEvent],
  };
  expect(radarResources(state, 'files')).toHaveLength(2);
  const reader = createProtectionActivityReader();
  expect(reader(state.events as unknown as RecordData[], [])).toHaveLength(2);
});

it('renders new object reads in the ordinary event feed with binding-label provenance', async () => {
  const inspect = vi.fn();
  const row = observed as unknown as RecordData;
  render(Events, {
    telemetry: { ...emptyTelemetry(), ready: true, stale: false, events: [observed] },
    inspect,
  });
  const label = screen.getByText(observed.object.label);
  expect(label).toBeVisible();
  expect(screen.getByText('Binding label · access path unknown')).toBeVisible();
  await fireEvent.click(label);
  expect(inspect).toHaveBeenCalled();
  expect(inspect.mock.calls[0][1]).toMatchObject(row);
});

it('never offers folder or path exceptions for object reads, even with legacy path fields present', () => {
  const row = {
    ...observed,
    file: observed.object.label,
    path: observed.object.label,
  } as unknown as RecordData;
  const revealInExplorer = vi.fn();
  render(InvestigationInspector, {
    host: { revealInExplorer },
    request: { title: 'Object read', row, agents: [] },
    close: vi.fn(),
    fullDetails: vi.fn(),
    refreshFalsePositives: vi.fn(async () => {}),
  });
  const inspector = screen.getByRole('region', { name: 'Selected evidence' });
  expect(inspector).toHaveTextContent(OBJECT_READ_EXPLANATION);
  expect(within(inspector).getByText('Binding label')).toBeVisible();
  expect(within(inspector).queryByRole('button', { name: 'Show in folder' })).toBeNull();
  expect(within(inspector).queryByRole('button', { name: 'Mute false alarm' })).toBeNull();
  expect(pathActionTarget(row)).toBe('');
  expect(exactExceptionTarget(row)).toBeNull();
  expect(revealInExplorer).not.toHaveBeenCalled();
});

it('keeps full details and related resources free of actions based on a binding label', async () => {
  const row = observed as unknown as RecordData;
  render(Details, {
    telemetry: emptyTelemetry(),
    host: { revealInExplorer: vi.fn() },
    request: { title: 'Object read', row },
    close: vi.fn(),
    refreshFalsePositives: vi.fn(async () => {}),
  });
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(OBJECT_READ_EXPLANATION);
  expect(within(dialog).queryByRole('button', { name: 'Show in folder' })).toBeNull();
  await fireEvent.click(within(dialog).getByRole('tab', { name: 'Related' }));
  expect(within(dialog).queryByRole('button', { name: /Parent folder/ })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Mute false alarm' })).toBeNull();
});

it('preserves saved object summary semantics without reconstructing a path or live proof', () => {
  const wire = {
    eventId: observed.eventId,
    timestamp: observed.timestamp,
    basename: '.env',
    action: 'accessed',
    agent: 'Codex',
    attribution: 'confirmed',
    reviewed: false,
    observationKind: 'bound-object-read',
    labelSemantics: 'binding-label-access-path-unknown',
  };
  expect(parseJournalAlerts([{ ...wire, labelSemantics: undefined }])).toEqual([]);
  expect(parseJournalAlerts([{ ...wire, observationKind: undefined }])).toEqual([]);
  const tracker = createSensitiveAlertTracker();
  const items = tracker.mergeJournal(parseJournalAlerts([wire]));
  expect(items[0].live).toBe(false);
  expect(items[0].event.file).toBeUndefined();
  expect(items[0].event.object).toBeUndefined();
  expect(observationLabel(items[0].event)).toBe('.env');
  render(SensitiveAlertCenter, {
    items,
    evicted: 0,
    onReview: vi.fn(async () => true),
    onClose: vi.fn(),
  });
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(dialog).toHaveTextContent(
    'Saved object-read summary; name is a binding label. Access path unknown.',
  );
  expect(within(dialog).queryByRole('button', { name: 'Open evidence' })).toBeNull();
});

it('keeps the verified object identity and unknown access path visible in live alert review', () => {
  const tracker = createSensitiveAlertTracker();
  const items = tracker.ingest([observed]).items;
  render(SensitiveAlertCenter, {
    items,
    evicted: 0,
    onReview: vi.fn(async () => true),
    onClose: vi.fn(),
  });
  const dialog = screen.getByRole('dialog', { name: 'Sensitive activity review' });
  expect(dialog).toHaveTextContent(OBJECT_READ_EXPLANATION);
  expect(dialog).toHaveTextContent(observed.object.label);
});
