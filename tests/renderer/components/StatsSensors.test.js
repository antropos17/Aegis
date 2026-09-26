import { afterEach, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatsSensors from '../../../frontend/observatory/components/StatsSensors.svelte';
import { language } from '../../../frontend/observatory/runtime/i18n';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

afterEach(() => language.set('en'));

function telemetry(health) {
  return { ...emptyTelemetry(), stats: { appHealth: health } };
}

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
