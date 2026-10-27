import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import CoveragePanel from '../../../frontend/observatory/components/CoveragePanel.svelte';
import App from '../../../frontend/observatory/App.svelte';
import { emptyTelemetry, record, type Host } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';
import { coverageFixture } from '../coverage-fixture';

afterEach(() => {
  language.set('en');
  localStorage.clear();
});
const props = () => ({
  telemetry: coverageFixture(),
  navigate: vi.fn(),
  openSensorDetails: vi.fn(),
});

it('shows current unavailable watch groups safely without changing project coverage', async () => {
  const input = props();
  record(input.telemetry.stats.appHealth).watchPlan = {
    projectState: 'observed',
    unavailableGroups: [
      { id: 'credential-dirs', state: 'registration-failed', reason: 'PRIVATE_REASON' },
      { id: 'PRIVATE_PATH', state: 'PRIVATE_STATE', reason: 'PRIVATE_REASON' },
      { id: 'project-dir', state: 'errored' },
    ],
  };
  const view = render(CoveragePanel, input);
  const groups = screen.getByRole('region', { name: 'Unavailable file watch groups' });
  expect(groups).toHaveTextContent('Credential directories');
  expect(groups).toHaveTextContent('Registration failed');
  expect(groups).toHaveTextContent('Other file watch group');
  expect(groups).toHaveTextContent('Unavailable');
  expect(groups).not.toHaveTextContent('Application directory');
  expect(within(groups).getAllByText(/Other file watch group/)).toHaveLength(2);
  expect(groups).not.toHaveTextContent('PRIVATE_');
  expect(screen.getByRole('region', { name: 'Project changes' })).toHaveTextContent('Observed');
  for (const flags of [{ stale: true }, { ready: false }, { error: 'offline' }]) {
    await view.rerender({ telemetry: { ...input.telemetry, ...flags } });
    expect(screen.queryByRole('region', { name: 'Unavailable file watch groups' })).toBeNull();
  }
  await view.rerender({
    telemetry: { ...input.telemetry, stats: { ...input.telemetry.stats, monitoringPaused: true } },
  });
  expect(screen.queryByRole('region', { name: 'Unavailable file watch groups' })).toBeNull();
  record(input.telemetry.stats.appHealth).watchPlan = {
    projectState: 'observed',
    unavailableGroups: [],
  };
  await view.rerender({ telemetry: structuredClone(input.telemetry) });
  expect(screen.queryByRole('region', { name: 'Unavailable file watch groups' })).toBeNull();
});

it('never shows retained project readiness as current for stale, not-ready or offline telemetry', async () => {
  const input = props();
  record(input.telemetry.stats.appHealth).watchPlan = { projectState: 'observed' };
  const view = render(CoveragePanel, input);
  const project = screen.getByRole('region', { name: 'Project changes' });
  expect(within(project).getByText('Observed', { exact: true })).toBeVisible();
  for (const flags of [{ stale: true }, { ready: false }, { error: 'PRIVATE_OFFLINE_REASON' }]) {
    await view.rerender({ telemetry: { ...input.telemetry, ...flags } });
    expect(within(project).getByText('Unknown', { exact: true })).toBeVisible();
    expect(project).toHaveTextContent('Current project change coverage is unknown.');
    expect(within(project).queryByText('Observed', { exact: true })).toBeNull();
    expect(project).not.toHaveTextContent('PRIVATE_OFFLINE_REASON');
  }
});

it('explains absent project coverage beside healthy sensors and opens only existing folder settings', async () => {
  const input = props();
  record(input.telemetry.stats.appHealth).watchPlan = {
    projectState: 'not-observed',
    state: 'HEALTHY',
  };
  const openProjectSettings = vi.fn();
  const view = render(CoveragePanel, { ...input, openProjectSettings });
  const project = screen.getByRole('region', { name: 'Project changes' });
  expect(project).toHaveTextContent('Not observed');
  expect(project).toHaveTextContent('Choose a project folder in Monitoring settings');
  await fireEvent.click(within(project).getByRole('button', { name: 'Project folder settings' }));
  expect(openProjectSettings).toHaveBeenCalledOnce();
  expect(input.navigate).not.toHaveBeenCalled();
  input.telemetry.stats.monitoringPaused = true;
  record(input.telemetry.stats.appHealth).watchPlan = { projectState: 'observed' };
  await view.rerender({ telemetry: structuredClone(input.telemetry) });
  expect(project).toHaveTextContent('Paused');
  expect(project).toHaveTextContent('Watcher readiness does not mean events are being collected');
});

it('shows current coverage while Overview is paused, including a later outage, and preserves the view pause on return', async () => {
  localStorage.setItem('aegis-advanced-mode', 'true');
  const callbacks = new Map<string, (value: unknown) => void>();
  const initial = coverageFixture();
  const host = new Proxy({} as Host, {
    get: (_, key) => {
      if (String(key).startsWith('on'))
        return (callback: (value: unknown) => void) => {
          callbacks.set(String(key), callback);
          return () => callbacks.delete(String(key));
        };
      return async () =>
        key === 'getStats'
          ? initial.stats
          : key === 'getFalsePositives'
            ? []
            : key === 'getSettings'
              ? { darkMode: true }
              : {};
    },
  });
  render(App, { host });
  await waitFor(() => expect(callbacks.has('onScanBatch')).toBe(true));
  callbacks.get('onScanBatch')?.(initial);
  await tick();
  await fireEvent.click(screen.getByRole('button', { name: 'Pause view' }));
  const current = coverageFixture();
  Object.assign(record(current.stats.nativeSensor), {
    lossCount: 29,
    providerState: 'FAILED',
    reason: 'binary-missing',
    phase: 'unavailable',
  });
  current.agents = [
    { ...current.agents[0], agent: 'Synthetic latest Codex', pid: 43, instanceId: '43:999' },
  ];
  callbacks.get('onScanBatch')?.(current);
  await tick();
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Coverage' }));
  const native = screen.getByRole('region', { name: 'Native platform sensor' });
  expect(within(native).getByText('Observed loss').nextElementSibling).toHaveTextContent('29');
  expect(native).toHaveTextContent('Failed');
  expect(native).toHaveTextContent('Sensor executable is missing');
  expect(screen.getByRole('region', { name: 'Per-agent coverage' })).toHaveTextContent(
    'Synthetic latest Codex',
  );
  Object.assign(record(current.stats.nativeSensor), { lossCount: 41 });
  record(current.stats.appHealth).populationReliable = false;
  callbacks.get('onStatsUpdate')?.(structuredClone(current.stats));
  await tick();
  expect(within(native).getByText('Observed loss').nextElementSibling).toHaveTextContent('41');
  expect(
    screen.getByText('Retained coverage readings. Current observation is unavailable.'),
  ).toHaveAttribute('role', 'status');
  await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
  expect(screen.getByRole('button', { name: 'Resume view' })).toBeVisible();
  const retained = screen.getByRole('complementary', { name: 'Observed agents' });
  expect(retained).toHaveTextContent('Synthetic Codex');
  expect(retained).not.toHaveTextContent('Synthetic latest Codex');
});

it('renders factory missing-binary and restart status labels in Portuguese', async () => {
  language.set('pt');
  const telemetry = coverageFixture();
  Object.assign(record(telemetry.stats.nativeSensor), {
    phase: 'unavailable',
    reason: 'binary-missing',
    providerState: 'FAILED',
    mode: null,
  });
  const view = render(CoveragePanel, { ...props(), telemetry });
  const native = screen.getByRole('region', { name: 'Sensor nativo da plataforma' });
  expect(native).toHaveTextContent('O executável do sensor está ausente');
  Object.assign(record(telemetry.stats.nativeSensor), {
    phase: 'waiting',
    reason: 'restart-pending',
  });
  await view.rerender({ telemetry: structuredClone(telemetry) });
  expect(native).toHaveTextContent('Aguardando reinicialização');
  expect(native).toHaveTextContent('Reinicialização agendada');
  Object.assign(record(telemetry.stats.nativeSensor), {
    phase: 'failed',
    reason: 'restart-exhausted',
  });
  await view.rerender({ telemetry: structuredClone(telemetry) });
  expect(native).toHaveTextContent('Limite de reinicializações atingido');
});

it('renders delivered counters and coverage loss while healthy provider never verifies blocking', async () => {
  const input = props();
  const view = render(CoveragePanel, input);
  const native = screen.getByRole('region', { name: 'Native platform sensor' });
  expect(native).toHaveTextContent('Healthy');
  expect(native).toHaveTextContent('Coverage lost');
  expect(native).toHaveTextContent('Linux process polling is a reduced mode.');
  expect(within(native).getByText('Accepted native events').nextElementSibling).toHaveTextContent(
    '0',
  );
  expect(within(native).getByText('Rejected native events').nextElementSibling).toHaveTextContent(
    '7',
  );
  expect(within(native).getByText('Last restart').nextElementSibling).toHaveTextContent(
    'Not reported',
  );
  const agent = screen.getByText('Synthetic Codex').closest('li')!;
  expect(agent).toHaveTextContent('OS identity reported');
  expect(within(agent).getByText('Blocking verified').nextElementSibling).toHaveTextContent(
    'Not reported',
  );
  await view.rerender({ telemetry: coverageFixture('darwin') });
  expect(native).toHaveTextContent('Native process identity is unavailable on macOS.');
  language.set('pt');
  await tick();
  expect(native).toHaveTextContent('Integridade do provedor');
  expect(native).toHaveTextContent('Identidade nativa do processo indisponível');
  await view.rerender({ telemetry: coverageFixture('windows') });
  expect(native).toHaveTextContent('O sensor nativo da plataforma está indisponível neste host.');
});

it('distinguishes loading, unavailable, stale and sanitized errors while links remain usable', async () => {
  const input = props();
  const view = render(CoveragePanel, { ...input, telemetry: emptyTelemetry() });
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for coverage data');
  expect(
    screen.getByText('Native sensor status has not been delivered by this runtime.'),
  ).toBeVisible();
  await view.rerender({ telemetry: { ...coverageFixture('windows'), stale: true } });
  expect(screen.getByRole('status')).toHaveTextContent('Retained coverage readings');
  expect(screen.getByRole('region', { name: 'Host observation sensors' })).toHaveTextContent(
    'Windows file events',
  );
  await view.rerender({ telemetry: { ...coverageFixture(), error: 'private-path-token' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Coverage could not be refreshed');
  expect(view.container).not.toHaveTextContent('private-path-token');
  const action = screen.getByRole('button', { name: 'Review action control' });
  action.focus();
  expect(action).toHaveFocus();
  await fireEvent.click(action);
  expect(input.navigate).toHaveBeenCalledWith('action-control');
  await fireEvent.click(screen.getByRole('button', { name: 'Sensor statistics' }));
  expect(input.openSensorDetails).toHaveBeenCalledOnce();
});

it('does not promote synthetic or absent identity into coverage, and preserves stamped rows', async () => {
  const telemetry = coverageFixture();
  const original = telemetry.agents[0];
  telemetry.agents = [
    original,
    { ...original },
    { ...original, pid: 0, instanceId: 'synthetic:0', instanceIdSource: 'synthetic' },
  ];
  const view = render(CoveragePanel, { ...props(), telemetry });
  const list = screen.getByRole('region', { name: 'Per-agent coverage' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(list).toHaveTextContent('OS identity not reported');
  const row = within(list).getAllByRole('listitem')[0];
  await view.rerender({ telemetry: { ...telemetry, agents: [{ ...original }] } });
  expect(within(list).getAllByRole('listitem')[0]).toBe(row);
});

it('wires Settings, sidebar coverage, health entry, action control and sensor statistics', async () => {
  localStorage.setItem('aegis-advanced-mode', 'true');
  const host = new Proxy({} as Host, {
    get: (_, key) => {
      if (String(key).startsWith('on')) return () => () => {};
      return async () =>
        key === 'getStats'
          ? coverageFixture().stats
          : key === 'getFalsePositives'
            ? []
            : key === 'getSettings'
              ? { darkMode: true }
              : {};
    },
  });
  const view = render(App, { host });
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Settings' }));
  await fireEvent.click(screen.getByRole('button', { name: 'View monitoring coverage' }));
  expect(screen.getByRole('heading', { name: 'Coverage', level: 1 })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Sensor statistics' }));
  expect(screen.getByRole('heading', { name: 'Statistics', level: 1 })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sensors' })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await fireEvent.click(view.container.querySelector('footer button')!);
  expect(screen.getByRole('heading', { name: 'Coverage', level: 1 })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Review action control' }));
  expect(screen.getByRole('heading', { name: 'Action control', level: 1 })).toBeVisible();
  await fireEvent.click(within(navigation).getByRole('button', { name: 'Coverage' }));
  expect(screen.getByRole('heading', { name: 'Coverage', level: 1 })).toBeVisible();
  await fireEvent.click(screen.getByRole('button', { name: 'Project folder settings' }));
  expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  expect(
    within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', {
      name: 'Monitoring',
    }),
  ).toHaveAttribute('aria-current', 'location');
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Monitoring', level: 2 })).toHaveFocus(),
  );
});
