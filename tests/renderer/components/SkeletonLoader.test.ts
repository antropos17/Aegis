/**
 * SkeletonLoader.test.ts — Smoke test for SkeletonLoader component.
 * Validates that Svelte 5 runes + jsdom transform pipeline works.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SkeletonLoader from '../../../src/renderer/lib/components/SkeletonLoader.svelte';

describe('SkeletonLoader', () => {
  it('renders with default props (3 lines, card style)', () => {
    const { container } = render(SkeletonLoader);

    const skeleton = container.querySelector('.skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass('skeleton--card');

    const lines = container.querySelectorAll('.skeleton__line');
    expect(lines).toHaveLength(3);
  });

  it('renders custom number of lines', () => {
    const { container } = render(SkeletonLoader, { props: { lines: 5 } });

    const lines = container.querySelectorAll('.skeleton__line');
    expect(lines).toHaveLength(5);
  });

  it('applies list style variant', () => {
    const { container } = render(SkeletonLoader, { props: { style: 'list' } });

    const skeleton = container.querySelector('.skeleton');
    expect(skeleton).toHaveClass('skeleton--list');
  });

  it('sets staggered animation-delay on each line', () => {
    const { container } = render(SkeletonLoader, { props: { lines: 3 } });

    const lines = container.querySelectorAll('.skeleton__line');
    expect(lines[0]).toHaveStyle('animation-delay: 0ms');
    expect(lines[1]).toHaveStyle('animation-delay: 100ms');
    expect(lines[2]).toHaveStyle('animation-delay: 200ms');
  });

  it('renders zero lines when lines=0', () => {
    const { container } = render(SkeletonLoader, { props: { lines: 0 } });

    const lines = container.querySelectorAll('.skeleton__line');
    expect(lines).toHaveLength(0);
  });
});
