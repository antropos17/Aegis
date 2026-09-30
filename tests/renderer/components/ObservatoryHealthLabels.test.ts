import { afterEach, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

it.each(['en', 'pt'] as const)('localizes changing sensor coverage in %s', async (locale) => {
  language.set(locale);
  const telemetry = emptyTelemetry();
  const { container, rerender } = render(Statistics, {
    telemetry: { ...telemetry, stats: { appHealth: { state: 'DEGRADED' } } },
    sectionRequest: { id: 'sensors', revision: 1 },
    inspect: () => {},
  });
  const coverage = () => container.querySelector('.coverage-line');
  for (const [state, en, pt] of [
    ['BOOTING', 'Starting AEGIS', 'Iniciando o AEGIS'],
    ['SENSORS_STARTING', 'Sensors starting', 'Sensores iniciando'],
    ['HEALTHY', 'Observation healthy', 'Observação saudável'],
    ['DEGRADED', 'Observation limited', 'Observação limitada'],
    ['FAILED', 'Observation unavailable', 'Observação indisponível'],
    ['UNKNOWN_FUTURE_STATE', 'Observation unknown', 'Observação desconhecida'],
    [undefined, 'Observation unknown', 'Observação desconhecida'],
  ]) {
    await rerender({ telemetry: { ...telemetry, stats: { appHealth: { state } } } });
    await waitFor(() => expect(coverage()).toHaveTextContent(locale === 'en' ? en! : pt!));
    if (state) expect(coverage()).not.toHaveTextContent(state);
  }
  language.set(locale === 'en' ? 'pt' : 'en');
  await waitFor(() =>
    expect(coverage()).toHaveTextContent(
      locale === 'en'
        ? 'Processo principal do AEGIS · Observação desconhecida'
        : 'AEGIS main process · Observation unknown',
    ),
  );
});
