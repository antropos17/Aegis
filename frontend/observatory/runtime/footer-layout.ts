/** Keep footer clearance and user scroll intent across status and alert changes.
 * @param footer Mounted status footer.
 * @returns Keyboard handler and cleanup for this mounted footer.
 * @since 0.18.0
 */
export function mountFooterLayout(footer: HTMLElement): {
  scroll(event: KeyboardEvent): void;
  destroy(): void;
} {
  const style = document.documentElement.style;
  const property = '--observatory-footer-height';
  const previous = style.getPropertyValue(property);
  const priority = style.getPropertyPriority(property);
  let atEnd = false;
  let maximum = 0;
  let dragging = false;
  let wheel = false;
  let wheelFrame = 0;
  let alive = true;
  const extent = (): number => Math.max(0, footer.scrollWidth - footer.clientWidth);
  const remember = (): void => {
    const current = extent();
    if (current !== maximum) return;
    const end = current > 0 && footer.scrollLeft >= current - 1;
    // A layout-generated scroll must not demote an end anchor. Only explicit
    // input can select a mid-position; scroll events are delivered asynchronously.
    if (dragging || wheel || end) atEnd = end;
  };
  const resize = (): void => {
    if (!alive) return;
    maximum = extent();
    if (atEnd) footer.scrollLeft = maximum;
    style.setProperty(
      property,
      (window.innerWidth >= 800 ? footer.getBoundingClientRect().height : 0) + 'px',
    );
  };
  const pointerDown = (): void => {
    dragging = true;
  };
  const pointerEnd = (): void => {
    dragging = false;
  };
  const wheelStart = (): void => {
    wheel = true;
    atEnd = false;
    cancelAnimationFrame(wheelFrame);
    wheelFrame = requestAnimationFrame(() => {
      remember();
      wheel = false;
    });
  };
  footer.addEventListener('scroll', remember);
  footer.addEventListener('pointerdown', pointerDown);
  footer.addEventListener('wheel', wheelStart, { passive: true });
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  window.addEventListener('resize', resize);
  window.addEventListener('observatory-alert-lane-before-resize', remember);
  window.addEventListener('observatory-alert-lane-resize', resize);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(footer);
  for (const status of footer.children) observer?.observe(status);
  // Text updates can increase scroll extent before a resize callback is delivered.
  // Batch their DOM mutations independently of the next rendering frame.
  const mutations = new MutationObserver(resize);
  mutations.observe(footer, { childList: true, characterData: true, subtree: true });
  resize();
  return {
    scroll(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
        extent() === 0
      )
        return;
      event.preventDefault();
      footer.scrollLeft += event.key === 'ArrowRight' ? 40 : -40;
      maximum = extent();
      atEnd = footer.scrollLeft >= maximum - 1;
    },
    destroy(): void {
      alive = false;
      observer?.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(wheelFrame);
      footer.removeEventListener('scroll', remember);
      footer.removeEventListener('pointerdown', pointerDown);
      footer.removeEventListener('wheel', wheelStart);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('resize', resize);
      window.removeEventListener('observatory-alert-lane-before-resize', remember);
      window.removeEventListener('observatory-alert-lane-resize', resize);
      if (previous) style.setProperty(property, previous, priority);
      else style.removeProperty(property);
    },
  };
}
