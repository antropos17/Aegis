<script lang="ts">
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupRecord, riskBand, type RadarGroup } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import RadarSummary from './RadarSummary.svelte';
  import RadarInspector from './RadarInspector.svelte';
  import RadarLinks from './RadarLinks.svelte';
  import { reveal } from '../runtime/motion';
  let {
    telemetry,
    selected = $bindable(null),
    inspect,
  }: {
    telemetry: Telemetry;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let agents = $derived(instances(telemetry));
  let groups = $derived(radarGroups(agents));
  let page = $state(0);
  let layer = $state('radar');
  let pages = $derived(Math.max(1, Math.ceil(groups.length / 4)));
  let plotted = $derived(
    groups.slice(Math.min(page, pages - 1) * 4, Math.min(page, pages - 1) * 4 + 4),
  );
  let chosen = $derived(agents.find((a) => !!selected && a.instanceId === selected));
  let chosenGroup = $derived(
    groups.find((g) => g.members.some((a) => !!selected && a.instanceId === selected)),
  );
  let linked = $derived(
    (layer === 'files' ? telemetry.events : telemetry.network)
      .filter(
        (e) =>
          !chosenGroup ||
          chosenGroup.members.some((a) => !!e.instanceId && a.instanceId === e.instanceId),
      )
      .slice(0, 2)
      .map((e) => ({
        row: e as unknown as RecordData,
        group:
          plotted.find((g) =>
            g.members.some((a) => !!e.instanceId && a.instanceId === e.instanceId),
          )?.key ?? null,
      })),
  );
  function select(g: RadarGroup) {
    selected =
      g.members.find((a) => a.instanceId === selected)?.instanceId ??
      g.members.find((a) => a.instanceId)?.instanceId ??
      null;
    if (!selected) inspect(g.name, groupRecord(g));
  }
  function position(g: RadarGroup, i: number) {
    const count = plotted.length;
    const angle = count === 3 ? i * 120 : 45 + i * (360 / Math.max(2, count));
    const r = 27 + g.risk * 0.19;
    return {
      x: 50 + Math.sin((angle * Math.PI) / 180) * r,
      y: 50 - Math.cos((angle * Math.PI) / 180) * r,
      angle,
    };
  }
</script>

<div class="overview-grid radar-clarity">
  <section class="panel radar-panel">
    <div class="panel-head">
      <div>
        <h2><Icon name="radar" />Agent radar</h2>
        <p>One marker per agent · risk rises toward the edge</p>
      </div>
      <div
        class="segmented radar-layers"
        aria-label="Radar layer"
        style={`--layer-index:${['radar', 'files', 'network'].indexOf(layer)}`}
      >
        {#each [['radar', 'Radar', 'radar'], ['files', 'Files', 'folder'], ['network', 'Network', 'network']] as [id, title, icon] (id)}<button
            aria-pressed={layer === id}
            onclick={() => (layer = id)}><Icon name={icon} />{title}</button
          >{/each}
      </div>
    </div>
    <div id="radar-body">
      <div class="radar-workspace">
        <div class="radar-stage" class:stale={telemetry.stale} data-layer={layer}>
          <button
            class="radar-empty"
            aria-label="Clear radar selection"
            onclick={() => (selected = null)}
          ></button>
          <div class="radar-coordinate">
            {telemetry.stale ? 'Last reliable snapshot' : 'Live observation'}
          </div>
          <div class="radar-dial">
            <div class="dial-grid"></div>
            <div class="dial-ticks"></div>
            <div class="dial-sweep"></div>
            <div class="radar-center"><Icon name="shield" /></div>
            {#each plotted as group, i (group.key)}{@const point = position(group, i)}<button
                class={`radar-blip ${riskBand(group.risk)}`}
                data-group={group.key}
                style={`left:${point.x}%;top:${point.y}%;--echo-delay:${point.angle / 60 - 6}s`}
                aria-label={`Select ${group.name}, ${group.members.length} processes, risk ${group.risk}`}
                title={`${group.name} · ${group.members.length} processes · risk ${group.risk}/100`}
                aria-pressed={group === chosenGroup}
                onclick={() => select(group)}
                onkeydown={(e) => {
                  if (e.key === 'Escape') selected = null;
                }}
              >
                <span class="blip-dot"
                  ><AgentLogo id={group.key} name={group.name} size={24} /></span
                >
                <span class="marker-number" aria-hidden="true"
                  >{Math.min(page, pages - 1) * 4 + i + 1}</span
                >
              </button>{/each}
          </div>
          {#if !groups.length}<p class="radar-message">
              {telemetry.ready ? 'No agents in this snapshot' : 'Waiting for a reliable scan'}
            </p>{/if}
          {#if layer !== 'radar'}<RadarLinks rows={linked} {layer} {inspect} />{/if}
          <div class="radar-scale">Select a marker or an agent in the list</div>
        </div>
        <aside class="radar-roster" aria-label="Observed agents">
          <div class="roster-heading">
            <h3>Agents</h3>
            <span>{groups.length}</span>
          </div>
          <div class="roster-items" use:reveal={String(Math.min(page, pages - 1))}>
            {#each plotted as group, i (group.key)}<RadarSummary
                {group}
                ordinal={Math.min(page, pages - 1) * 4 + i + 1}
                {selected}
                {select}
              />{/each}
          </div>
          {#if !groups.length}<p class="entity-note">
              {telemetry.ready ? 'No agents observed.' : 'Waiting for a scan.'}
            </p>{/if}
          <p class="roster-note">{agents.length} processes grouped by agent</p>
        </aside>
      </div>
    </div>
    <div class="radar-bottom">
      <div class="radar-legend">
        <span class="low"><i></i>Low 0–34</span><span class="medium"><i></i>Medium 35–65</span><span
          class="high"><i></i>High 66–100</span
        >
      </div>
      {#if pages > 1}<div class="radar-pages">
          <button aria-label="Previous radar agents" disabled={page === 0} onclick={() => page--}
            ><Icon name="arrowLeft" /></button
          ><span>{Math.min(page, pages - 1) + 1}/{pages}</span><button
            aria-label="Next radar agents"
            disabled={page >= pages - 1}
            onclick={() => page++}><Icon name="chevron" /></button
          >
        </div>{/if}
    </div>
  </section>
  <RadarInspector {chosen} group={chosenGroup} {telemetry} bind:selected {inspect} />
</div>

<style>
  .radar-empty {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
  }
  .radar-coordinate,
  .radar-scale,
  .dial-grid,
  .dial-ticks,
  .dial-sweep,
  .bearing,
  .radar-center {
    pointer-events: none;
  }
  .radar-message {
    position: absolute;
    bottom: 12px;
    width: 100%;
    text-align: center;
    pointer-events: none;
    font-size: 12px;
    color: var(--muted);
  }
  .radar-pages {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .radar-pages button {
    padding: 3px;
  }
</style>
