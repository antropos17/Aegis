import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountWorkspaceMotion, reveal } from '../../../frontend/observatory/runtime/motion';

let media: EventTarget & { matches: boolean };
let visibility: DocumentVisibilityState;
let surface: HTMLDivElement;
let animate: ReturnType<typeof vi.fn>;
let cancels: ReturnType<typeof vi.fn>[];
const disposers: (() => void)[] = [];

beforeEach(() => {
  media = Object.assign(new EventTarget(), { matches: false });
  visibility = 'visible';
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  document.documentElement.dataset.motion = 'full';
  document.documentElement.classList.remove('no-motion');
  surface = document.createElement('div');
  document.body.append(surface);
  cancels = [];
  animate = vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel };
  });
  Object.defineProperty(surface, 'animate', { configurable: true, value: animate });
});

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  surface.remove();
  delete document.documentElement.dataset.motion;
  document.documentElement.classList.remove('no-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const motion = mountWorkspaceMotion(surface);
  disposers.push(motion.destroy);
  return motion;
}

function pointerNavigation(motion: ReturnType<typeof mountWorkspaceMotion>): () => void {
  let enter = () => {};
  surface.addEventListener('click', () => (enter = motion.begin()), { once: true });
  surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, button: 0 }));
  return enter;
}

it('reveals pointer navigation with short shared motion without touching drafts, scroll or focus', () => {
  const input = document.createElement('input');
  input.value = 'unsaved policy';
  surface.append(input);
  surface.scrollTop = 72;
  input.focus();
  surface.style.setProperty('--motion-enter', '0.15s');
  surface.style.setProperty('--ease-enter', 'cubic-bezier(0, 0, 0.38, 0.9)');
  const enter = pointerNavigation(mount());
  expect(animate).not.toHaveBeenCalled();
  enter();
  expect(animate).toHaveBeenCalledOnce();
  const [frames, timing] = animate.mock.calls[0];
  expect(timing).toMatchObject({ duration: 150, easing: 'cubic-bezier(0, 0, 0.38, 0.9)' });
  expect(frames).toEqual([
    { opacity: 0.8, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ]);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('unsaved policy');
  expect(surface.scrollTop).toBe(72);
  expect(surface.style.opacity).toBe('');
  expect(surface.style.transform).toBe('');
});

it('keeps keyboard, assistive clicks and later programmatic navigation immediate', async () => {
  const motion = mount();
  motion.begin()();
  surface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  motion.begin()();
  pointerNavigation(motion);
  await Promise.resolve();
  motion.begin()();
  expect(animate).not.toHaveBeenCalled();
});

it('cancels the previous reveal and rejects stale navigation commits during rapid switching', () => {
  const motion = mount();
  pointerNavigation(motion)();
  const stale = pointerNavigation(motion);
  const latest = pointerNavigation(motion);
  expect(cancels[0]).toHaveBeenCalledOnce();
  stale();
  expect(animate).toHaveBeenCalledOnce();
  latest();
  expect(animate).toHaveBeenCalledTimes(2);
});

it.each(['keydown', 'pointerdown'])(
  'cancels a pending reveal when %s starts another interaction',
  (type) => {
    const motion = mount();
    const enter = pointerNavigation(motion);
    document.dispatchEvent(new Event(type, { bubbles: true }));
    enter();
    expect(animate).not.toHaveBeenCalled();
    pointerNavigation(motion)();
    document.dispatchEvent(new Event(type, { bubbles: true }));
    expect(cancels[0]).toHaveBeenCalledOnce();
  },
);

it.each(['preference', 'animations'])(
  'cancels active motion when app %s changes, without replay on restore',
  async (kind) => {
    const motion = mount();
    pointerNavigation(motion)();
    if (kind === 'preference') document.documentElement.dataset.motion = 'reduce';
    else document.documentElement.classList.add('no-motion');
    await Promise.resolve();
    expect(cancels[0]).toHaveBeenCalledOnce();
    pointerNavigation(motion)();
    expect(animate).toHaveBeenCalledOnce();
    document.documentElement.dataset.motion = 'full';
    document.documentElement.classList.remove('no-motion');
    await Promise.resolve();
    expect(animate).toHaveBeenCalledOnce();
  },
);

it.each(['system', 'visibility'])(
  'stops on %s reduction and never replays a stale reveal on recovery',
  (kind) => {
    const motion = mount();
    pointerNavigation(motion)();
    const enter = pointerNavigation(motion);
    if (kind === 'system') {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    } else {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    }
    expect(cancels[0]).toHaveBeenCalledOnce();
    media.matches = false;
    visibility = 'visible';
    media.dispatchEvent(new Event('change'));
    document.dispatchEvent(new Event('visibilitychange'));
    enter();
    expect(animate).toHaveBeenCalledOnce();
  },
);

it('disposes animations and listeners without allowing pending or later navigation to replay', () => {
  const motion = mount();
  pointerNavigation(motion)();
  const enter = pointerNavigation(motion);
  motion.destroy();
  enter();
  pointerNavigation(motion)();
  expect(cancels[0]).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledOnce();
});

it.each(['hidden', 'inert', 'detached', 'unsupported', 'failed'])(
  'keeps %s surfaces available without attempting unsafe motion',
  (kind) => {
    const motion = mount();
    const enter = pointerNavigation(motion);
    if (kind === 'hidden') surface.hidden = true;
    if (kind === 'inert') surface.setAttribute('inert', '');
    if (kind === 'detached') surface.remove();
    if (kind === 'unsupported') Object.defineProperty(surface, 'animate', { value: undefined });
    if (kind === 'failed')
      animate.mockImplementation(() => {
        throw new Error('Unsupported motion');
      });
    expect(enter).not.toThrow();
    if (kind !== 'failed') expect(animate).not.toHaveBeenCalled();
    expect(surface.style.opacity).toBe('');
    expect(surface.style.transform).toBe('');
  },
);

it('keeps entity reveals keyed to identity and suppresses hidden telemetry updates', () => {
  const action = reveal(surface, 'process-a');
  disposers.push(() => action.destroy?.());
  expect(animate).toHaveBeenCalledOnce();
  action.update?.('process-a');
  expect(animate).toHaveBeenCalledOnce();
  surface.hidden = true;
  action.update?.('process-b');
  expect(cancels[0]).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledOnce();
  surface.hidden = false;
  action.update?.('process-b');
  expect(animate).toHaveBeenCalledOnce();
  action.update?.('process-c');
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.lastCall?.[1].duration).toBe(110);
});
