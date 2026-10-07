import type { ActionReturn } from 'svelte/action';
import { motionAllowed } from './motion';

/** Keep one quiet radar sweep at its current phase while observation or motion is unavailable. @param node Sweep surface @param active Reliable, unheld radar is selected @returns Scoped motion lifecycle @since 0.19.2 */
export function radarSweep(node: HTMLElement, active: boolean): ActionReturn<boolean> {
  let enabled = active;
  let animation: Animation | undefined;
  let destroyed = false;
  let failed = false;
  let inViewport = typeof IntersectionObserver === 'undefined';
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  const sync = (): void => {
    if (destroyed) return;
    const running =
      enabled &&
      !failed &&
      inViewport &&
      node.isConnected &&
      !node.closest('[hidden], [inert]') &&
      motionAllowed();
    if (running && typeof node.animate === 'function') {
      try {
        if (!animation) {
          // This 12-second rotation is an AEGIS visual adaptation, not a scan clock.
          animation = node.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
            {
              duration: 12000,
              iterations: Infinity,
              easing: 'linear',
            },
          );
          animation.pause();
          animation.currentTime = 0;
        }
        if (animation.playState !== 'running') animation.play();
        node.dataset.sweepState = 'running';
      } catch {
        // Cosmetic motion must never interrupt telemetry or process selection.
        animation?.cancel();
        animation = undefined;
        failed = true;
        node.dataset.sweepState = 'paused';
      }
    } else {
      if (animation && animation.playState !== 'paused') animation.pause();
      node.dataset.sweepState = 'paused';
    }
  };

  const visibility = new MutationObserver(sync);
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    visibility.observe(ancestor, {
      attributes: true,
      attributeFilter: ['hidden', 'inert', 'class', 'style', 'data-motion'],
    });
  }
  const intersection =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inViewport = entries.some((entry) => entry.target === node && entry.isIntersecting);
          sync();
        })
      : null;
  intersection?.observe(node);
  media?.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();

  return {
    update(next): void {
      enabled = next;
      sync();
    },
    destroy(): void {
      destroyed = true;
      animation?.cancel();
      visibility.disconnect();
      intersection?.disconnect();
      media?.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      delete node.dataset.sweepState;
    },
  };
}
