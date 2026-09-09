<script lang="ts">
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupActivity, riskBand, type RadarGroup } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import RadarSummary from './RadarSummary.svelte';
  import RadarInspector from './RadarInspector.svelte';
  import RadarLinks from './RadarLinks.svelte';
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
  let end = $derived(
    Math.max(telemetry.lastScan ?? 0, ...telemetry.events.map((e) => e.timestamp)) + 1,
  );
  let maximum = $derived(
    Math.max(
      1,
      ...plotted.flatMap((g) => groupActivity(g, telemetry, end).map((b) => b.events.length)),
    ),
  );
  let linked = $derived(
    (layer === 'files' ? telemetry.events : telemetry.network)
      .filter((e) => !selected || e.instanceId === selected)
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
  }
  function position(g: RadarGroup, i: number) {
    const angle = [312, 142, 65, 225][i];
    const r = 22 + g.risk * 0.24;
    return {
      x: 50 + Math.sin((angle * Math.PI) / 180) * r,
      y: 50 - Math.cos((angle * Math.PI) / 180) * r,
      angle,
    };
  }
</script>

<div class="overview-grid">
  <section class="panel radar-panel">
    <div class="panel-head">
      <div>
        <h2><Icon name="radar" />Agent radar</h2>
        <p>Risk and active instances</p>
      </div>
      <div class="segmented" aria-label="Radar layer">
        {#each [['radar', 'Radar', 'radar'], ['files', 'Files', 'folder'], ['network', 'Network', 'network']] as [id, title, icon] (id)}<button
            aria-pressed={layer === id}
            onclick={() => (layer = id)}><Icon name={icon} />{title}</button
          >{/each}
      </div>
    </div>
    <div id="radar-body">
      <div class="radar-workspace">
        <aside class="radar-info radar-info-left" aria-label="Agent activity, left">
          {#each plotted.slice(0, 2) as group (group.key)}<RadarSummary
              {group}
              {telemetry}
              {end}
              {maximum}
              {selected}
              {select}
              {inspect}
            />{/each}
        </aside>
        <div class="radar-stage" class:stale={telemetry.stale} data-layer={layer}>
          <button
            class="radar-empty"
            aria-label="Clear radar selection"
            onclick={() => (selected = null)}
          ></button>
          <div class="radar-coordinate">
            {telemetry.stale ? 'Sensor unavailable' : 'Processes visible'}<br />Local monitoring
          </div>
          <div class="radar-dial">
            <div class="dial-grid"></div>
            <div class="dial-ticks"></div>
            <div class="dial-sweep"></div>
            <span class="bearing north">0°</span><span class="bearing east">90°</span><span
              class="bearing south">180°</span
            ><span class="bearing west">270°</span>
            <div class="radar-center"><Icon name="shield" /></div>
            {#each plotted as group, i (group.key)}{@const point = position(group, i)}<button
                class={`radar-blip ${riskBand(group.risk)}`}
                class:label-left={point.x < 50}
                data-group={group.key}
                style={`left:${point.x}%;top:${point.y}%;--echo-delay:${point.angle / 40 - 9}s`}
                aria-label={`Select ${group.name}, ${group.members.length} processes, risk ${group.risk}`}
                aria-pressed={group === chosenGroup}
                onclick={() => select(group)}
                onkeydown={(e) => {
                  if (e.key === 'Escape') selected = null;
                }}
              >
                <span class="blip-dot"
                  ><AgentLogo id={group.key} name={group.name} size={18} /></span
                ><span class="blip-meta"
                  ><strong>{group.name}</strong><small
                    >{group.risk} / 100{#if group.members.length > 1}
                      · {group.members.length} processes{/if}</small
                  ></span
                >
              </button>{/each}
          </div>
          {#if !groups.length}<p class="radar-message">
              {telemetry.ready ? 'No agents in this snapshot' : 'Waiting for a reliable scan'}
            </p>{/if}
          {#if layer !== 'radar'}<RadarLinks rows={linked} {layer} {inspect} />{/if}
          <div class="radar-scale">Farther from center:<br />higher risk</div>
        </div>
        <aside class="radar-info radar-info-right" aria-label="Agent activity, right">
          {#each plotted.slice(2, 4) as group (group.key)}<RadarSummary
              {group}
              {telemetry}
              {end}
              {maximum}
              {selected}
              {select}
              {inspect}
            />{/each}
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
      <button
        id="open-selected-agent"
        disabled={!chosen}
        onclick={() => chosen && inspect(chosen.name, chosen as unknown as RecordData)}
        >Open selected agent</button
      >
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
