/**
 * Sparkline.test.ts — Component tests for Sparkline.svelte
 * Verifies SVG rendering, props, area fill, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Sparkline from '../../../src/renderer/lib/components/Sparkline.svelte';

describe('Sparkline', () => {
  const sampleData = [10, 30, 20, 50, 40];

  it('renders an SVG with polyline for valid data', () => {
    const { container } = render(Sparkline, { props: { data: sampleData } });

    const svg = container.querySelector('svg.sparkline');
    expect(svg).toBeInTheDocument();

    const polyline = svg!.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    expect(polyline!.getAttribute('points')).toBeTruthy();
  });

  it('sets viewBox from width and height props', () => {
    const { container } = render(Sparkline, {
      props: { data: sampleData, width: 200, height: 50 },
    });

    const svg = container.querySelector('svg.sparkline');
    expect(svg).toHaveAttribute('viewBox', '0 0 200 50');
  });

  it('renders area polygon when showArea is true (default)', () => {
    const { container } = render(Sparkline, { props: { data: sampleData } });

    const polygon = container.querySelector('polygon');
    expect(polygon).toBeInTheDocument();

    const defs = container.querySelector('defs');
    expect(defs).toBeInTheDocument();
  });

  it('hides area polygon when showArea is false', () => {
    const { container } = render(Sparkline, {
      props: { data: sampleData, showArea: false },
    });

    const polygon = container.querySelector('polygon');
    expect(polygon).not.toBeInTheDocument();

    const defs = container.querySelector('defs');
    expect(defs).not.toBeInTheDocument();
  });

  it('applies custom stroke color and width', () => {
    const { container } = render(Sparkline, {
      props: { data: sampleData, color: 'red', strokeWidth: 3 },
    });

    const polyline = container.querySelector('polyline');
    expect(polyline).toHaveAttribute('stroke', 'red');
    expect(polyline).toHaveAttribute('stroke-width', '3');
  });

  it('renders nothing visible for data with fewer than 2 points', () => {
    const { container } = render(Sparkline, { props: { data: [42] } });

    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeInTheDocument();

    const polygon = container.querySelector('polygon');
    expect(polygon).not.toBeInTheDocument();
  });

  it('renders nothing visible for empty data array', () => {
    const { container } = render(Sparkline, { props: { data: [] } });

    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeInTheDocument();
  });

  it('handles flat data (all same values) without error', () => {
    const { container } = render(Sparkline, {
      props: { data: [5, 5, 5, 5] },
    });

    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    expect(polyline!.getAttribute('points')).toBeTruthy();
  });

  it('is aria-hidden (decorative element)', () => {
    const { container } = render(Sparkline, { props: { data: sampleData } });

    const svg = container.querySelector('svg.sparkline');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
