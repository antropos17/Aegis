(() => {
  const O = window.Obs;
  const labels = Object.fromEntries(
    [...document.querySelectorAll('.nav[data-view]')].map((el) => [
      el.dataset.view,
      el.getAttribute('aria-label'),
    ]),
  );
  const sectionIcons = Object.fromEntries(
    [...document.querySelectorAll('.nav[data-view]')].map((el) => [
      el.dataset.view,
      el.querySelector('[data-icon]')?.dataset.icon,
    ]),
  );
  const backIcon =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
  const forwardIcon =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>';
  const arrows = (prefix) =>
    `<div class="history-controls" aria-label="${prefix === 'detail' ? 'Detail' : 'View'} history"><button class="icon-button history-arrow" data-action="${prefix}-back" aria-label="Back" title="Back · Alt+Left" disabled>${backIcon}</button><button class="icon-button history-arrow" data-action="${prefix}-forward" aria-label="Forward" title="Forward · Alt+Right" disabled>${forwardIcon}</button></div>`;
  const bar = document.createElement('div');
  bar.className = 'workspace-navigation';
  bar.innerHTML = `${arrows('view')}<div class="workspace-tabs" role="tablist" aria-label="Open sections"></div>`;
  document.querySelector('.topbar').after(bar);
  const tablist = bar.querySelector('[role=tablist]');
  const content = O.$('content');
  const main = O.$('main'),
    pageHead = main.querySelector('.page-head');
  // Reserve the actual sticky-header height when keyboard focus scrolls a control into view.
  new ResizeObserver(() => {
    main.style.setProperty('--page-head-height', `${pageHead.offsetHeight}px`);
  }).observe(pageHead);
  main.addEventListener('focusin', (event) => {
    if (
      !content.contains(event.target) ||
      event.target.closest('.analysis-config-body, .analysis-body') ||
      getComputedStyle(pageHead).position !== 'sticky'
    )
      return;
    const top = event.target.getBoundingClientRect().top;
    const visibleTop = pageHead.getBoundingClientRect().bottom + 12;
    if (top < visibleTop) main.scrollBy({ top: top - visibleTop, behavior: 'instant' });
  });
  content.setAttribute('role', 'tabpanel');
  const opened = [O.view];
  const visits = [O.view];
  const saved = new Map();
  const tabAnimations = new WeakMap();
  let position = 0,
    requestedView = O.view;
  const navigate = O.navigate;

  function remember() {
    saved.set(O.view, {
      main: O.$('main').scrollTop,
      window: window.scrollY,
      filters: [...content.querySelectorAll('.filterbar input[id], .filterbar select[id]')].map(
        (el) => ({ id: el.id, value: el.value, checked: el.checked }),
      ),
    });
  }
  function restore(view) {
    const state = saved.get(view);
    if (!state) return;
    for (const field of state.filters) {
      const el = O.$(field.id);
      if (!el || !content.contains(el)) continue;
      if (el.value === field.value && el.checked === field.checked) continue;
      el.value = field.value;
      if (el.type === 'checkbox') el.checked = field.checked;
      el.dispatchEvent(
        new Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', {
          bubbles: true,
        }),
      );
    }
    O.$('main').scrollTop = state.main;
    window.scrollTo({ top: state.window, behavior: 'instant' });
  }
  const sideNav = document.querySelector('.sidebar nav');
  function revealActiveNav(animate = false) {
    const active = sideNav?.querySelector('.nav[aria-current="page"]');
    if (!active) return;
    const bounds = sideNav.getBoundingClientRect(),
      item = active.getBoundingClientRect();
    const delta =
      item.top < bounds.top + 4
        ? item.top - bounds.top - 4
        : item.bottom > bounds.bottom - 4
          ? item.bottom - bounds.bottom + 4
          : 0;
    if (Math.abs(delta) > 1)
      sideNav.scrollBy({
        top: delta,
        behavior: animate && O.motionEnabled() ? 'smooth' : 'instant',
      });
  }
  if (sideNav) new ResizeObserver(() => revealActiveNav()).observe(sideNav);
  function draw() {
    revealActiveNav(true);
    const previous = new Map(
      [...tablist.children].map((el) => [el, el.getBoundingClientRect().left]),
    );
    for (const el of tablist.children) tabAnimations.get(el)?.cancel();
    // Reuse tab buttons so focus and hover do not jump on navigation.
    for (const view of opened) {
      let item = [...tablist.children].find((el) => el.dataset.tab === view);
      if (!item) {
        item = document.createElement('div');
        item.className = 'workspace-tab';
        item.dataset.tab = view;
        item.innerHTML = `<button role="tab" id="workspace-tab-${view}" aria-controls="content" title="${O.escape(labels[view])}" data-view="${view}">${O.icon(sectionIcons[view])}<span class="workspace-tab-label">${O.escape(labels[view])}</span></button>${view === 'overview' ? '' : `<button class="tab-close" data-action="close-tab" data-id="${view}" aria-label="Close ${O.escape(labels[view])}" title="Close ${O.escape(labels[view])}">${O.icon('close')}</button>`}`;
        tablist.append(item);
      }
      const active = view === O.view;
      item.classList.toggle('active', active);
      item.querySelector('[role=tab]').setAttribute('aria-selected', String(active));
      item.querySelector('[role=tab]').tabIndex = active ? 0 : -1;
    }
    for (const item of [...tablist.children]) if (!opened.includes(item.dataset.tab)) item.remove();
    content.setAttribute('aria-labelledby', `workspace-tab-${O.view}`);
    bar.querySelector('[data-action=view-back]').disabled = position === 0;
    bar.querySelector('[data-action=view-forward]').disabled = position === visits.length - 1;
    const active = document.getElementById(`workspace-tab-${O.view}`);
    const left = active.parentElement.offsetLeft,
      right = left + active.parentElement.offsetWidth;
    const scrollTarget =
      left < tablist.scrollLeft
        ? left
        : right > tablist.scrollLeft + tablist.clientWidth
          ? right - tablist.clientWidth
          : tablist.scrollLeft;
    tablist.scrollTo({
      left: scrollTarget,
      behavior: O.motionEnabled() ? 'smooth' : 'instant',
    });
    if (O.motionEnabled())
      for (const el of tablist.children) {
        const old = previous.get(el);
        if (old === undefined) continue;
        const delta = old - el.getBoundingClientRect().left;
        if (Math.abs(delta) < 1) continue;
        const animation = el.animate(
          [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
        tabAnimations.set(el, animation);
        animation.finished.catch(() => {});
      }
  }
  O.navigate = (view, historyIndex = null) => {
    if (!labels[view] || view === requestedView) return Promise.resolve(false);
    const direction =
      historyIndex !== null
        ? Math.sign(historyIndex - position) || 1
        : Math.sign(Object.keys(labels).indexOf(view) - Object.keys(labels).indexOf(O.view)) || 1;
    requestedView = view;
    return O.transition(
      () => {
        if (view === O.view) {
          draw();
          return;
        }
        remember();
        O.$('main').classList.add('has-navigated');
        navigate(view);
        if (!opened.includes(view)) opened.push(view);
        if (historyIndex === null) {
          visits.splice(position + 1);
          visits.push(view);
          if (visits.length > 80) visits.shift();
          position = visits.length - 1;
        } else position = historyIndex;
        restore(view);
        draw();
      },
      'workspace',
      direction,
    ).then((applied) => {
      if (!applied && requestedView === view) requestedView = O.view;
      return applied;
    });
  };
  function move(direction) {
    const next = position + direction;
    if (next < 0 || next >= visits.length) return;
    return O.navigate(visits[next], next);
  }
  O.actions['view-back'] = () => move(-1);
  O.actions['view-forward'] = () => move(1);
  O.actions['close-tab'] = (el) => {
    const view = el.dataset.id,
      index = opened.indexOf(view);
    if (view === 'overview' || index < 0) return;
    opened.splice(index, 1);
    const finish = () => {
      draw();
      document.getElementById(`workspace-tab-${O.view}`)?.focus({ preventScroll: true });
    };
    if (view === O.view) O.navigate(opened[Math.min(index, opened.length - 1)]).then(finish);
    else finish();
  };
  tablist.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tab = e.target.closest('[role=tab]');
    if (!tab) return;
    const index = opened.indexOf(tab.dataset.view);
    let target;
    if (e.key === 'ArrowRight') target = opened[(index + 1) % opened.length];
    if (e.key === 'ArrowLeft') target = opened[(index + opened.length - 1) % opened.length];
    if (e.key === 'Home') target = opened[0];
    if (e.key === 'End') target = opened.at(-1);
    if (e.key === 'Delete' && tab.dataset.view !== 'overview') {
      e.preventDefault();
      O.actions['close-tab']({ dataset: { id: tab.dataset.view } });
    }
    if (target) {
      e.preventDefault();
      O.navigate(target).then(() => {
        if (O.view === target)
          document.getElementById(`workspace-tab-${target}`)?.focus({ preventScroll: true });
      });
    }
  });

  // Detail history restores rendered content; it never replays the action that opened it.
  const dialog = O.$('modal'),
    showModal = O.modal;
  const detailNav = document.createElement('div');
  detailNav.className = 'detail-navigation';
  detailNav.innerHTML = arrows('detail');
  dialog.querySelector('.modal-head').prepend(detailNav);
  let details = [],
    detailPosition = -1,
    restoring = false,
    closing = null;
  function drawDetails() {
    detailNav.querySelector('[data-action=detail-back]').disabled = detailPosition <= 0;
    detailNav.querySelector('[data-action=detail-forward]').disabled =
      detailPosition >= details.length - 1;
  }
  const renderModal = (...args) => {
    const [title, body, actions = ''] = args;
    const editable =
      /<(?:input|textarea|form|select)\b/i.test(body) || /data-action="confirm"/.test(actions);
    if (!restoring) {
      if (!dialog.open || editable) {
        details = [];
        detailPosition = -1;
      }
      if (!editable) {
        if (details[detailPosition]) details[detailPosition].scroll = O.$('modal-body').scrollTop;
        const current = details[detailPosition];
        if (current && current.args[0] === title && current.args[1] === body) {
          current.args = args;
          details.splice(detailPosition + 1);
        } else {
          details.splice(detailPosition + 1);
          details.push({ args, scroll: 0 });
          if (details.length > 30) details.shift();
          detailPosition = details.length - 1;
        }
      }
    }
    showModal(...args);
    drawDetails();
  };
  O.modal = (...args) => {
    closing?.cancel();
    closing = null;
    return O.transition(() => renderModal(...args), 'detail');
  };
  function detailMove(direction) {
    const next = detailPosition + direction;
    if (next < 0 || next >= details.length) return;
    return O.transition(
      () => {
        details[detailPosition].scroll = O.$('modal-body').scrollTop;
        detailPosition = next;
        restoring = true;
        try {
          renderModal(...details[next].args);
        } finally {
          restoring = false;
        }
        O.$('modal-body').scrollTop = details[next].scroll;
        O.$('modal-title').tabIndex = -1;
        O.$('modal-title').focus({ preventScroll: true });
      },
      'detail',
      direction,
    );
  }
  O.actions['close-modal'] = () => {
    O.cancelTransition();
    if (!dialog.open) return;
    if (!O.motionEnabled()) {
      dialog.close();
      return;
    }
    closing?.cancel();
    const animation = dialog.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(4px)' },
      ],
      { duration: 100, easing: 'ease-out' },
    );
    closing = animation;
    animation.finished.then(
      () => {
        if (closing === animation) {
          closing = null;
          dialog.close();
        }
      },
      () => {},
    );
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    O.actions['close-modal']();
  });
  O.actions['detail-back'] = () => detailMove(-1);
  O.actions['detail-forward'] = () => detailMove(1);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    details = [];
    detailPosition = -1;
    drawDetails();
  });
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key) || O.$('commands').open) return;
    e.preventDefault();
    const direction = e.key === 'ArrowLeft' ? -1 : 1;
    if (dialog.open) detailMove(direction);
    else move(direction);
  });
  draw();
  drawDetails();
})();

export {};
