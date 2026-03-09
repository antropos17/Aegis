/**
 * RiskRing.test.ts — Component tests for RiskRing.svelte
 * Verifies ARIA meter, score display, label, danger class, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RiskRing from '../../../src/renderer/lib/components/RiskRing.svelte';

describe('RiskRing', () => {
  it('renders with role="meter" and correct ARIA attributes', () => {
    render(RiskRing, { props: { score: 45 } });

    const meter = screen.getByRole('meter');
    expect(meter).toBeInTheDocument();
    expect(meter).toHaveAttribute('aria-valuenow', '45');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-label', 'System risk: 45%');
  });

  it('displays clamped score in center text', () => {
    const { container } = render(RiskRing, { props: { score: 72 } });

    const scoreEl = container.querySelector('.ring-score');
    expect(scoreEl).toBeInTheDocument();
    expect(scoreEl).toHaveTextContent('72');
  });

  it('shows risk label by default', () => {
    const { container } = render(RiskRing, { props: { score: 30 } });

    const label = container.querySelector('.ring-label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent('Low Risk');
  });

  it('hides risk label when showLabel is false', () => {
    const { container } = render(RiskRing, {
      props: { score: 30, showLabel: false },
    });

    const label = container.querySelector('.ring-label');
    expect(label).not.toBeInTheDocument();
  });

  it('applies is-danger class when score >= 66', () => {
    const { container } = render(RiskRing, { props: { score: 66 } });

    const ring = container.querySelector('.risk-ring');
    expect(ring).toHaveClass('is-danger');
  });

  it('does not apply is-danger class when score < 66', () => {
    const { container } = render(RiskRing, { props: { score: 65 } });

    const ring = container.querySelector('.risk-ring');
    expect(ring).not.toHaveClass('is-danger');
  });

  it('renders SVG with two circles (track + arc)', () => {
    const { container } = render(RiskRing, { props: { score: 50 } });

    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);

    const track = container.querySelector('.ring-track');
    expect(track).toBeInTheDocument();

    const arc = container.querySelector('.ring-arc');
    expect(arc).toBeInTheDocument();
  });

  it('applies custom size to inline style', () => {
    const { container } = render(RiskRing, {
      props: { score: 50, size: 120 },
    });

    const ring = container.querySelector('.risk-ring');
    expect(ring).toHaveStyle('width: 120px');
    expect(ring).toHaveStyle('height: 120px');
  });

  it('clamps score below 0', () => {
    render(RiskRing, { props: { score: -5 } });

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(meter).toHaveAttribute('aria-label', 'System risk: 0%');
  });

  it('clamps score above 100', () => {
    render(RiskRing, { props: { score: 200 } });

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-label', 'System risk: 100%');
  });
});
