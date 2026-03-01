<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { events, network } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { t } from '../i18n/index.js';

  let { agentFilter = 'all', severityFilter = 'all', typeFilter = 'all' } = $props();
  let expandedGroups = new SvelteSet();
  let expandedEvent = $state(null);

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
    if (sev === 'critical') return $t('activity.feed.severity.denied');
    if (ev.reason?.startsWith('AI agent config')) return $t('activity.feed.severity.config');
    if (ev.sensitive || sev === 'high') return $t('activity.feed.severity.sensitive');
    if (sev === 'medium') return $t('activity.feed.severity.deleted');
    return '';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function shortenPath(p) {
    if (!p || p.length <= 40) return p || '';
    const parts = p.replace(/\\/g, '/').split('/');
    return parts.length <= 2 ? p : '\u2026/' + parts.slice(-2).join('/');
  }

  function getSubType(ev) {
    if (ev._type === 'network') return 'network';
    if (ev.reason?.startsWith('AI agent config')) return 'config';
    return 'file';
  }

  function maxSev(evs) {
    const ord = { critical: 4, high: 3, medium: 2, low: 1 };
    let best = 'low';
    for (const ev of evs) {
      const s = getSeverity(ev);
      if ((ord[s] || 0) > (ord[best] || 0)) best = s;
    }
    return best;
  }

  let unified = $derived.by(() => {
    const fileEvs = $events.flat().map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = $network.map((c) => ({
      agent: c.agent || 'Unknown',
      timestamp: c.timestamp || Date.now(),
      file: `${c.domain || c.remoteIp || '?'}:${c.remotePort || '?'}`,
      action: c.state || 'established',
      sensitive: !!c.flagged,
      reason: c.flagged ? 'Unknown domain' : '',
      flagged: !!c.flagged,
      _type: 'network',
      _domain: c.domain || '',
      _ip: c.remoteIp || '',
    }));
    return [...fileEvs, ...netEvs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });

  let filtered = $derived.by(() => {
    let r = unified;
    if (agentFilter !== 'all') r = r.filter((ev) => ev.agent === agentFilter);
    if (severityFilter !== 'all') r = r.filter((ev) => getSeverity(ev) === severityFilter);
    if (typeFilter !== 'all') r = r.filter((ev) => ev._type === typeFilter);
    return r.slice(0, 200);
  });

  let groups = $derived.by(() => {
    const map = new Map();
    for (const ev of filtered) {
      if (!map.has(ev.agent)) map.set(ev.agent, []);
      map.get(ev.agent).push(ev);
    }
    return [...map.entries()]
      .map(([name, evs]) => {
        const a = $enrichedAgents.find((x) => x.name === name);
        return {
          name,
          count: evs.length,
          lastActivity: evs[0]?.timestamp || 0,
          severity: maxSev(evs),
          riskScore: Math.round(a?.riskScore || 0),
          trustGrade: a?.trustGrade || '?',
          fileEvents: evs.filter((e) => getSubType(e) === 'file'),
          configEvents: evs.filter((e) => getSubType(e) === 'config'),
          networkEvents: evs.filter((e) => getSubType(e) === 'network'),
        };
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
  });

  function toggleGroup(name) {
    expandedGroups.has(name) ? expandedGroups.delete(name) : expandedGroups.add(name);
  }

  function toggleEvent(key) {
    expandedEvent = expandedEvent === key ? null : key;
  }

  function handlePathClick(ev, e) {
    e.stopPropagation();
    if (ev._type === 'network') {
      navigator.clipboard.writeText(ev.file);
    } else if (ev.file && window.aegis?.revealInExplorer) {
      window.aegis.revealInExplorer(ev.file);
    }
  }
</script>

<div class="feed-scroll">
  {#if groups.length === 0}
    <div class="feed-empty">{$t('activity.feed.no_events')}</div>
  {:else}
    {#each groups as group (group.name)}
      {@const open = expandedGroups.has(group.name)}
      <button class="group-header" aria-expanded={open} onclick={() => toggleGroup(group.name)}>
        <span class="chevron">{open ? '\u25BE' : '\u25B8'}</span>
        <span class="group-name">{group.name}</span>
        <span class="group-count">{group.count === 1 ? $t('activity.groups.events_singular', { count: group.count }) : $t('activity.groups.events_plural', { count: group.count })}</span>
        <span class="group-time">{formatTime(group.lastActivity)}</span>
        <span
          class="group-badge"
          class:sev-critical={group.severity === 'critical'}
          class:sev-high={group.severity === 'high'}
          class:sev-medium={group.severity === 'medium'}
          >{group.trustGrade} &middot; {group.riskScore}</span
        >
      </button>
      {#if open}
        <div class="group-body">
          {#each [{ label: $t('activity.groups.file_access'), evs: group.fileEvents }, { label: $t('activity.groups.config_access'), evs: group.configEvents }, { label: $t('activity.groups.network'), evs: group.networkEvents }] as sub (sub.label)}
            {#if sub.evs.length > 0}
              <div class="sub-label">{sub.label} ({sub.evs.length})</div>
              {#each sub.evs as ev, i (`${ev.timestamp}-${i}`)}
                {@const key = `${group.name}-${sub.label}-${i}`}
                {@const sev = getSeverity(ev)}
                {@const label = badgeLabel(ev, sev)}
                {@const xpd = expandedEvent === key}
                <div
                  class="event-row"
                  class:odd={i % 2 === 1}
                  onclick={() => toggleEvent(key)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleEvent(key);
                  }}
                  role="button"
                  tabindex="0"
                >
                  <span class="feed-dot" style:background={sevColor(sev)}></span>
                  <span class="feed-time">{formatTime(ev.timestamp)}</span>
                  <button class="feed-path" title={ev.file} onclick={(e) => handlePathClick(ev, e)}
                    >{shortenPath(ev.file)}</button
                  >
                  {#if ev.repeatCount > 1}<span class="feed-repeat">&times;{ev.repeatCount}</span
                    >{/if}
                  {#if label}<span
                      class="feed-badge"
                      class:badge-high={sev === 'critical' || sev === 'high'}
                      class:badge-config={sev === 'medium'}>{label}</span
                    >{/if}
                </div>
                {#if xpd}
                  <div class="event-detail">
                    {#if ev._type === 'network'}<button
                        class="detail-link"
                        onclick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(
                            `${ev._domain || ev._ip || '?'}:${ev.file.split(':').pop()}`,
                          );
                        }}>{$t('activity.groups.domain_prefix')} {ev._domain || $t('activity.groups.unresolved')} &middot; {$t('activity.groups.ip_prefix')} {ev._ip || '?'}</button
                      >{:else}<button class="detail-link" onclick={(e) => handlePathClick(ev, e)}
                        >{ev.file}</button
                      >{/if}
                  </div>
                {/if}
              {/each}
            {/if}
          {/each}
        </div>
      {/if}
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

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    width: 100%;
    padding: var(--aegis-space-4) var(--aegis-space-8);
    background: var(--md-sys-color-surface-container-low);
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    font-size: calc(12px * var(--aegis-ui-scale));
    color: var(--md-sys-color-on-surface);
    text-align: left;
    transition: background 0.15s ease;
  }
  .group-header:hover {
    background: var(--md-sys-color-surface-container);
  }
  .chevron {
    font-size: calc(10px * var(--aegis-ui-scale));
    width: 12px;
    color: var(--md-sys-color-on-surface-variant);
  }
  .group-name {
    font-weight: 700;
    flex-shrink: 0;
  }
  .group-count {
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    font-size: calc(10px * var(--aegis-ui-scale));
  }
  .group-time {
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    font-size: calc(10px * var(--aegis-ui-scale));
    margin-left: auto;
  }

  .group-badge {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    padding: var(--aegis-space-1) var(--aegis-space-4);
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
    background: rgba(122, 138, 158, 0.1);
    color: var(--md-sys-color-on-surface-variant);
  }
  .group-badge.sev-critical {
    background: rgba(200, 90, 90, 0.15);
    color: var(--md-sys-color-error);
  }
  .group-badge.sev-high {
    background: rgba(200, 168, 78, 0.12);
    color: var(--md-sys-color-secondary);
  }
  .group-badge.sev-medium {
    background: rgba(66, 153, 225, 0.12);
    color: var(--md-sys-color-primary);
  }

  .group-body {
    padding-left: var(--aegis-space-6);
    border-left: 2px solid rgba(255, 255, 255, 0.04);
    margin-left: var(--aegis-space-3);
  }
  .sub-label {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
    padding: var(--aegis-space-3) var(--aegis-space-6) var(--aegis-space-1);
    text-transform: uppercase;
  }

  .event-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    width: 100%;
    padding: var(--aegis-space-3) var(--aegis-space-8);
    background: transparent;
    border: none;
    font-size: calc(11px * var(--aegis-ui-scale));
    cursor: pointer;
    color: var(--md-sys-color-on-surface);
    text-align: left;
    transition: background 0.15s ease;
  }
  .event-row.odd {
    background: rgba(255, 255, 255, 0.01);
  }
  .event-row:hover {
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
  .feed-path {
    font-family: 'DM Mono', monospace;
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
    color: var(--md-sys-color-on-surface);
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

  .event-detail {
    font-family: 'DM Mono', monospace;
    font-size: calc(10px * var(--aegis-ui-scale));
    color: var(--md-sys-color-on-surface-variant);
    padding: var(--aegis-space-1) var(--aegis-space-6) var(--aegis-space-3)
      calc(26px * var(--aegis-ui-scale));
    word-break: break-all;
  }
  .detail-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    word-break: break-all;
  }
  .detail-link:hover {
    text-decoration: underline;
    color: var(--md-sys-color-primary);
  }
</style>
