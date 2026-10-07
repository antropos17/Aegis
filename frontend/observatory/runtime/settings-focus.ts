/** Keep focused settings above sticky controls as their measured heights change.
 * @param node Mounted settings workspace
 * @returns Observer and listener cleanup
 * @since 0.19.0
 */
export function revealSettingsFocus(node: HTMLElement): { destroy: () => void } {
  const main = node.closest('main');
  const bar = node.querySelector<HTMLElement>('.settings-save');
  if (!main || !bar) return { destroy(): void {} };
  const previous = main.style.getPropertyValue('scroll-padding-bottom');
  let applied = '';
  let frame = 0;
  let observedNotifications: Element | null = null;

  function reveal(): void {
    const field = document.activeElement;
    if (
      !(field instanceof HTMLElement) ||
      !node.contains(field) ||
      field.closest('.settings-save, .section-tabs, .section-navigation')
    )
      return;
    const bounds = field.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const viewport = main!.getBoundingClientRect();
    const head = main!.querySelector('.page-head')?.getBoundingClientRect();
    const tabs = node.querySelector('.section-tabs')?.getBoundingClientRect();
    const top = Math.max(viewport.top, head?.bottom ?? viewport.top, tabs?.bottom ?? viewport.top);
    let bottom = Math.min(viewport.bottom, bar!.getBoundingClientRect().top);
    const notifications = node.ownerDocument
      .querySelector('.notifications')
      ?.getBoundingClientRect();
    if (
      notifications?.height &&
      bounds.right > notifications.left &&
      bounds.left < notifications.right &&
      notifications.bottom > top
    )
      bottom = Math.min(bottom, notifications.top);
    const gap = 8;
    // A tab panel can be taller than the viewport; reveal its beginning.
    if (bounds.height > bottom - top - gap * 2) main!.scrollTop += bounds.top - top - gap;
    else if (bounds.bottom > bottom - gap) main!.scrollTop += bounds.bottom - bottom + gap;
    else if (bounds.top < top + gap) main!.scrollTop -= top - bounds.top + gap;
  }

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const notifications = node.ownerDocument.querySelector('.notifications');
      if (observer && notifications !== observedNotifications) {
        if (observedNotifications) observer.unobserve(observedNotifications);
        observedNotifications = notifications;
        if (notifications) observer.observe(notifications);
      }
      const height = bar!.getBoundingClientRect().height;
      applied = height ? height + 16 + 'px' : previous;
      if (applied) main!.style.setProperty('scroll-padding-bottom', applied);
      else main!.style.removeProperty('scroll-padding-bottom');
      reveal();
    });
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(bar);
  observer?.observe(node);
  node.addEventListener('focusin', schedule);
  schedule();
  return {
    destroy(): void {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      node.removeEventListener('focusin', schedule);
      if (main.style.getPropertyValue('scroll-padding-bottom') === applied) {
        if (previous) main.style.setProperty('scroll-padding-bottom', previous);
        else main.style.removeProperty('scroll-padding-bottom');
      }
    },
  };
}
