/**
 * TrustBadge.test.ts — Component tests for TrustBadge.svelte
 * Verifies rendering, props, conditional label, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TrustBadge from '../../../src/renderer/lib/components/TrustBadge.svelte';

describe('TrustBadge', () => {
  it('renders with default props (score only)', () => {
    const { container } = render(TrustBadge, { props: { score: 50 } });

    const badge = container.querySelector('.trust-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('trust-badge--md');
  });

  it('displays clamped score text', () => {
    render(TrustBadge, { props: { score: 42 } });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('42');
  });

  it('sets aria-label with score and risk label', () => {
    render(TrustBadge, { props: { score: 80 } });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Risk score 80: High Risk');
  });

  it('shows risk label when showLabel is true', () => {
    const { container } = render(TrustBadge, {
      props: { score: 20, showLabel: true },
    });

    const label = container.querySelector('.trust-badge__label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent('Low Risk');
  });

  it('hides risk label when showLabel is false (default)', () => {
    const { container } = render(TrustBadge, { props: { score: 20 } });

    const label = container.querySelector('.trust-badge__label');
    expect(label).not.toBeInTheDocument();
  });

  it('applies size class for sm variant', () => {
    const { container } = render(TrustBadge, {
      props: { score: 50, size: 'sm' },
    });

    const badge = container.querySelector('.trust-badge');
    expect(badge).toHaveClass('trust-badge--sm');
  });

  it('applies size class for lg variant', () => {
    const { container } = render(TrustBadge, {
      props: { score: 50, size: 'lg' },
    });

    const badge = container.querySelector('.trust-badge');
    expect(badge).toHaveClass('trust-badge--lg');
  });

  it('clamps score below 0 to 0', () => {
    render(TrustBadge, { props: { score: -10 } });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('0');
    expect(status).toHaveAttribute('aria-label', 'Risk score 0: Low Risk');
  });

  it('clamps score above 100 to 100', () => {
    render(TrustBadge, { props: { score: 150 } });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('100');
    expect(status).toHaveAttribute('aria-label', 'Risk score 100: High Risk');
  });

  it('shows correct risk levels at boundaries (34→low, 35→medium, 65→medium, 66→high)', () => {
    const { unmount: u1 } = render(TrustBadge, { props: { score: 34 } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Risk score 34: Low Risk');
    u1();

    const { unmount: u2 } = render(TrustBadge, { props: { score: 35 } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Risk score 35: Medium');
    u2();

    const { unmount: u3 } = render(TrustBadge, { props: { score: 65 } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Risk score 65: Medium');
    u3();

    render(TrustBadge, { props: { score: 66 } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Risk score 66: High Risk');
  });
});
