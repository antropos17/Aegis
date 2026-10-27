<script lang="ts">
  import { language, LANGUAGE_OPTIONS, t } from '../runtime/i18n';
  import { languagePersisted } from '../../../src/renderer/lib/i18n/index.js';
</script>

<label class="setting">
  <span
    >{$t('Language')}<small role="status"
      >{$t(
        $languagePersisted
          ? 'Language is saved immediately on this device.'
          : 'Language is available for this session only. Could not save on this device.',
      )}</small
    ></span
  >
  <select aria-label={$t('Language')} bind:value={$language}>
    {#each LANGUAGE_OPTIONS as option (option.code)}
      <option value={option.code} lang={option.code === 'pt' ? 'pt-BR' : 'en'}
        >{option.label}</option
      >
    {/each}
  </select>
</label>
