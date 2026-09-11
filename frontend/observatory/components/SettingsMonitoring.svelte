<script lang="ts">
  import { t } from '../runtime/i18n';

  import { confirmed, invoke, type Host, type RecordData } from '../runtime/host';
  import SettingsGroup from './SettingsGroup.svelte';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  let {
    form = $bindable(),
    patterns = $bindable(),
    ignored = $bindable(),
    patternInput = $bindable(),
    host,
  }: {
    form: RecordData;
    patterns: string;
    ignored: string;
    patternInput: HTMLTextAreaElement | undefined;
    host: Host | null;
  } = $props();
</script>

<SettingsGroup
  title={$t('Collection & notifications')}
  description={$t(
    'Control process scanning and desktop notifications. Changes apply after saving.',
  )}
>
  <label class="setting range"
    ><span
      >{$t('Scan interval')}
      <output
        >{Number.isFinite(Number(form.scanIntervalSec ?? 10))
          ? String(form.scanIntervalSec ?? 10) + ' s'
          : '\u2014'}</output
      ><small
        >{$t(
          'Shorter intervals update processes more often and use more resources. File and network sources have their own collection timing.',
        )}</small
      ></span
    ><input
      aria-label={$t('Scan interval (seconds)')}
      type="range"
      min="1"
      max={Math.max(60, Number(form.scanIntervalSec ?? 10))}
      step="1"
      value={Number(form.scanIntervalSec ?? 10)}
      oninput={(e) => (form.scanIntervalSec = Number(e.currentTarget.value))}
    /></label
  >
  <div class="setting">
    <span>{$t('Exact interval')}<small>{$t('Enter a positive number of seconds.')}</small></span>
    <input
      class="interval-number"
      aria-label={$t('Exact scan interval (seconds)')}
      aria-invalid={!Number.isFinite(Number(form.scanIntervalSec ?? 10)) ||
        Number(form.scanIntervalSec ?? 10) <= 0}
      type="number"
      min="1"
      step="1"
      value={Number(form.scanIntervalSec ?? 10)}
      oninput={(event) => (form.scanIntervalSec = event.currentTarget.valueAsNumber)}
    />
  </div>
  <div class="presets" role="group" aria-label={$t('Scan interval presets')}>
    {#each [1, 5, 10, 30] as seconds (seconds)}<button
        class="button"
        aria-pressed={Number(form.scanIntervalSec ?? 10) === seconds}
        onclick={() => (form.scanIntervalSec = seconds)}
        >{seconds} {$t('s')}{seconds === 10 ? $t(' (default)') : ''}</button
      >{/each}
  </div>
  <div class="setting">
    <label class="switch"
      ><input
        type="checkbox"
        checked={form.notificationsEnabled === true}
        onchange={(e) => (form.notificationsEnabled = e.currentTarget.checked)}
      />{$t('Notifications')}</label
    ><Action action={async () => confirmed(await invoke(host, 'testNotification'))}
      ><Icon name="bell" />{$t('Test')}</Action
    >
  </div>
</SettingsGroup>
<SettingsGroup
  title={$t('File coverage')}
  description={$t(
    'Choose which directories the file watcher skips and which additional paths count as sensitive.',
  )}
>
  <label class="setting"
    ><span
      >{$t('Exclude build folders')}<small
        >{$t('Skip common generated folders to reduce file-event noise.')}</small
      ></span
    ><input
      type="checkbox"
      aria-label={$t('Exclude build folders')}
      checked={form.ignoreCommonBuildDirs === true}
      onchange={(e) => (form.ignoreCommonBuildDirs = e.currentTarget.checked)}
    /></label
  >
  <label class="setting-stack"
    >{$t('Additional exclusions')}<textarea
      aria-label={$t('Additional exclusions')}
      rows="3"
      maxlength="10000"
      bind:value={ignored}
    ></textarea><small
      >{$t('One directory path per line. Empty means no additional exclusions.')}</small
    ></label
  >
  <label class="setting-stack"
    >{$t('Sensitive paths')}<textarea
      bind:this={patternInput}
      aria-label={$t('Sensitive paths')}
      rows="3"
      maxlength="10000"
      bind:value={patterns}
    ></textarea><small
      >{$t(
        'One regular expression per line. Adds sensitive-path matches; built-in rules remain active.',
      )}</small
    ></label
  >
</SettingsGroup>

<style>
  .interval-number {
    width: 110px;
    min-width: 0;
  }
</style>
