<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { RecordData } from '../runtime/host';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsLanguage from './SettingsLanguage.svelte';
  let {
    form = $bindable(),
    contrast = $bindable(),
    motion = $bindable(),
  }: {
    form: RecordData;
    contrast: boolean;
    motion: boolean;
  } = $props();
</script>

<SettingsGroup
  title={$t('Display & accessibility')}
  description={$t(
    'Theme and motion preview immediately. Save to keep them; discard to restore your saved preferences.',
  )}
>
  <label class="setting"
    ><span
      >{$t('Theme')}<small>{$t('Choose a light, dark or high-contrast interface.')}</small></span
    ><select
      aria-label={$t('Theme')}
      value={(form.darkMode ? 'dark' : 'light') + (contrast ? '-hc' : '')}
      onchange={(e) => {
        const theme = e.currentTarget.value;
        form.darkMode = theme.startsWith('dark');
        contrast = theme.endsWith('-hc');
        document.documentElement.dataset.theme = theme;
      }}
      ><option value="dark">{$t('Dark')}</option><option value="light">{$t('Light')}</option><option
        value="dark-hc">{$t('Dark, high contrast')}</option
      ><option value="light-hc">{$t('Light, high contrast')}</option></select
    ></label
  >
  <div class="setting">
    <span>{$t('Scale')}<small>{$t('The workspace uses a fixed 100% interface size.')}</small></span>
    <output aria-label={$t('Interface scale')}>100%</output>
  </div>
  <label class="setting"
    ><span
      >{$t('Animations')}<small
        >{$t('Radar motion and visual feedback. Reduced motion keeps the data available.')}</small
      ></span
    ><input
      aria-label={$t('Animations')}
      type="checkbox"
      bind:checked={motion}
      onchange={(event) => {
        document.documentElement.dataset.motion = event.currentTarget.checked ? 'full' : 'reduce';
      }}
    /></label
  >
  <SettingsLanguage />
</SettingsGroup>
