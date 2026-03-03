<script>
  import { events, network, falsePositives } from '../stores/ipc.js';
  import { addToast } from '../stores/toast.js';
  import { t } from '../i18n/index.js';

  let { active = true, agentFilter = 'all', severityFilter = 'all', typeFilter = 'all' } = $props();

  let feedEl = $state(null);
  let userScrolled = $state(false);
  let now = $state(Date.now());
  /** Track previous count so we know which items are "new" */
  let prevCount = $state(0);

  /** @type {any[][]} */
  let cachedEvents = $state([]);
  /** @type {any[]} */
  let cachedNetwork = $state([]);

  $effect(() => {
    if (!active) return;
    cachedEvents = $events;
  });

  $effect(() => {
    if (!active) return;
    cachedNetwork = $network;
  });

  $effect(() => {
    if (!active) return;
    const id = setInterval(() => {
      now = Date.now();
    }, 30000);
    return () => clearInterval(id);
  });

  function getSeverity(ev) {
    if (ev._type === 'network') return ev.flagged ? 'high' : 'low';
    if (ev._denied) return 'critical';
    if (ev.sensitive) return 'high';
    if (ev.action === 'deleted') return 'medium';
    return 'low';
  }

  /** Severity to fancy color variable */
  function sevColor(sev) {
    if (sev === 'critical') return 'var(--fancy-danger)';
    if (sev === 'high') return 'var(--fancy-warning)';
    if (sev === 'medium') return 'var(--fancy-info)';
    return 'var(--fancy-text-2)';
  }

  /** Severity to glow box-shadow */
  function sevGlow(sev) {
    if (sev === 'critical') return 'var(--fancy-danger-glow)';
    if (sev === 'high') return 'var(--fancy-warning-glow)';
    if (sev === 'medium') return 'var(--fancy-info-glow)';
    return 'none';
  }

  function badgeLabel(ev, sev) {
    if (sev === 'critical') return $t('activity.feed.severity.denied');
    if (ev.reason?.startsWith('AI agent config')) return $t('activity.feed.severity.config');
    if (ev.sensitive || sev === 'high') return $t('activity.feed.severity.sensitive');
    if (sev === 'medium') return $t('activity.feed.severity.deleted');
    return '';
  }

  function badgeClass(sev) {
    if (sev === 'critical') return 'badge-danger';
    if (sev === 'high') return 'badge-warning';
    if (sev === 'medium') return 'badge-info';
    return '';
  }

  /** @param {number} ts */
  function formatRelativeTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const diff = now - ts;
    if (diff < 60000) return `${h}:${m}:${s}`;
    if (diff < 3600000) return `${h}:${m}:${s}`;
    if (diff < 86400000) return `${h}:${m}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}`;
  }

  function shortenPath(p) {
    if (!p) return '';
    if (p.length <= 50) return p;
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 3) return p;
    return '\u2026/' + parts.slice(-3).join('/');
  }

  async function markFalsePositive(ev, e) {
    e.stopPropagation();
    const entry = { agentName: ev.agent, pattern: ev.file, timestamp: Date.now() };
    if (window.aegis?.addFalsePositive) {
      await window.aegis.addFalsePositive(entry);
      falsePositives.update((arr) => [...arr, entry]);
      addToast(
        'Marked as false positive. Future similar events will have reduced risk.',
        'success',
      );
    }
  }

  function handlePathClick(ev, e) {
    e.stopPropagation();
    if (ev._type === 'network') {
      navigator.clipboard.writeText(ev.file);
    } else if (ev.file && window.aegis?.revealInExplorer) {
      window.aegis.revealInExplorer(ev.file);
    }
  }

  let unified = $derived.by(() => {
    const fileEvs = cachedEvents.flat().map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = cachedNetwork.map((conn) => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      file: `${conn.domain || conn.remoteIp || '?'}:${conn.remotePort || '?'}`,
      action: conn.state || 'established',
      sensitive: !!conn.flagged,
      reason: conn.flagged ? 'Unknown domain' : '',
      flagged: !!conn.flagged,
      _type: 'network',
      userAgent: conn.userAgent || null,
      httpUnencrypted: !!conn.httpUnencrypted,
    }));
    return [...fileEvs, ...netEvs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });

  let filtered = $derived.by(() => {
    let result = unified;
    if (agentFilter !== 'all') {
      result = result.filter((ev) => ev.agent === agentFilter);
    }
    if (severityFilter !== 'all') {
      result = result.filter((ev) => getSeverity(ev) === severityFilter);
    }
    if (typeFilter !== 'all') {
      result = result.filter((ev) => ev._type === typeFilter);
    }
    return result.slice(0, 200);
  });

  /** Track new items count for animation (items at top of list are newest) */
  let newItemCount = $derived.by(() => {
    const count = filtered.length;
    const diff = count - prevCount;
    return diff > 0 ? diff : 0;
  });

  /** Update prevCount after render to reset animation state */
  $effect(() => {
    const len = filtered.length;
    /** Debounce: batch rapid arrivals with a small delay */
    const id = setTimeout(() => {
      prevCount = len;
    }, 300);
    return () => clearTimeout(id);
  });

  function onFeedScroll() {
    if (!feedEl) return;
    const { scrollTop, clientHeight, scrollHeight } = feedEl;
    userScrolled = scrollTop + clientHeight < scrollHeight - 50;
  }

  /** Snap to bottom and re-enable auto-scroll */
  function followFeed() {
    userScrolled = false;
    if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
  }

  $effect(() => {
    // eslint-disable-next-line no-unused-vars -- tracks filtered changes to trigger autoscroll
    const _len = filtered.length;
    if (feedEl && !userScrolled) {
      feedEl.scrollTop = feedEl.scrollHeight;
    }
  });
</script>

<div class="feed-wrap">
  {#if userScrolled}
    <button class="follow-btn" onclick={followFeed}>Follow</button>
  {/if}

  <div class="feed-scroll" bind:this={feedEl} onscroll={onFeedScroll}>
    {#if filtered.length === 0}
      <div class="feed-empty">{$t('activity.feed.no_events')}</div>
    {:else}
      {#each filtered as ev, i (`${ev.timestamp}-${ev.agent}-${i}`)}
        {@const sev = getSeverity(ev)}
        {@const label = badgeLabel(ev, sev)}
        {@const isNew = i < newItemCount}
        <div
          class="feed-entry"
          class:odd={i % 2 === 1}
          class:sev-critical={sev === 'critical'}
          class:sev-high={sev === 'high'}
          class:sev-medium={sev === 'medium'}
          class:feed-enter={isNew}
        >
          <span class="sev-bar" style:background={sevColor(sev)}></span>
          <span class="feed-dot" style:background={sevColor(sev)} style:box-shadow={sevGlow(sev)}
          ></span>
          <span class="feed-time">{formatRelativeTime(ev.timestamp)}</span>
          <span class="feed-agent" title={ev.userAgent ? `Process: ${ev.userAgent}` : ''}
            >{ev.agent}</span
          >
          <span class="feed-action">{ev.action || ev._type}</span>
          <button class="feed-path" title={ev.file} onclick={(e) => handlePathClick(ev, e)}
            >{shortenPath(ev.file)}</button
          >
          {#if ev._type === 'file' && ev.file}
            <button
              class="feed-reveal"
              title="Open file location"
              onclick={(e) => {
                e.stopPropagation();
                window.aegis?.revealInExplorer(ev.file);
              }}>&#128193;</button
            >
          {/if}
          {#if ev.repeatCount > 1}
            <span class="feed-repeat">&times;{ev.repeatCount}</span>
          {/if}
          {#if label}
            <span class="feed-badge {badgeClass(sev)}">{label}</span>
          {/if}
          {#if ev.httpUnencrypted}
            <span class="feed-badge badge-danger">HTTP</span>
          {/if}
          {#if ev.sensitive || ev.flagged}
            <button
              class="fp-btn"
              title="Mark as false positive"
              onclick={(e) => markFalsePositive(ev, e)}>FP</button
            >
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .feed-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .follow-btn {
    position: absolute;
    right: var(--aegis-space-8);
    top: var(--aegis-space-3);
    padding: var(--aegis-space-2) var(--aegis-space-6);
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    border: none;
    border-radius: var(--md-sys-shape-corner-small);
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    cursor: pointer;
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: opacity 0.2s ease;
  }

  .follow-btn:hover {
    opacity: 0.9;
  }

  .feed-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .feed-empty {
    padding: calc(40px * var(--aegis-ui-scale)) var(--aegis-space-9);
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  /* ── Slide-in animation (GPU-only: transform + opacity) ── */
  @keyframes feed-slide-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .feed-enter {
    animation: feed-slide-in var(--fancy-transition-normal) var(--fancy-ease) both;
  }

  .feed-entry {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-2) var(--aegis-space-6);
    padding-left: calc(var(--aegis-space-6) + 3px);
    font-size: calc(11px * var(--aegis-ui-scale));
    font-family: var(--fancy-font-body);
    transition: background var(--fancy-transition-micro) var(--fancy-ease);
  }

  .feed-entry.odd {
    background: var(--md-sys-color-surface-container-low);
  }

  .feed-entry:hover {
    background: var(--fancy-surface-hover);
  }

  /* ── Severity left bar indicator ── */
  .sev-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 0 2px 2px 0;
    opacity: 0;
    transition: opacity var(--fancy-transition-micro) var(--fancy-ease);
  }

  .feed-entry.sev-critical .sev-bar,
  .feed-entry.sev-high .sev-bar,
  .feed-entry.sev-medium .sev-bar {
    opacity: 1;
  }

  .feed-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: box-shadow var(--fancy-transition-micro) var(--fancy-ease);
  }

  .feed-time {
    font-family: var(--fancy-font-mono);
    color: var(--fancy-text-2);
    flex-shrink: 0;
    width: var(--aegis-col-time);
  }

  .feed-agent {
    font-family: var(--fancy-font-body);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    flex-shrink: 0;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-action {
    font-family: var(--fancy-font-body);
    color: var(--fancy-text-2);
    flex-shrink: 0;
    width: var(--aegis-col-action);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-path {
    font-family: var(--fancy-font-mono);
    color: var(--md-sys-color-on-surface);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
    cursor: pointer;
    text-align: left;
    transition: color var(--fancy-transition-micro) var(--fancy-ease);
  }

  .feed-path:hover {
    text-decoration: underline;
    color: var(--md-sys-color-primary);
  }

  /* ── Severity badge colors (fancy palette) ── */
  .feed-badge {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    letter-spacing: 0.5px;
    padding: var(--aegis-space-1) var(--aegis-space-3);
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
  }

  .badge-danger {
    background: var(--fancy-danger-bg);
    color: var(--fancy-danger);
  }

  .badge-warning {
    background: var(--fancy-warning-bg);
    color: var(--fancy-warning);
  }

  .badge-info {
    background: var(--fancy-info-bg);
    color: var(--fancy-info);
  }

  .feed-reveal {
    background: none;
    border: none;
    padding: 0 var(--aegis-space-1);
    cursor: pointer;
    font-size: calc(12px * var(--aegis-ui-scale));
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--fancy-transition-micro) var(--fancy-ease);
  }
  .feed-entry:hover .feed-reveal {
    opacity: 0.7;
  }
  .feed-reveal:hover {
    opacity: 1;
  }

  .feed-repeat {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    color: var(--fancy-text-2);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .fp-btn {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    padding: var(--aegis-space-1) var(--aegis-space-3);
    border-radius: var(--md-sys-shape-corner-full);
    border: 1px solid var(--fancy-border);
    background: transparent;
    color: var(--fancy-text-2);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity var(--fancy-transition-micro) var(--fancy-ease),
      background var(--fancy-transition-micro) var(--fancy-ease);
  }
  .feed-entry:hover .fp-btn {
    opacity: 0.7;
  }
  .fp-btn:hover {
    opacity: 1;
    background: var(--md-sys-color-surface-container);
  }
</style>
