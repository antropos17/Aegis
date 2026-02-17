<script>
  import { events, network } from '../stores/ipc.js';

  let { agentFilter = 'all', severityFilter = 'all', typeFilter = 'all' } = $props();

  function getSeverity(ev) {
    if (ev._type === 'network') return ev.flagged ? 'high' : 'low';
    if (ev._denied) return 'critical';
    if (ev.sensitive) return 'high';
    if (ev.action === 'deleted') return 'medium';
    return 'low';
  }

  function sevColor(sev) {
    if (sev === 'critical') return 'var(--md-sys-color-error)';
    if (sev === 'high') return 'var(--md-sys-color-secondary)';
    if (sev === 'medium') return 'var(--md-sys-color-primary)';
    return 'var(--md-sys-color-on-surface-variant)';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function shortenPath(p) {
    if (!p || p.length <= 48) return p || '';
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 3) return p;
    return '\u2026/' + parts.slice(-3).join('/');
  }

  function typeIcon(type) {
    if (type === 'network') return 'NET';
    return 'FILE';
  }

  let unified = $derived.by(() => {
    const fileEvs = $events.map(ev => ({ ...ev, _type: 'file' }));
    const netEvs = $network.map(conn => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      file: `${conn.domain || conn.remoteIp || '?'}:${conn.remotePort || '?'}`,
      action: conn.state || 'established',
      sensitive: !!conn.flagged,
      reason: conn.flagged ? 'Unknown domain' : '',
      flagged: !!conn.flagged,
      _type: 'network',
    }));
    return [...fileEvs, ...netEvs]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });

  let filtered = $derived.by(() => {
    let result = unified;
    if (agentFilter !== 'all') {
      result = result.filter(ev => ev.agent === agentFilter);
    }
    if (severityFilter !== 'all') {
      result = result.filter(ev => getSeverity(ev) === severityFilter);
    }
    if (typeFilter !== 'all') {
      result = result.filter(ev => ev._type === typeFilter);
    }
    return result.slice(0, 200);
  });
</script>

<div class="feed-scroll">
  {#if filtered.length === 0}
    <div class="feed-empty">No events to display</div>
  {:else}
    {#each filtered as ev, i (`${ev.timestamp}-${ev.agent}-${i}`)}
      {@const sev = getSeverity(ev)}
      <div class="feed-entry">
        <span class="feed-dot" style:background={sevColor(sev)}></span>
        <span class="feed-time">{formatTime(ev.timestamp)}</span>
        <span class="feed-agent">{ev.agent}</span>
        <span class="feed-type type-{ev._type}">{typeIcon(ev._type)}</span>
        <span class="feed-desc" title={ev.file}>{shortenPath(ev.file)}</span>
        {#if ev.reason}
          <span class="feed-reason">{ev.reason}</span>
        {/if}
        <span class="feed-sev" style:background={sevColor(sev)}>{sev}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .feed-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .feed-empty {
    padding: 40px 20px;
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .feed-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .feed-entry:hover {
    background: var(--md-sys-color-surface-container-low);
  }

  .feed-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .feed-time {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 56px;
  }

  .feed-agent {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    flex-shrink: 0;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-type {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--md-sys-shape-corner-small);
    flex-shrink: 0;
    font-size: 10px;
    letter-spacing: 0.5px;
    border: 1px solid var(--md-sys-color-outline);
    color: var(--md-sys-color-on-surface-variant);
  }

  .type-network {
    color: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
  }

  .feed-desc {
    font: var(--md-sys-typescale-body-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-reason {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-secondary);
    flex-shrink: 0;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-sev {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-surface);
    flex-shrink: 0;
  }
</style>
