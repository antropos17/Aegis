<script lang="ts">
  import { t } from '../runtime/i18n';
  import { singleKeyShortcuts } from '../runtime/keyboard-shortcuts';
</script>

<label class="setting">
  <span>
    {$t('Single-key shortcuts')}
    <small
      >{$t('Allow S, T and 1–5 outside text fields. Turn off to avoid accidental actions.')}</small
    >
    <small>{$t('Saved immediately on this device. Ctrl K remains available.')}</small>
  </span>
  <input
    type="checkbox"
    aria-label={$t('Single-key shortcuts')}
    bind:checked={$singleKeyShortcuts}
  />
</label>
