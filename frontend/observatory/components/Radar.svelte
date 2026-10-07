<script lang="ts">
  import { t } from '../runtime/i18n';

  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, riskBand, type RadarGroup } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import RadarSummary from './RadarSummary.svelte';
  import RadarInspector from './RadarInspector.svelte';
  import RadarResourceExplorer from './RadarResourceExplorer.svelte';
  import { leadingRiskReason } from '../runtime/risk-context';
  import { reveal } from '../runtime/motion';
  import { radarSweep } from '../runtime/radar-motion';
  let {
    telemetry,
    liveTelemetry,
    paused = false,
    selected = $bindable(null),
    inspect,
    openStatistics,
    openAgent,
  }: {
    telemetry: Telemetry;
    liveTelemetry?: Telemetry;
    paused?: boolean;
    openStatistics?: (_agent: string) => void;
    openAgent?: (_agent: string) => void;
    selected: string | null;
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let agents = $derived(instances(telemetry));
  let held = $derived(paused || (!!liveTelemetry && liveTelemetry !== telemetry));
  let groups = $derived(radarGroups(agents));
  let page = $state(0);
  let layer = $state('radar');
  let sweepActive = $derived(!held && telemetry.ready && !telemetry.stale && layer === 'radar');
  let visited = $state<string[]>([]);
  let resourceAgent = $state('');
  let focusedGroup = $state('');
  let pages = $derived(Math.max(1, Math.ceil(groups.length / 4)));
  let plotted = $derived(
    groups.slice(Math.min(page, pages - 1) * 4, Math.min(page, pages - 1) * 4 + 4),
  );
  let chosen = $derived(agents.find((a) => !!selected && a.instanceId === selected));
  let chosenGroup = $derived(
    groups.find((g) => g.key === focusedGroup) ??
      groups.find((g) => g.members.some((a) => !!selected && a.instanceId === selected)),
  );
  function chooseLayer(next: string) {
    if (layer === 'radar' && next !== 'radar') resourceAgent = chosenGroup?.name ?? '';
    layer = next;
    if (!visited.includes(next)) visited = [...visited, next];
  }
  function clearSelection() {
    selected = null;
    focusedGroup = '';
  }
  function changePage(offset: number) {
    page = Math.max(0, Math.min(pages - 1, page + offset));
    clearSelection();
  }
  function select(g: RadarGroup) {
    focusedGroup = g.key;
    selected =
      g.members.find((a) => a.instanceId === selected)?.instanceId ??
      g.members.find((a) => a.instanceId)?.instanceId ??
      null;
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

<div class="overview-grid radar-clarity" class:agent-launcher={!!openAgent}>
  <section class="panel radar-panel">
    <div class="panel-head">
      <div>
        <h2><Icon name="radar" />{$t('Agent radar')}</h2>
        <p>
          {layer === 'radar'
            ? $t('Select an agent to focus · risk rises toward the edge')
            : layer === 'files'
              ? $t('Find who touched a file, what changed and why it matters')
              : $t('Find who connected, where and what is known about the destination')}
        </p>
      </div>
      <div
        class="segmented radar-layers"
        aria-label={$t('Radar layer')}
        style={`--layer-index:${['radar', 'files', 'network'].indexOf(layer)}`}
      >
        {#each [['radar', 'Radar', 'radar'], ['files', 'Files', 'folder'], ['network', 'Network', 'network']] as [id, title, icon] (id)}<button
            aria-pressed={layer === id}
            onclick={() => chooseLayer(id)}><Icon name={icon} />{$t(title)}</button
          >{/each}
      </div>
    </div>
    <div hidden={layer !== 'radar'}>
      <div id="radar-body">
        <div class="radar-workspace">
          <div class="radar-stage" class:stale={telemetry.stale} data-layer="radar">
            <button
              class="radar-empty"
              aria-label={$t('Clear radar selection')}
              onclick={clearSelection}
            ></button>
            <div class="radar-coordinate">
              {!telemetry.ready
                ? $t('Waiting for a reliable scan')
                : telemetry.stale
                  ? $t('Last reliable snapshot')
                  : held
                    ? $t('Paused snapshot')
                    : $t('Live observation')}
            </div>
            <div class="radar-dial">
              <div class="dial-grid"></div>
              <div class="dial-ticks"></div>
              <div class="dial-sweep" use:radarSweep={sweepActive} aria-hidden="true"></div>
              <div class="radar-center"><Icon name="shield" /></div>
              {#each plotted as group, i (group.key)}{@const point = position(group, i)}<button
                  class={`radar-blip ${riskBand(group.risk)}`}
                  data-group={group.key}
                  style={`left:${point.x}%;top:${point.y}%`}
                  aria-label={$t('Select {value0}, {value1} processes, risk {value2}', {
                    value0: group.name,
                    value1: group.members.length,
                    value2: group.risk,
                  })}
                  title={$t('{value0} · {value1} processes · risk {value2}/100', {
                    value0: group.name,
                    value1: group.members.length,
                    value2: group.risk,
                  })}
                  aria-pressed={group === chosenGroup}
                  onclick={() => select(group)}
                  onkeydown={(e) => {
                    if (e.key === 'Escape') clearSelection();
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
            {#if !groups.length && layer === 'radar'}<p class="radar-message">
                {telemetry.ready
                  ? $t('No agents in this snapshot')
                  : $t('Waiting for a reliable scan')}
              </p>{/if}
            <div class="radar-scale">
              {$t('Centre: lower observed risk · Edge: higher observed risk')}
            </div>
          </div>
          <aside class="radar-roster" aria-label={$t('Observed agents')}>
            <div class="roster-heading">
              <h3>{$t('Agents')}</h3>
              <span>{groups.length}</span>
            </div>
            {#if chosenGroup}<button class="button roster-clear" onclick={clearSelection}
                ><Icon name="close" />{$t('Clear agent focus')}</button
              >{/if}
            <div class="roster-items" use:reveal={String(Math.min(page, pages - 1))}>
              {#each plotted as group, i (group.key)}<RadarSummary
                  {group}
                  ordinal={Math.min(page, pages - 1) * 4 + i + 1}
                  {selected}
                  active={group === chosenGroup}
                  {select}
                />{/each}
            </div>
            {#if !groups.length}<p class="entity-note">
                {telemetry.ready ? $t('No agents observed.') : $t('Waiting for a scan.')}
              </p>{/if}
            {#if openAgent && chosenGroup}<div class="radar-focus">
                <strong>{chosenGroup.name} · {chosenGroup.risk}/100</strong>
                <p>{$t(leadingRiskReason(chosenGroup.members[0]))}</p>
                <div>
                  <button class="button" onclick={() => chooseLayer('files')}
                    ><Icon name="folder" />{$t('View files')}</button
                  ><button class="button" onclick={() => chooseLayer('network')}
                    ><Icon name="network" />{$t('View connections')}</button
                  ><button class="button" onclick={() => openAgent?.(chosenGroup.key)}
                    ><Icon name="agents" />{$t('Open agent')}</button
                  >
                </div>
              </div>{/if}
            <p class="roster-note">{agents.length} {$t('processes grouped by agent')}</p>
          </aside>
        </div>
      </div>
      <div class="radar-bottom">
        <div class="radar-legend">
          <span class="low"><i></i>{$t('Low 0–34')}</span><span class="medium"
            ><i></i>{$t('Medium 35–65')}</span
          ><span class="high"><i></i>{$t('High 66–100')}</span>
        </div>
        {#if pages > 1}<div class="radar-pages">
            <button
              aria-label={$t('Previous radar agents')}
              disabled={page === 0}
              onclick={() => changePage(-1)}><Icon name="arrowLeft" /></button
            ><span>{Math.min(page, pages - 1) + 1}/{pages}</span><button
              aria-label={$t('Next radar agents')}
              disabled={page >= pages - 1}
              onclick={() => changePage(1)}><Icon name="chevron" /></button
            >
          </div>{/if}
        <p class="radar-guidance">
          <strong>{$t('Agent risk')}</strong> · {$t(
            'Choose a marker or row. Open the focused agent when you need its controls.',
          )}
        </p>
      </div>
    </div>
    {#each ['files', 'network'] as resourceLayer (resourceLayer)}
      {#if visited.includes(resourceLayer)}<div hidden={layer !== resourceLayer}>
          <RadarResourceExplorer
            {telemetry}
            {liveTelemetry}
            layer={resourceLayer}
            {inspect}
            bind:agent={resourceAgent}
          />
        </div>{/if}
    {/each}
  </section>
  {#if !openAgent && layer === 'radar'}<RadarInspector
      {chosen}
      group={chosenGroup}
      {telemetry}
      bind:selected
      {inspect}
      {openStatistics}
    />{/if}
</div>

<style>
  .radar-clarity .dial-sweep {
    animation: none;
    transform: rotate(0deg);
    will-change: auto;
    background: conic-gradient(
      from 0deg,
      transparent 0deg 332deg,
      rgba(var(--sweep-rgb), 0.015) 336deg,
      rgba(var(--sweep-rgb), 0.07) 350deg,
      rgba(var(--sweep-rgb), 0.15) 359deg,
      transparent 360deg
    );
  }
  .radar-clarity .dial-sweep:global([data-sweep-state='running']) {
    will-change: transform;
  }
  .radar-clarity .dial-sweep::after {
    width: 1px;
    background: linear-gradient(transparent 12%, rgba(var(--sweep-rgb), 0.45));
  }
  .radar-clarity .radar-blip {
    transition:
      background-color var(--motion-fast) var(--ease-standard),
      border-color var(--motion-fast) var(--ease-standard);
  }
  .radar-clarity .radar-blip:hover {
    background: var(--hover);
    border-color: var(--marker-color, var(--strong-border));
  }
  .radar-clarity .radar-blip[aria-pressed='true'],
  .radar-clarity .radar-blip[aria-pressed='true']:hover {
    background: var(--selection);
    border-color: var(--ink);
  }
  .radar-clarity .radar-blip:focus-visible {
    transition: none;
  }
  .radar-clarity .radar-stage {
    min-height: 360px;
  }
  .radar-guidance {
    flex: 1 1 100%;
    margin: 0;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
  }
  .roster-clear {
    margin-bottom: var(--space-3);
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }
  .radar-focus {
    margin-top: var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
    font-size: var(--text-body);
    line-height: 1.6;
  }
  .radar-focus p {
    color: var(--muted);
    margin: var(--space-2) 0;
  }
  .radar-focus > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .overview-grid.radar-clarity.agent-launcher {
    grid-template-columns: minmax(0, 1fr);
  }

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
  @media (max-height: 700px) {
    .radar-clarity .radar-stage {
      align-self: start;
      min-height: 280px;
    }
    .radar-clarity .radar-dial {
      width: min(216px, calc(100cqw - 64px));
      height: min(216px, calc(100cqw - 64px));
    }
    .radar-clarity .roster-items {
      min-height: 0;
    }
  }
</style>
