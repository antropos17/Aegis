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

  function badgeLabel(ev, sev) {
    if (sev === 'critical') return 'DENIED';
    if (ev.reason?.startsWith('AI agent config')) return 'CONFIG';
    if (ev.sensitive || sev === 'high') return 'SENSITIVE';
    if (sev === 'medium') return 'DELETED';
    return '';
  }

  function badgeClass(sev) {
    if (sev === 'critical' || sev === 'high') return 'badge-high';
    if (sev === 'medium') return 'badge-config';
    return '';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function shortenPath(p) {
    if (!p) return '';
    if (p.length <= 40) return p;
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return p;
    return '\u2026/' + parts.slice(-2).join('/');
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
    const fileEvs = $events.flat().map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = $network.map((conn) => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      file: `${conn.domain || conn.remoteIp || '?'}:${conn.remotePort || '?'}`,
      action: conn.state || 'established',
      sensitive: !!conn.flagged,
      reason: conn.flagged ? 'Unknown domain' : '',
      flagged: !!conn.flagged,
      _type: 'network',
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
</script>

<div class="feed-scroll">
  {#if filtered.length === 0}
    <div class="feed-empty">No events to display</div>
  {:else}
    {#each filtered as ev, i (`${ev.timestamp}-${ev.agent}-${i}`)}
      {@const sev = getSeverity(ev)}
      {@const label = badgeLabel(ev, sev)}
      <div class="feed-entry" class:odd={i % 2 === 1}>
        <span class="feed-dot" style:background={sevColor(sev)}></span>
        <span class="feed-time">{formatTime(ev.timestamp)}</span>
        <span class="feed-agent">{ev.agent}</span>
        <span class="feed-action">{ev.action || ev._type}</span>
        <button class="feed-path" title={ev.file} onclick={(e) => handlePathClick(ev, e)}
          >{shortenPath(ev.file)}</button
        >
        {#if ev.repeatCount > 1}
          <span class="feed-repeat">&times;{ev.repeatCount}</span>
        {/if}
        {#if label}
          <span class="feed-badge {badgeClass(sev)}">{label}</span>
        {/if}
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
    padding: calc(40px * var(--aegis-ui-scale)) var(--aegis-space-9);
    text-align: center;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .feed-entry {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    padding: var(--aegis-space-3) var(--aegis-space-8);
    font-size: calc(11px * var(--aegis-ui-scale));
    transition: background 0.15s ease;
  }

  .feed-entry.odd {
    background: rgba(255, 255, 255, 0.01);
  }

  .feed-entry:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .feed-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .feed-time {
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: var(--aegis-col-time);
  }

  .feed-agent {
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    flex-shrink: 0;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-action {
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: var(--aegis-col-action);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-path {
    font-family: 'DM Mono', monospace;
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
    transition: text-decoration 0.15s ease;
  }

  .feed-path:hover {
    text-decoration: underline;
    color: var(--md-sys-color-primary);
  }

  .feed-badge {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: var(--aegis-space-1) var(--aegis-space-3);
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
  }

  .badge-high {
    background: rgba(200, 90, 90, 0.15);
    color: var(--md-sys-color-error);
  }

  .badge-config {
    background: rgba(200, 168, 78, 0.12);
    color: var(--md-sys-color-secondary);
  }

  .feed-repeat {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.7;
    flex-shrink: 0;
  }
</style>
