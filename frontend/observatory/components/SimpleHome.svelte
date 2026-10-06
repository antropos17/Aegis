<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { RecordData, Telemetry } from '../runtime/host';
  import Agents from './Agents.svelte';
  import Events from './Events.svelte';
  import Icon from './Icon.svelte';

  let {
    telemetry,
    inspect,
    navigate,
    openStatistics,
    paused = false,
    visible = true,
  }: {
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    navigate: (_view: string) => void | Promise<void>;
    openStatistics: (_agent: string) => void;
    paused?: boolean;
    visible?: boolean;
  } = $props();
  const id = $props.id();
</script>

<div class="simple-home">
  <section aria-labelledby={id + '-agents'}>
    <div class="section-head">
      <div>
        <h2 id={id + '-agents'}>{$t('Observed agents')}</h2>
        <p>
          {$t(
            telemetry.ready
              ? telemetry.stale || paused
                ? 'Last reliable agents are retained. Open an agent to review its activity and risk.'
                : 'Open an agent to review its activity, risk and available process controls.'
              : 'Waiting for a reliable process observation. Running agents are not yet known.',
          )}
        </p>
      </div>
      <button class="button" onclick={() => navigate('guide')}
        ><Icon name="compass" />{$t('Start here')}</button
      >
    </div>
    <Agents {telemetry} {inspect} {openStatistics} advanced={false} />
  </section>
  <section aria-labelledby={id + '-activity'}>
    <div class="section-head">
      <div>
        <h2 id={id + '-activity'}>{$t('Recent activity')}</h2>
        <p>{$t('File observations and connection snapshots from this monitoring session.')}</p>
      </div>
      <button class="button" onclick={() => navigate('events')}
        >{$t('Open activity')}<Icon name="chevron" /></button
      >
    </div>
    <Events
      {telemetry}
      {inspect}
      advanced={false}
      combined
      {visible}
      viewPaused={paused}
      showPause={false}
    />
  </section>
</div>

<style>
  .simple-home {
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .section-head > div {
    flex: 1 1 240px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
  }
  p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--text-body);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
</style>
