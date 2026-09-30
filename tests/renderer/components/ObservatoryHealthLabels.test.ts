import { afterEach, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import Statistics from '../../../frontend/observatory/components/Statistics.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';
import { language } from '../../../frontend/observatory/runtime/i18n';

afterEach(() => language.set('en'));

it('localizes changing sensor coverage without displaying an internal health enum', async () => {
  language.set('pt');
  const telemetry = emptyTelemetry();
  const { container, rerender } = render(Statistics, {
    telemetry: { ...telemetry, stats: { appHealth: { state: 'DEGRADED' } } },
    sectionRequest: { id: 'sensors', revision: 1 },
    inspect: () => {},
  });
  const coverage = () => container.querySelector('.coverage-line');
  await waitFor(() =>
    expect(coverage()).toHaveTextContent('Processo principal do AEGIS · Observação limitada'),
  );
  await rerender({ telemetry: { ...telemetry, stats: { appHealth: { state: 'HEALTHY' } } } });
  await waitFor(() => expect(coverage()).toHaveTextContent('Observação saudável'));
  await rerender({
    telemetry: { ...telemetry, stats: { appHealth: { state: 'UNKNOWN_FUTURE_STATE' } } },
  });
  await waitFor(() => expect(coverage()).toHaveTextContent('Observação desconhecida'));
  expect(coverage()).not.toHaveTextContent('UNKNOWN_FUTURE_STATE');
});
