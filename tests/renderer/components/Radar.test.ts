/**
 * Radar.test.ts — Radar dot colours are the risk BANDS, not letter trust grades (F-W10).
 *
 * The defect this pins: Radar coloured a dot from `getTrustGrade` while TrustBadge /
 * RiskIndex / SummaryCards coloured from `getRiskInfo` bands, so score 60 (grade D,
 * band medium) drew a red dot beside an amber badge. Both sides are asserted against
 * ONE table here, so neither can drift alone — put grade-based colouring back into
 * Radar and the disagreement scores (35, 60, 65) go red/green against amber.
 *
 * Radar paints to a canvas, so the test drives the real component with a recording
 * 2D context and a stubbed `getComputedStyle`, and reads back the colour actually
 * filled for each dot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Radar from '../../../src/renderer/lib/components/Radar.svelte';
import TrustBadge from '../../../src/renderer/lib/components/TrustBadge.svelte';
import { getRiskInfo } from '../../../src/renderer/lib/utils/trust-badge-utils';
import { getTrustGrade } from '../../../src/renderer/lib/utils/risk-scoring.js';

/** Resolved token stubs — distinct strings so a wrong band is unmistakable. */
const GREEN = 'TOKEN-tertiary-green';
const AMBER = 'TOKEN-secondary-amber';
const RED = 'TOKEN-error-red';

/** The one band table both renderers are measured against. */
const CASES = [
  { score: 0, band: 'low', colour: GREEN, badgeLabel: 'Low Risk' },
  { score: 34, band: 'low', colour: GREEN, badgeLabel: 'Low Risk' },
  { score: 35, band: 'medium', colour: AMBER, badgeLabel: 'Medium' },
  { score: 60, band: 'medium', colour: AMBER, badgeLabel: 'Medium' },
  { score: 65, band: 'medium', colour: AMBER, badgeLabel: 'Medium' },
  { score: 66, band: 'high', colour: RED, badgeLabel: 'High Risk' },
  { score: 100, band: 'high', colour: RED, badgeLabel: 'High Risk' },
] as const;

/**
 * What a grade-based `dotColor` would have painted — the pre-fix mapping
 * (A+/A/B+/B → tertiary, C → secondary, everything else → error).
 */
function legacyGradeColour(score: number): string {
  const grade = getTrustGrade(score);
  if (['A+', 'A', 'B+', 'B'].includes(grade)) return GREEN;
  if (grade === 'C') return AMBER;
  return RED;
}

const { AGENTS } = vi.hoisted(() => ({
  AGENTS: [
    { name: 'agent-000', riskScore: 0, trustGrade: 'A+' },
    { name: 'agent-034', riskScore: 34, trustGrade: 'B+' },
    { name: 'agent-035', riskScore: 35, trustGrade: 'B' },
    { name: 'agent-060', riskScore: 60, trustGrade: 'D' },
    { name: 'agent-065', riskScore: 65, trustGrade: 'D' },
    { name: 'agent-066', riskScore: 66, trustGrade: 'D' },
    { name: 'agent-100', riskScore: 100, trustGrade: 'F' },
  ],
}));

vi.mock('../../../src/renderer/lib/stores/risk.js', async () => {
  const { readable } = await import('svelte/store');
  return { enrichedAgents: readable(AGENTS) };
});

/** Custom-property values Radar reads through `getComputedStyle`. */
const TOKEN_MAP: Record<string, string> = {
  '--md-sys-color-tertiary': GREEN,
  '--md-sys-color-secondary': AMBER,
  '--md-sys-color-error': RED,
  '--radar-sweep-rgb': '1, 2, 3',
  '--radar-line-rgb': '4, 5, 6',
  '--radar-label-rgb': '7, 8, 9',
};

const BAND_COLOURS = new Set<string>([GREEN, AMBER, RED]);

interface FakeGradient {
  addColorStop(offset: number, colour: string): void;
}

/** Minimal 2D context that records the fillStyle in force at each `fill()`. */
class RecordingContext {
  fillStyle: string | FakeGradient = '';
  strokeStyle = '';
  lineWidth = 0;
  shadowColor = '';
  shadowBlur = 0;
  font = '';
  textAlign = '';
  textBaseline = '';
  readonly fills: (string | FakeGradient)[] = [];

  setTransform(): void {}
  clearRect(): void {}
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  clip(): void {}
  stroke(): void {}
  fillText(): void {}

  fill(): void {
    this.fills.push(this.fillStyle);
  }

  createConicGradient(): FakeGradient {
    return { addColorStop: () => {} };
  }

  createLinearGradient(): FakeGradient {
    return { addColorStop: () => {} };
  }
}

let ctx: RecordingContext;
let rafQueue: FrameRequestCallback[];

/** Run the next `n` queued animation frames. */
function flushFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (cb) cb(0);
  }
}

/** Colours Radar actually filled for dots, in dot order. */
function dotColours(): string[] {
  return ctx.fills.filter((f): f is string => typeof f === 'string' && BAND_COLOURS.has(f));
}

beforeEach(() => {
  ctx = new RecordingContext();
  rafQueue = [];

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (prop: string) => TOKEN_MAP[prop] ?? '',
  }));

  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 400,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight');
});

/** Mount Radar and paint one frame. */
function paintRadar(): void {
  render(Radar);
  flushSync();
  // Radar queues token resolution first, then the render loop.
  expect(rafQueue.length).toBe(2);
  flushFrames(2);
}

describe('Radar dot colours — one band taxonomy with TrustBadge (F-W10)', () => {
  it('paints one dot per agent', () => {
    paintRadar();
    expect(dotColours()).toHaveLength(CASES.length);
  });

  it('colours every dot from the risk band: low green, medium amber, high red', () => {
    paintRadar();
    expect(dotColours()).toEqual(CASES.map((c) => c.colour));
  });

  it('classifies each boundary score into the band the table names', () => {
    for (const c of CASES) {
      expect(getRiskInfo(c.score).level).toBe(c.band);
    }
  });

  it('gives TrustBadge the same band as the Radar dot at every boundary', () => {
    paintRadar();
    const radar = dotColours();

    CASES.forEach((c, i) => {
      const { unmount } = render(TrustBadge, { props: { score: c.score } });
      const badge = document.querySelector('.trust-badge');
      expect(badge).not.toBeNull();
      expect(badge?.getAttribute('aria-label')).toBe(`Risk score ${c.score}: ${c.badgeLabel}`);
      expect(getRiskInfo(c.score).level).toBe(c.band);
      expect(radar[i]).toBe(c.colour);
      unmount();
    });
  });

  it('does NOT colour from the letter trust grade — 35, 60 and 65 would differ', () => {
    paintRadar();
    const radar = dotColours();

    const disagree = CASES.map((c, i) => ({ ...c, i })).filter(
      (c) => legacyGradeColour(c.score) !== c.colour,
    );
    // 35 → grade B (green), 60 and 65 → grade D (red); all three are band medium.
    expect(disagree.map((c) => c.score)).toEqual([35, 60, 65]);

    for (const c of disagree) {
      expect(radar[c.i]).toBe(AMBER);
      expect(radar[c.i]).not.toBe(legacyGradeColour(c.score));
    }
  });
});
