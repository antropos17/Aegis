<script lang="ts">
  import { record, type Telemetry, type RecordData } from '../runtime/host';
  import { statisticsValue } from '../runtime/statistics-metrics';
  import { fieldLabel } from '../runtime/detail-fields';
  let { telemetry }: { telemetry: Telemetry } = $props();
  let health = $derived(record(telemetry.stats.appHealth));
  let sensors = $derived(
    Object.entries(record(record(health.sensors).byId)).map(
      ([id, value]): RecordData & { id: string } => ({
        id,
        ...record(value),
      }),
    ),
  );
  function time(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? new Date(value).toLocaleTimeString()
      : 'Not observed';
  }
</script>

<section class="panel sensor-panel">
  <header>
    <div>
      <h3>Observation sensors</h3>
      <p>Raw sensor state and coverage. Display retention is tracked separately.</p>
    </div>
    <span class="badge">{String(health.state || 'Starting').toLowerCase()}</span>
  </header>
  <div class="sensor-grid">
    {#each sensors as sensor (sensor.id)}
      <article>
        <div class="sensor-heading">
          <h4>{fieldLabel(sensor.id)}</h4>
          <span class:healthy={sensor.state === 'HEALTHY'} class:failed={sensor.state === 'FAILED'}
            >{String(sensor.state || 'Unavailable').toLowerCase()}</span
          >
        </div>
        <dl>
          <div>
            <dt>Last success</dt>
            <dd>{time(sensor.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt>Failures</dt>
            <dd>
              {statisticsValue(
                typeof sensor.consecutiveFailures === 'number' ? sensor.consecutiveFailures : null,
              )}
            </dd>
          </div>
          <div>
            <dt>Observed loss</dt>
            <dd>
              {statisticsValue(typeof sensor.lossCount === 'number' ? sensor.lossCount : null)}
            </dd>
          </div>
        </dl>
        {#if sensor.detail || sensor.lastError}<p class="sensor-note">
            {String(sensor.detail || sensor.lastError)}
          </p>{/if}
      </article>
    {:else}<p class="muted">Sensor health has not been delivered yet.</p>{/each}
  </div>
</section>

<style>
  .sensor-panel {
    padding: 18px;
  }
  header {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 18px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 550;
  }
  header p {
    color: var(--muted);
    font-size: 11px;
    margin: 6px 0 0;
    line-height: 1.5;
  }
  .sensor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  article {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 13px;
    min-width: 0;
  }
  .sensor-heading {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }
  h4 {
    font-size: 12px;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .sensor-heading span {
    color: var(--muted);
    font-size: 10px;
  }
  .sensor-heading .healthy {
    color: var(--green);
  }
  .sensor-heading .failed {
    color: var(--red);
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin: 14px 0 0;
  }
  dt {
    color: var(--muted);
    font-size: 10px;
  }
  dd {
    margin: 5px 0 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .sensor-note {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
</style>
