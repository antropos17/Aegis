import { afterEach, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsSensors from '../../../frontend/observatory/components/StatsSensors.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

afterEach(() => language.set('en'));

function telemetry(health, scanCadence, wslInventory) {
  return { ...emptyTelemetry(), stats: { appHealth: health, scanCadence, wslInventory } };
}

it('shows process-scan overruns separately from observed event loss', async () => {
  const health = {
    state: 'HEALTHY',
    sensors: { byId: { process: { state: 'HEALTHY', lossCount: 0 } } },
  };
  const mounted = render(StatsSensors, {
    telemetry: telemetry(health, { skippedProcessTicks: 0, lastSkippedAt: null }),
  });
  expect(screen.queryByText(/Process scan intervals skipped/)).toBeNull();

  await mounted.rerender({
    telemetry: telemetry(health, { skippedProcessTicks: 2, lastSkippedAt: 1000 }),
  });
  const process = screen.getByRole('heading', { name: 'Agent processes' }).closest('article');
  expect(process).toHaveTextContent('Healthy');
  expect(process).toHaveTextContent('Observed loss');
  expect(process).toHaveTextContent('Process scan intervals skipped in this app session: 2.');
  expect(process).toHaveTextContent('Agent changes may have appeared late during those overruns.');

  language.set('pt');
  await tick();
  expect(process).toHaveTextContent(
    'Intervalos de varredura de processos ignorados nesta sessão do aplicativo: 2',
  );
});

it('separates sensor identity, purpose, status and diagnostic details', async () => {
  const mounted = render(StatsSensors, {
    telemetry: telemetry({
      state: 'HEALTHY',
      sensors: {
        byId: {
          'fs-chokidar': { state: 'HEALTHY', lastSuccessAt: 1000, lossCount: 0 },
          'fs-handle': { state: 'UNSUPPORTED', detail: 'rm-owns-observation' },
        },
      },
    }),
  });
  const cards = mounted.container.querySelectorAll('.sensor-grid article');
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByRole('heading', { name: 'File changes' })).toBeVisible();
  expect(cards[0]).toHaveTextContent('Watches configured folders for file activity.');
  expect(cards[0].querySelector('.sensor-icon svg')).toBeInTheDocument();
  expect(within(cards[1]).getByRole('heading', { name: 'Open files' })).toBeVisible();
  expect(cards[1]).toHaveTextContent('Covered elsewhere');
  expect(cards[1]).toHaveTextContent('Resource Manager is handling this observation.');
  language.set('pt');
  await tick();
  expect(within(cards[0]).getByRole('heading', { name: 'Alterações de arquivos' })).toBeVisible();
});

it('identifies a failed credential watch group while other watch roots remain live', () => {
  const secret = 'C:/Users/example/.ssh/id_private: access denied';
  render(StatsSensors, {
    telemetry: telemetry({
      state: 'DEGRADED',
      sensors: {
        byId: { 'fs-chokidar': { state: 'DEGRADED', detail: 'watch-roots-unavailable' } },
      },
      watchPlan: {
        state: 'DEGRADED',
        liveWatcherCount: 2,
        unavailableGroups: [
          { id: 'credential-dirs', state: 'registration-failed', reason: secret },
          { id: 'C:/private/unknown', state: 'C:/private/state', reason: secret },
        ],
      },
    }),
  });

  const coverage = screen.getByRole('region', { name: 'Unavailable file watch groups' });
  expect(within(coverage).getByText('Credential directories')).toBeVisible();
  expect(within(coverage).getByText('Registration failed')).toBeVisible();
  expect(within(coverage).getByText('Other file watch group')).toBeVisible();
  expect(within(coverage).getByText('Unavailable')).toBeVisible();
  expect(coverage).toHaveTextContent('File activity may be missed in these groups.');
  expect(coverage).not.toHaveTextContent(secret);
  expect(coverage).not.toHaveTextContent('C:/private/unknown');
  expect(coverage).not.toHaveTextContent('C:/private/state');
});

it('stays quiet before a failure and translates the bounded coverage state', async () => {
  const mounted = render(StatsSensors, { telemetry: telemetry({ state: 'STARTING' }) });
  expect(screen.queryByRole('region', { name: 'Unavailable file watch groups' })).toBeNull();

  await mounted.rerender({
    telemetry: telemetry({
      state: 'HEALTHY',
      watchPlan: { state: 'HEALTHY', unavailableGroups: [] },
    }),
  });
  expect(screen.queryByRole('region', { name: 'Unavailable file watch groups' })).toBeNull();

  language.set('pt');
  await tick();
  await mounted.rerender({
    telemetry: telemetry({
      state: 'DEGRADED',
      watchPlan: {
        state: 'DEGRADED',
        unavailableGroups: [{ id: 'env-files', state: 'errored', reason: '/private/.env' }],
      },
    }),
  });
  const coverage = screen.getByRole('region', {
    name: 'Grupos de observação de arquivos indisponíveis',
  });
  expect(within(coverage).getByText('Arquivos de ambiente na pasta pessoal')).toBeVisible();
  expect(within(coverage).getByText('Erro no observador')).toBeVisible();
  expect(coverage).not.toHaveTextContent('/private/.env');
});

it('shows passive WSL inventory without implying guest-process coverage', async () => {
  const observedAt = Date.now();
  const health = {
    state: 'HEALTHY',
    sensors: {
      byId: {
        wsl: { state: 'UNSUPPORTED', detail: 'wsl-process-coverage-unavailable' },
      },
    },
  };
  const mounted = render(StatsSensors, {
    telemetry: telemetry(health, undefined, {
      status: 'ready',
      observedAt,
      stale: false,
      distributions: ['Ubuntu', 'Debian'],
    }),
  });
  const inventory = screen.getByRole('region', { name: 'Running WSL distributions' });
  expect(inventory).toHaveTextContent('Host-side inventory only.');
  expect(within(inventory).getByText('Ubuntu')).toBeVisible();
  expect(within(inventory).getByText('Debian')).toBeVisible();
  const process = screen.getByRole('heading', { name: 'WSL guest processes' }).closest('article');
  expect(process).toHaveTextContent('Not inspected');
  expect(process).toHaveTextContent('Automatic guest-process checks are off');
  expect(process).not.toHaveTextContent('Healthy');

  await mounted.rerender({
    telemetry: telemetry(health, undefined, {
      status: 'unavailable',
      reason: 'timeout',
      observedAt,
      stale: true,
      distributions: ['Ubuntu'],
    }),
  });
  expect(inventory).toHaveTextContent('Retained');
  expect(within(inventory).getByText('Ubuntu')).toBeVisible();
  expect(inventory).not.toHaveTextContent('No running WSL distributions observed.');

  await mounted.rerender({
    telemetry: telemetry(health, undefined, {
      status: 'ready',
      observedAt: Date.now(),
      stale: false,
      distributions: [],
    }),
  });
  expect(inventory).toHaveTextContent('No running WSL distributions observed.');
  expect(inventory).not.toHaveTextContent('Ubuntu');

  language.set('pt');
  await tick();
  expect(screen.getByRole('region', { name: 'Distribuições WSL em execução' })).toHaveTextContent(
    'Nenhuma distribuição WSL em execução foi observada.',
  );
});

it('bounds untrusted WSL names and renders text without creating markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const longValid = 'A'.repeat(129);
  const mounted = render(StatsSensors, {
    telemetry: telemetry({ state: 'STARTING' }, undefined, {
      status: 'ready',
      observedAt: Date.now(),
      distributions: [evil, evil, '', longValid, 'A'.repeat(257), 'bad\u0000name'],
    }),
  });
  const inventory = screen.getByRole('region', { name: 'Running WSL distributions' });
  expect(within(inventory).getAllByText(evil)).toHaveLength(1);
  expect(inventory.querySelector('img')).toBeNull();
  expect(inventory).not.toHaveTextContent('bad');
  expect(inventory).toHaveTextContent(longValid);
  expect(inventory).not.toHaveTextContent('A'.repeat(257));
  expect(mounted.container.querySelector('script')).toBeNull();
});

it('distinguishes unobserved, expired and malformed WSL inventory from a fresh empty result', async () => {
  const mounted = render(StatsSensors, {
    telemetry: telemetry({ state: 'STARTING' }, undefined, {
      status: 'pending',
      observedAt: null,
      stale: true,
      distributions: [],
    }),
  });
  const inventory = screen.getByRole('region', { name: 'Running WSL distributions' });
  expect(inventory).toHaveTextContent('Pending');
  expect(inventory).not.toHaveTextContent('Retained');

  await mounted.rerender({
    telemetry: telemetry({ state: 'STARTING' }, undefined, {
      status: 'unavailable',
      observedAt: null,
      stale: true,
      distributions: [],
    }),
  });
  expect(inventory).toHaveTextContent('Unavailable');
  expect(inventory).not.toHaveTextContent('Retained');

  await mounted.rerender({
    telemetry: telemetry({ state: 'STARTING' }, undefined, {
      status: 'ready',
      observedAt: Date.now() - 90000,
      stale: false,
      distributions: ['Ubuntu'],
    }),
  });
  expect(inventory).toHaveTextContent('Retained');
  expect(inventory).toHaveTextContent('Ubuntu');

  await mounted.rerender({
    telemetry: telemetry({ state: 'STARTING' }, undefined, {
      status: 'ready',
      observedAt: Date.now(),
      stale: false,
      distributions: ['bad\u0000name'],
    }),
  });
  expect(inventory).toHaveTextContent('Running WSL state is unknown.');
  expect(inventory).not.toHaveTextContent('No running WSL distributions observed.');
});
