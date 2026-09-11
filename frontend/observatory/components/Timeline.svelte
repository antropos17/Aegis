<script lang="ts">
  import { t } from '../runtime/i18n';

  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { activityBins, activityTimeLabel } from '../runtime/activity';
  import { radarGroups } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    paused = false,
    inspect,
  }: {
    telemetry: Telemetry;
    paused?: boolean;
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let range = $state(15),
    offset = $state(0);
  let now = $state(Date.now());
  $effect(() => {
    if (paused || telemetry.stale) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  let end = $derived(now + 1 - offset * 1000);
  let groups = $derived(radarGroups(instances(telemetry)));
  function keys(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const b = e.currentTarget as HTMLElement;
    const buttons = [...b.parentElement!.querySelectorAll<HTMLButtonElement>('button')];
    const i = buttons.indexOf(b as HTMLButtonElement);
    e.preventDefault();
    buttons[
      Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
    ]?.focus();
  }
</script>

<section class="panel timeline-panel">
  <div class="panel-head">
    <h2><Icon name="activity" />{$t('Timeline')}</h2>
    <span class="filter-count"
      >{telemetry.events.length}
      {$t('retained events')}{paused
        ? $t(' · Paused')
        : telemetry.stale
          ? $t(' · Observation unavailable')
          : ''}</span
    >
  </div>
  <div class="lanes">
    {#each groups as g (g.key)}{@const ids = new Set(
        g.members.map((a) => a.instanceId).filter(Boolean),
      )}{@const bins = activityBins(
        telemetry.events.filter((e) => !!e.instanceId && ids.has(e.instanceId)),
        end,
        range * 60000,
        12,
      )}
      <div class="lane">
        <button
          class="lane-label"
          onclick={() => inspect(g.name, g.members[0] as unknown as RecordData)}
          ><AgentLogo id={g.key} name={g.name} /><span>{g.name}</span></button
        >
        <div class="lane-bars" role="group" aria-label={g.name + ' events'}>
          {#each bins as b, i (i)}{#if b.events.length}<button
                class="event-tick"
                class:medium={b.events.some((e) => e.sensitive)}
                style={`left:${((i + 0.5) / 12) * 100}%`}
                aria-label={$t('{value0}: {value1} events', {
                  value0: g.name,
                  value1: b.events.length,
                })}
                onkeydown={keys}
                onclick={() =>
                  inspect('Activity interval', {
                    observations: b.events,
                    from: new Date(b.start).toISOString(),
                    to: new Date(b.end).toISOString(),
                  })}>{b.events.length}</button
              >{/if}{/each}
        </div>
      </div>{:else}<p class="inset muted">{$t('No observed agents.')}</p>{/each}
  </div>
  <div class="time-labels">
    {#each [0, 0.25, 0.5, 0.75, 1] as n (n)}<span
        >{activityTimeLabel(end - range * 60000 * (1 - n) - (n === 1 ? 1 : 0))}</span
      >{/each}
  </div>
  <div class="timeline-controls">
    <label
      >{$t('Range')}<select bind:value={range}
        ><option value={5}>{$t('5 min')}</option><option value={15}>{$t('15 min')}</option><option
          value={60}>{$t('1 hour')}</option
        ></select
      ></label
    ><input
      type="range"
      aria-label={$t('Timeline offset in seconds')}
      min="0"
      max="900"
      step="15"
      bind:value={offset}
    /><button class="text-button" onclick={() => (offset = 0)}>{$t('Jump to now')}</button>
  </div>
</section>

<style>
  .lanes {
    max-height: 280px;
    overflow: auto;
  }
</style>
