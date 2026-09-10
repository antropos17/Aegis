/** Read the effective motion preference. @returns Whether visual motion is allowed @since 0.14.1 */
export function motionAllowed(): boolean {
  const root = document.documentElement;
  return (
    typeof matchMedia === 'function' &&
    root.dataset.motion !== 'reduce' &&
    !root.classList.contains('no-motion') &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    document.visibilityState !== 'hidden'
  );
}

/** Reveal a changed entity without replaying on telemetry refresh. @param node Surface @param key Stable entity key @returns Svelte action lifecycle @since 0.14.1 */
export function reveal(node: HTMLElement, key: string): ActionReturn<string> {
  let previous: string | undefined;
  let animation: Animation | undefined;
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const stop = (): void => animation?.cancel();
  const sync = (): void => {
    if (!motionAllowed()) stop();
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', 'class'],
  });
  media?.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  const update = (next: string): void => {
    if (next === previous) return;
    previous = next;
    stop();
    if (motionAllowed() && node.animate) {
      animation = node.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 120,
        easing: 'ease-out',
      });
    }
  };
  update(key);
  return {
    update,
    destroy(): void {
      stop();
      observer.disconnect();
      media?.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    },
  };
}

import type { ActionReturn } from 'svelte/action';
