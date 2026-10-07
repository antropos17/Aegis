import type { ActionReturn } from 'svelte/action';

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

function watchMotion(stop: () => void): () => void {
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
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
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
  };
}

function timing(
  node: HTMLElement,
  token: string,
  fallback: number,
): Parameters<HTMLElement['animate']>[1] {
  const style = getComputedStyle(node);
  const value = style.getPropertyValue(token).trim();
  const duration = /^\d*\.?\d+(ms|s)$/.test(value)
    ? Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
    : fallback;
  return {
    duration: Math.min(duration, 300),
    easing: style.getPropertyValue('--ease-enter').trim() || 'cubic-bezier(0, 0, 0.38, 0.9)',
  };
}

function animateSurface(
  node: HTMLElement,
  frames: Parameters<HTMLElement['animate']>[0],
  duration: string,
  fallback: number,
): Animation | undefined {
  if (!motionAllowed() || !node.isConnected || node.closest('[hidden], [inert]') || !node.animate)
    return;
  // Motion never delays or rejects an otherwise available workspace.
  try {
    return node.animate(frames, timing(node, duration, fallback));
  } catch {
    return;
  }
}

/** Keep workspace motion subordinate to navigation and input ownership.
 * @param node Retained workspace content surface
 * @returns Navigation reveal and disposal lifecycle
 * @since 0.19.2
 */
export function mountWorkspaceMotion(node: HTMLElement): {
  begin: () => () => void;
  destroy: () => void;
} {
  let animation: Animation | undefined;
  let revision = 0;
  let gestureRevision = 0;
  let pointerGesture = false;
  let disposed = false;
  const stop = (): void => {
    revision++;
    animation?.cancel();
    animation = undefined;
  };
  const click = (event: MouseEvent): void => {
    stop();
    pointerGesture = event.detail > 0 && event.button === 0;
    const gesture = ++gestureRevision;
    // Only synchronous navigation from this pointer click receives movement.
    queueMicrotask(() => {
      if (gesture === gestureRevision) pointerGesture = false;
    });
  };
  const keyboard = (): void => {
    pointerGesture = false;
    stop();
  };
  const stopWatching = watchMotion(stop);
  document.addEventListener('click', click, true);
  document.addEventListener('pointerdown', stop, true);
  document.addEventListener('keydown', keyboard, true);
  return {
    begin(): () => void {
      stop();
      const ticket = revision;
      const revealPointer = pointerGesture;
      return () => {
        if (disposed || ticket !== revision || !revealPointer) return;
        animation = animateSurface(
          node,
          [
            { opacity: 0.8, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          '--motion-enter',
          150,
        );
      };
    },
    destroy(): void {
      disposed = true;
      stop();
      stopWatching();
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('keydown', keyboard, true);
    },
  };
}

/** Reveal a changed entity without replaying on telemetry refresh. @param node Surface @param key Stable entity key @returns Svelte action lifecycle @since 0.14.1 */
export function reveal(node: HTMLElement, key: string): ActionReturn<string> {
  let previous: string | undefined;
  let animation: Animation | undefined;
  const stop = (): void => {
    animation?.cancel();
    animation = undefined;
  };
  const stopWatching = watchMotion(stop);
  const update = (next: string): void => {
    if (next === previous) return;
    previous = next;
    stop();
    animation = animateSurface(node, [{ opacity: 0 }, { opacity: 1 }], '--motion-fast', 110);
  };
  update(key);
  return {
    update,
    destroy(): void {
      stop();
      stopWatching();
    },
  };
}
