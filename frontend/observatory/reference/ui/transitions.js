/* One interruptible transition, with no timers delaying navigation or replaying actions. */
(() => {
  const O = window.Obs;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let current = null,
    generation = 0;
  const fallbacks = new Set();
  const animate = O.animate;
  O.animate = (el) => {
    if (!O.transitionUpdating) animate(el);
  };
  O.cancelTransition = () => {
    ++generation;
    current?.skipTransition();
    for (const animation of fallbacks) animation.cancel();
  };
  O.motionEnabled = () => O.settings.motion && !reduced.matches;
  O.transition = (update, surface = 'workspace', direction = 1) => {
    const ticket = ++generation;
    current?.skipTransition();
    for (const animation of fallbacks) animation.cancel();
    fallbacks.clear();
    if (!O.motionEnabled()) {
      update();
      return Promise.resolve(true);
    }
    document.documentElement.dataset.transitionSurface = surface;
    document.documentElement.style.setProperty('--travel', `${direction * 10}px`);
    if (!document.startViewTransition) {
      update();
      const element = O.$(
        surface === 'detail' ? 'modal-body' : surface === 'analysis' ? 'analysis-body' : 'content',
      );
      if (element) {
        const animation = element.animate(
          [
            { opacity: 0.35, transform: `translateX(${direction * 10}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
        fallbacks.add(animation);
        animation.finished.catch(() => {}).finally(() => fallbacks.delete(animation));
      }
      return Promise.resolve(true);
    }
    let applied = false;
    const transition = document.startViewTransition(() => {
      if (ticket !== generation) return;
      O.transitionUpdating = true;
      try {
        update();
        applied = true;
      } finally {
        O.transitionUpdating = false;
      }
    });
    current = transition;
    transition.ready.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (current === transition) {
          current = null;
          delete document.documentElement.dataset.transitionSurface;
        }
      });
    return transition.updateCallbackDone.then(() => applied);
  };
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      current?.skipTransition();
      for (const animation of fallbacks) animation.cancel();
    }
  });
})();

export {};
