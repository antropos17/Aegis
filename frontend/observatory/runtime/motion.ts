let active: ViewTransition | null = null;
let revision = 0;
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
      animation = node.animate(
        [
          { opacity: 0, translate: '0 12px' },
          { opacity: 1, translate: '0 0' },
        ],
        { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
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

/** Run the template's interruptible snapshot transition. @param surface Named surface @param update DOM update @param direction Navigation direction @returns Update completion @since 0.14.1 */
export async function transitionSurface(
  surface: 'workspace' | 'detail' | 'analysis',
  update: () => Promise<void>,
  direction = 1,
): Promise<void> {
  const ticket = ++revision;
  active?.skipTransition();
  const root = document.documentElement;
  if (!document.startViewTransition || !motionAllowed()) {
    await update();
    return;
  }
  root.dataset.transitionSurface = surface;
  root.style.setProperty('--travel', direction < 0 ? '-18px' : '18px');
  const next = document.startViewTransition(async () => {
    if (ticket === revision) await update();
  });
  // Superseding a transition rejects readiness; the DOM update still has its own result.
  void next.ready.catch(() => {});
  active = next;
  void next.finished
    .catch(() => {})
    .finally(() => {
      if (active === next) {
        active = null;
        delete root.dataset.transitionSurface;
      }
    });
  await next.updateCallbackDone;
}
import type { ActionReturn } from 'svelte/action';
