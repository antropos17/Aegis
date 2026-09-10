import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DetailSummary from '../../../frontend/observatory/components/DetailSummary.svelte';
import ObservationIdentity from '../../../frontend/observatory/components/ObservationIdentity.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

it('shows a network verification reason in the overview without navigating to attributes', () => {
  render(DetailSummary, {
    row: {
      remoteIp: '192.0.2.1',
      remotePort: 443,
      verdict: 'unknown',
      verdictReason: 'ptr-unconfirmed',
      agent: 'Codex',
      attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
    },
    telemetry: emptyTelemetry(),
  });
  expect(screen.getByText('Endpoint unverified')).toBeInTheDocument();
  expect(
    screen.getByText('The reverse-DNS name did not resolve back to this address.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('The operating system recorded the process owning this connection.'),
  ).toBeInTheDocument();
});

it('keeps row hints compact and exposes the recorded cause separately from resource context', () => {
  const { container } = render(ObservationIdentity, {
    row: {
      file: 'C:/Users/test/.codex/config.toml',
      agent: '',
      attribution: { status: 'unattributed', evidence: ['population-unavailable'] },
    },
  });
  expect(screen.getByText('Codex')).toBeInTheDocument();
  expect(screen.getByText('Resource context · actor not recorded')).toBeInTheDocument();
  expect(container.querySelector('.observation-identity')).toHaveAttribute(
    'title',
    'Process observation was unavailable when this event was recorded.',
  );
});
