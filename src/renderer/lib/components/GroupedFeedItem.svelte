<script>
  import { t } from '../i18n/index.js';
  import { getSeverity, sevColor, formatTime, shortenPath } from '../utils/grouped-feed-utils';

  /**
   * @typedef {import('../utils/grouped-feed-utils').FeedEvent} FeedEvent
   */

  let { ev, index, groupKey, expandedEvent = null, onToggle } = $props();

  let sev = $derived(getSeverity(ev));
  let label = $derived(badgeLabel(ev, sev));
  let isExpanded = $derived(expandedEvent === groupKey);

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
  onclick={() => onToggle(groupKey)}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') onToggle(groupKey);
  }}
  role="button"
  tabindex="0"
>
  <span class="feed-dot" style:background={sevColor(sev)}></span>
  <span class="feed-time">{formatTime(ev.timestamp)}</span>
  <button class="feed-path" title={ev.file} onclick={handlePathClick}>{shortenPath(ev.file)}</button
  >
  {#if ev.repeatCount > 1}<span class="feed-repeat">&times;{ev.repeatCount}</span>{/if}
  {#if label}<span
      class="feed-badge"
      class:badge-high={sev === 'critical' || sev === 'high'}
      class:badge-config={sev === 'medium'}>{label}</span
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
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    width: 100%;
    padding: var(--aegis-space-2) var(--aegis-space-6);
    background: transparent;
    border: none;
    font-size: calc(11px * var(--aegis-ui-scale));
    cursor: pointer;
    color: var(--md-sys-color-on-surface);
    text-align: left;
    transition: background 0.15s ease;
  }
  .event-row.odd {
    background: var(--md-sys-color-surface-container-low);
  }
  .event-row:hover {
    background: var(--md-sys-color-outline-variant);
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
