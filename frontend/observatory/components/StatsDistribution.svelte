<script lang="ts">
  import { t } from '../runtime/i18n';

  let {
    title,
    subtitle,
    rows,
    inspect,
  }: {
    title: string;
    subtitle: string;
    rows: { label: string; value: number; tone?: string; row?: Record<string, unknown> }[];
    inspect?: (_title: string, _row: Record<string, unknown>) => void;
  } = $props();
  let total = $derived(rows.reduce((n, r) => n + r.value, 0));
  let max = $derived(Math.max(1, ...rows.map((r) => r.value)));
  let angle = $derived.by(() => {
    let offset = 0;
    return rows.map((row) => {
      const segment = { ...row, offset };
      offset += total ? (row.value / total) * 100 : 0;
      return segment;
    });
  });
</script>

<section class="panel distribution">
  <header>
    <h3>{$t(title)}</h3>
    <p>{$t(subtitle)}</p>
  </header>
  <div class="distribution-body">
    <div
      class="ring"
      role="img"
      aria-label={rows.map((r) => r.label + ': ' + r.value).join(', ') || $t('No observations')}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="track" cx="60" cy="60" r="48" />
        {#each angle as item, index (index)}<circle
            cx="60"
            cy="60"
            r="48"
            pathLength="100"
            stroke={item.tone || 'var(--green)'}
            stroke-dasharray={(total ? (item.value / total) * 100 : 0) + ' 100'}
            stroke-dashoffset={-item.offset}
          />{/each}
      </svg><strong>{total.toLocaleString()}<small>{$t('observed')}</small></strong>
    </div>
    <div class="bars">
      {#each rows as row, index (index)}
        <button
          disabled={!inspect || !row.row}
          onclick={() => row.row && inspect?.(row.label, row.row)}
          aria-label={row.label + ', ' + row.value}
        >
          <span><span>{row.label}</span><strong>{row.value.toLocaleString()}</strong></span>
          <span class="track"
            ><span
              style:width={(row.value / max) * 100 + '%'}
              style:background={row.tone || 'var(--green)'}
            ></span></span
          >
        </button>
      {:else}<p class="muted">{$t('No observations available.')}</p>{/each}
    </div>
  </div>
</section>

<style>
  .distribution {
    padding: 18px;
    min-width: 0;
  }
  h3 {
    font-size: 13px;
    font-weight: 550;
    margin: 0;
  }
  header p {
    color: var(--muted);
    font-size: 11px;
    margin: 6px 0 0;
    line-height: 1.5;
  }
  .distribution-body {
    display: flex;
    align-items: center;
    gap: 22px;
    padding-top: 18px;
  }
  .ring {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
    position: relative;
  }
  svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }
  circle {
    fill: none;
    stroke-width: 8;
  }
  circle.track {
    stroke: var(--border);
  }
  .ring > strong {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  small {
    font-size: 10px;
    color: var(--muted);
    margin-top: 4px;
  }
  .bars {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 12px;
    max-height: 220px;
    overflow: auto;
  }
  button {
    display: grid;
    gap: 6px;
    padding: 3px;
    text-align: left;
    border-radius: 4px;
  }
  button:disabled {
    opacity: 1;
    cursor: default;
  }
  button > span:first-child {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ink);
  }
  button > span > span {
    overflow-wrap: anywhere;
  }
  button strong {
    font-variant-numeric: tabular-nums;
  }
  .track {
    background: var(--border);
    height: 5px;
    border-radius: 3px;
    display: block;
    overflow: hidden;
  }
  .track > span {
    display: block;
    height: 100%;
    border-radius: 3px;
  }
  @media (max-width: 720px) {
    .distribution-body {
      gap: 14px;
    }
    .ring {
      width: 82px;
      height: 82px;
    }
  }
</style>
