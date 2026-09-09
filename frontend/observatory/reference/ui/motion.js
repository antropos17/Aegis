/* Keep live elements and the radar's scan phase stable through UI updates. */
(() => {
  const O = window.Obs;
  const key = (node) =>
    node.nodeType === 1
      ? node.id || (node.dataset.id ? `${node.dataset.action}:${node.dataset.id}` : '')
      : '';
  const same = (a, b) =>
    a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);

  function reconcile(parent, template) {
    let cursor = parent.firstChild;
    for (const fresh of [...template.childNodes]) {
      let current = cursor;
      if (key(fresh)) {
        current = [...parent.childNodes].find((node) => same(node, fresh));
      }
      if (!current || !same(current, fresh)) {
        parent.insertBefore(fresh.cloneNode(true), cursor);
        continue;
      }
      if (current !== cursor) parent.insertBefore(current, cursor);
      if (current.nodeType === 3) {
        if (current.data !== fresh.data) current.data = fresh.data;
      } else if (current.nodeType === 1) {
        for (const attr of [...current.attributes]) {
          const routeGeometry =
            current.closest?.('.radar-links') &&
            ((current.nodeName === 'path' && attr.name === 'd') ||
              (current.nodeName === 'animateMotion' && attr.name === 'path'));
          if (!fresh.hasAttribute(attr.name) && !routeGeometry) current.removeAttribute(attr.name);
        }
        for (const attr of fresh.attributes) {
          if (current.getAttribute(attr.name) !== attr.value)
            current.setAttribute(attr.name, attr.value);
        }
        reconcile(current, fresh);
      }
      cursor = current.nextSibling;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
  }

  // Targets contain delegated buttons/text, never forms with local draft state.
  O.patch = (element, html) => {
    if (!element) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    reconcile(element, template.content);
  };

  let elapsed = 0,
    updated = performance.now(),
    running = false;
  const seeded = new WeakSet();
  O.syncRadarClock = (frozen) => {
    const now = performance.now();
    if (running) elapsed += now - updated;
    const sweep = document.querySelector('.dial-sweep')?.getAnimations()[0];
    if (sweep && seeded.has(sweep) && sweep.currentTime !== null) elapsed = sweep.currentTime;
    updated = now;
    running = !frozen;
    document.querySelectorAll('.dial-sweep, .blip-dot').forEach((el) => {
      for (const animation of el.getAnimations({ subtree: true })) {
        if (!seeded.has(animation)) {
          animation.currentTime = elapsed;
          seeded.add(animation);
        }
      }
    });
    document.querySelectorAll('.radar-links').forEach((svg) => {
      if (!seeded.has(svg)) {
        svg.setCurrentTime?.(elapsed / 1000);
        seeded.add(svg);
      }
    });
  };

  O.alignRoutes = () => {
    const stage = document.querySelector('.radar-stage');
    const svg = stage?.querySelector('.radar-links');
    if (!svg) return;
    const bounds = stage.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    let changed = false;
    stage.querySelectorAll('.resource-node').forEach((resource, index) => {
      const dot = stage.querySelector(
        `.radar-blip[data-id="${index ? 'codex' : 'claude'}"] .blip-dot`,
      );
      const route = svg.querySelectorAll('g')[index];
      if (!route) return;
      route.style.display = dot ? '' : 'none';
      if (!dot) return;
      const a = dot.getBoundingClientRect(),
        b = resource.getBoundingClientRect();
      const x = a.left + a.width / 2 - bounds.left,
        y = a.top + a.height / 2 - bounds.top;
      const ex = b.left + b.width / 2 - bounds.left,
        ey = b.top + b.height / 2 - bounds.top;
      const path = `M${x} ${y} Q${(x + ex) / 2} ${y} ${ex} ${ey}`;
      route.querySelector('path').setAttribute('d', path);
      const motion = route.querySelector('animateMotion');
      if (motion.getAttribute('path') !== path) {
        motion.setAttribute('path', path);
        changed = true;
      }
    });
    // Retick SMIL after changing geometry, including while its clock is paused.
    // Otherwise Chromium can leave a particle painted at the SVG origin.
    if (changed) svg.setCurrentTime?.(svg.getCurrentTime?.() || 0);
    svg.dataset.routes = 'ready';
  };
  let observed;
  const resize = new ResizeObserver(O.alignRoutes);
  O.observeRadar = () => {
    const stage = document.querySelector('.radar-stage');
    if (stage !== observed) {
      resize.disconnect();
      observed = stage;
      if (stage) resize.observe(stage);
    }
    O.alignRoutes();
  };
})();

export {};
