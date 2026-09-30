import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFooterLayout } from '../../../frontend/observatory/runtime/footer-layout';

let footer: HTMLElement;
let width: number;
let resize: () => void;
let layout: ReturnType<typeof mountFooterLayout>;
beforeEach(() => {
  width = 200;
  footer = document.createElement('footer');
  footer.innerHTML = '<button>Observation</button><span>Observed now</span>';
  document.body.append(footer);
  let left = 0;
  Object.defineProperties(footer, {
    clientWidth: { get: () => 100 },
    scrollWidth: { get: () => width },
    scrollLeft: {
      get: () => left,
      set: (value: number) => {
        left = Math.max(0, Math.min(value, width - 100));
      },
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  layout = mountFooterLayout(footer);
});
afterEach(() => {
  layout.destroy();
  footer.remove();
  vi.unstubAllGlobals();
});
const arrow = (key: string) =>
  layout.scroll(new KeyboardEvent('keydown', { key, cancelable: true }));
const end = () => {
  for (let i = 0; i < 8; i++) arrow('ArrowRight');
};

describe('footer user intent during layout changes', () => {
  it('retains the keyboard end through deferred layout scroll events', () => {
    end();
    width = 350;
    footer.dispatchEvent(new Event('scroll'));
    resize();
    expect(footer.scrollLeft).toBe(250);
    footer.scrollLeft = 100;
    footer.dispatchEvent(new Event('scroll'));
    width = 400;
    resize();
    expect(footer.scrollLeft).toBe(300);
  });
  it('preserves a keyboard-selected mid-position after status growth', () => {
    end();
    arrow('ArrowLeft');
    width = 350;
    resize();
    expect(footer.scrollLeft).toBe(60);
  });
  it('preserves a pointer-selected mid-position after status growth', () => {
    end();
    footer.dispatchEvent(new Event('pointerdown'));
    footer.scrollLeft = 25;
    footer.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pointerup'));
    width = 350;
    resize();
    expect(footer.scrollLeft).toBe(25);
  });
  it('preserves a wheel-selected mid-position after status growth', () => {
    end();
    footer.dispatchEvent(new Event('wheel'));
    footer.scrollLeft = 25;
    footer.dispatchEvent(new Event('scroll'));
    width = 350;
    resize();
    expect(footer.scrollLeft).toBe(25);
  });
});
