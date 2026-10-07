import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Radar from '../../../frontend/observatory/components/Radar.svelte';
import { emptyTelemetry } from '../../../frontend/observatory/runtime/host';

let reduced = false;
let failSweep = false;
let visibility: DocumentVisibilityState = 'visible';
let media: EventTarget;
let intersections: Array<{ callback: IntersectionObserverCallback; target?: Element }>;
let animations: Array<{
  playState: string;
  currentTime: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}>;
let animate: ReturnType<typeof vi.fn>;
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

function intersectionEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();
  return {
    target,
    isIntersecting,
    boundingClientRect: bounds,
    intersectionRect: bounds,
    rootBounds: null,
    intersectionRatio: isIntersecting ? 1 : 0,
    time: 0,
  };
}

beforeEach(() => {
  reduced = false;
  failSweep = false;
  visibility = 'visible';
  intersections = [];
  animations = [];
  media = new EventTarget();
  Object.defineProperty(media, 'matches', { get: () => reduced });
  vi.stubGlobal('matchMedia', () => media);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      entry: (typeof intersections)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback };
        intersections.push(this.entry);
      }
      observe(target: Element): void {
        this.entry.target = target;
        this.entry.callback(
          [intersectionEntry(target, true)],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect(): void {
        this.entry.target = undefined;
      }
    },
  );
  animate = vi.fn(function (this: Element) {
    if (failSweep && this.matches('.dial-sweep')) throw new Error('Animation unavailable');
    const animation = {
      playState: 'running',
      currentTime: 0,
      play: vi.fn(() => {
        animation.playState = 'running';
      }),
      pause: vi.fn(() => {
        animation.playState = 'paused';
      }),
      cancel: vi.fn(() => {
        animation.playState = 'idle';
      }),
    };
    if (this.matches('.dial-sweep')) animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true });
  document.documentElement.classList.remove('no-motion');
  document.documentElement.dataset.motion = 'full';
});

afterEach(() => {
  cleanup();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
  delete document.documentElement.dataset.motion;
  document.documentElement.classList.remove('no-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const reliable = () => ({ ...emptyTelemetry(), ready: true, stale: false });

it('freezes the same sweep phase for held, stale and unavailable observations without inventing scan activity', async () => {
  const state = reliable();
  const mounted = render(Radar, { telemetry: emptyTelemetry(), selected: null, inspect: vi.fn() });
  const sweep = mounted.container.querySelector('.dial-sweep') as HTMLElement;
  const coordinate = mounted.container.querySelector('.radar-coordinate') as HTMLElement;
  expect(animations).toHaveLength(0);
  expect(coordinate).toHaveTextContent('Waiting for a reliable scan');

  await mounted.rerender({ telemetry: state });
  expect(animations).toHaveLength(1);
  expect(sweep.dataset.sweepState).toBe('running');
  const animation = animations[0];
  animation.currentTime = 4137;
  await mounted.rerender({ paused: true });
  expect(animation.playState).toBe('paused');
  expect(coordinate).toHaveTextContent('Paused snapshot');
  await mounted.rerender({ paused: false, liveTelemetry: { ...state } });
  expect(animation.playState).toBe('paused');
  expect(animation.currentTime).toBe(4137);
  await mounted.rerender({ liveTelemetry: state, telemetry: { ...state, stale: true } });
  expect(animation.playState).toBe('paused');
  expect(coordinate).toHaveTextContent('Last reliable snapshot');
  await mounted.rerender({ telemetry: { ...state, ready: false } });
  expect(animation.playState).toBe('paused');
  expect(coordinate).toHaveTextContent('Waiting for a reliable scan');
  await mounted.rerender({ telemetry: state });
  expect(animation.playState).toBe('running');
  expect(animation.currentTime).toBe(4137);
  expect(animations).toHaveLength(1);
});

it('pauses on hidden workspaces, layers, windows and motion preferences, then disposes the animation and observers', async () => {
  const wrapper = document.createElement('div');
  document.body.append(wrapper);
  const mounted = render(Radar, {
    target: wrapper,
    props: { telemetry: reliable(), selected: null, inspect: vi.fn() },
  });
  const sweep = mounted.container.querySelector('.dial-sweep') as HTMLElement;
  const animation = animations[0];
  animation.currentTime = 2600;
  const unchanged = () => {
    expect(animation.playState).toBe('paused');
    expect(animation.currentTime).toBe(2600);
    expect(sweep.dataset.sweepState).toBe('paused');
  };
  wrapper.hidden = true;
  await Promise.resolve();
  unchanged();
  wrapper.hidden = false;
  await Promise.resolve();
  expect(animation.playState).toBe('running');
  wrapper.setAttribute('inert', '');
  await Promise.resolve();
  unchanged();
  wrapper.removeAttribute('inert');
  await Promise.resolve();
  await fireEvent.click(mounted.getByRole('button', { name: 'Files' }));
  unchanged();
  await fireEvent.click(mounted.getByRole('button', { name: 'Radar' }));
  expect(animation.playState).toBe('running');

  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  unchanged();
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  reduced = true;
  media.dispatchEvent(new Event('change'));
  unchanged();
  reduced = false;
  media.dispatchEvent(new Event('change'));
  document.documentElement.dataset.motion = 'reduce';
  await Promise.resolve();
  unchanged();
  document.documentElement.dataset.motion = 'full';
  document.documentElement.classList.add('no-motion');
  await Promise.resolve();
  unchanged();
  document.documentElement.classList.remove('no-motion');
  await Promise.resolve();
  intersections[0].callback([intersectionEntry(sweep, false)], {} as IntersectionObserver);
  unchanged();
  expect(animations).toHaveLength(1);

  mounted.unmount();
  expect(animation.cancel).toHaveBeenCalledTimes(1);
  expect(intersections[0].target).toBeUndefined();
  expect(sweep.dataset.sweepState).toBeUndefined();
  const plays = animation.play.mock.calls.length;
  media.dispatchEvent(new Event('change'));
  document.dispatchEvent(new Event('visibilitychange'));
  wrapper.hidden = true;
  await Promise.resolve();
  expect(animation.play.mock.calls).toHaveLength(plays);
  wrapper.remove();
});

it('keeps radar controls usable if the cosmetic animation API fails', async () => {
  failSweep = true;
  const mounted = render(Radar, { telemetry: reliable(), selected: null, inspect: vi.fn() });
  const sweep = mounted.container.querySelector('.dial-sweep') as HTMLElement;
  expect(sweep.dataset.sweepState).toBe('paused');
  await fireEvent.click(mounted.getByRole('button', { name: 'Files' }));
  await fireEvent.click(mounted.getByRole('button', { name: 'Radar' }));
  expect(sweep.dataset.sweepState).toBe('paused');
  expect(mounted.getByRole('button', { name: 'Clear radar selection' })).toBeVisible();
  expect(animations).toHaveLength(0);
});
