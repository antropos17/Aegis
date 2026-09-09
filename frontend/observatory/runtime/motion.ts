let active: ViewTransition | null = null;
let revision = 0;
/** Run the template's interruptible snapshot transition. @param surface Named surface @param update DOM update @param direction Navigation direction @returns Update completion @since 0.14.1 */
export async function transitionSurface(
  surface: 'workspace' | 'detail' | 'analysis',
  update: () => Promise<void>,
  direction = 1,
): Promise<void> {
  const ticket = ++revision;
  active?.skipTransition();
  const root = document.documentElement;
  if (
    !document.startViewTransition ||
    root.dataset.motion === 'reduce' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.visibilityState === 'hidden'
  ) {
    await update();
    return;
  }
  root.dataset.transitionSurface = surface;
  root.style.setProperty('--travel', direction < 0 ? '-10px' : '10px');
  const next = document.startViewTransition(async () => {
    if (ticket === revision) await update();
  });
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
