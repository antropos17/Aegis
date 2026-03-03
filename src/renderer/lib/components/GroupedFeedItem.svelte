<script>
  import { t } from '../i18n/index.js';
  import { getSeverity, formatTime, shortenPath } from '../utils/grouped-feed-utils';

  /**
   * @typedef {import('../utils/grouped-feed-utils').FeedEvent} FeedEvent
   */

  let { ev, index, groupKey, expandedEvent = null, onToggle } = $props();

  let sev = $derived(getSeverity(ev));
  let label = $derived(badgeLabel(ev, sev));
  let isExpanded = $derived(expandedEvent === groupKey);

  /** Severity to fancy color variable */
  function sevColor(s) {
    if (s === 'critical') return 'var(--fancy-danger)';
    if (s === 'high') return 'var(--fancy-warning)';
    if (s === 'medium') return 'var(--fancy-info)';
    return 'var(--fancy-text-2)';
  }

  /** Severity to glow box-shadow */
  function sevGlow(s) {
    if (s === 'critical') return 'var(--fancy-danger-glow)';
    if (s === 'high') return 'var(--fancy-warning-glow)';
    if (s === 'medium') return 'var(--fancy-info-glow)';
    return 'none';
  }

  /** Badge label based on event and severity. */
  function badgeLabel(event, severity) {
    if (severity === 'critical') return $t('activity.feed.severity.denied');
    if (event.reason?.startsWith('AI agent config')) return $t('activity.feed.severity.config');
    if (event.sensitive || severity === 'high') return $t('activity.feed.severity.sensitive');
    if (severity === 'medium') return $t('activity.feed.severity.deleted');
    return '';
  }

  function handlePathClick(e) {
    e.stopPropagation();
    if (ev._type === 'network') {
      navigator.clipboard.writeText(ev.file);
    } else if (ev.file && window.aegis?.revealInExplorer) {
      window.aegis.revealInExplorer(ev.file);
    }
  }
</script>

<div
  class="event-row"
  class:odd={index % 2 === 1}
  class:sev-critical={sev === 'critical'}
  class:sev-high={sev === 'high'}
  class:sev-medium={sev === 'medium'}
  onclick={() => onToggle(groupKey)}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') onToggle(groupKey);
  }}
  role="button"
  tabindex="0"
>
  <span class="sev-bar" style:background={sevColor(sev)}></span>
  <span class="feed-dot" style:background={sevColor(sev)} style:box-shadow={sevGlow(sev)}></span>
  <span class="feed-time">{formatTime(ev.timestamp)}</span>
  <button class="feed-path" title={ev.file} onclick={handlePathClick}>{shortenPath(ev.file)}</button
  >
  {#if ev.repeatCount > 1}<span class="feed-repeat">&times;{ev.repeatCount}</span>{/if}
  {#if label}<span
      class="feed-badge"
      class:badge-danger={sev === 'critical' || sev === 'high'}
      class:badge-warning={sev === 'high'}
      class:badge-info={sev === 'medium'}>{label}</span
    >{/if}
</div>
{#if isExpanded}
  <div class="event-detail">
    {#if ev._type === 'network'}<button
        class="detail-link"
        onclick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(
            `${ev._domain || ev._ip || '?'}:${ev.file.split(':').pop()}`,
          );
        }}
        >{$t('activity.groups.domain_prefix')}
        {ev._domain || $t('activity.groups.unresolved')} &middot; {$t('activity.groups.ip_prefix')}
        {ev._ip || '?'}</button
      >{:else}<button class="detail-link" onclick={handlePathClick}>{ev.file}</button>{/if}
  </div>
{/if}

<style>
  .event-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    width: 100%;
    padding: var(--aegis-space-2) var(--aegis-space-6);
    padding-left: calc(var(--aegis-space-6) + 3px);
    background: transparent;
    border: none;
    font-size: calc(11px * var(--aegis-ui-scale));
    font-family: var(--fancy-font-body);
    cursor: pointer;
    color: var(--md-sys-color-on-surface);
    text-align: left;
    transition: background var(--fancy-transition-micro) var(--fancy-ease);
  }
  .event-row.odd {
    background: var(--md-sys-color-surface-container-low);
  }
  .event-row:hover {
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

  .event-row.sev-critical .sev-bar,
  .event-row.sev-high .sev-bar,
  .event-row.sev-medium .sev-bar {
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
  .feed-path {
    font-family: var(--fancy-font-mono);
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
  .feed-repeat {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    font-family: var(--fancy-font-mono);
    color: var(--fancy-text-2);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .event-detail {
    font-family: var(--fancy-font-mono);
    font-size: calc(10px * var(--aegis-ui-scale));
    color: var(--fancy-text-2);
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
    transition: color var(--fancy-transition-micro) var(--fancy-ease);
  }
  .detail-link:hover {
    text-decoration: underline;
    color: var(--md-sys-color-primary);
  }
</style>
