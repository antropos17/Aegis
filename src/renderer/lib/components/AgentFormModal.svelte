<script>
  import { t } from '../i18n/index.js';
  import { CATEGORIES } from '../utils/agent-crud-utils.ts';

  /**
   * @type {{ mode: 'add' | 'edit' | 'delete', form: import('../utils/agent-crud-utils.ts').AgentFormData, agentName: string, onclose: () => void, onsave: () => void, ondelete: () => void }}
   */
  let { mode, form, agentName, onclose, onsave, ondelete } = $props();
</script>

<div
  class="overlay"
  role="button"
  tabindex="-1"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <div
    class="modal"
    role="dialog"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    {#if mode === 'delete'}
      <h3 class="modal-title">{$t('rules.database.crud.delete_title')}</h3>
      <p class="modal-text">
        {$t('rules.database.crud.delete_confirm', { name: agentName })}
      </p>
      <div class="modal-actions">
        <button class="crud-btn" onclick={onclose}>{$t('rules.database.crud.cancel')}</button>
        <button class="crud-btn danger" onclick={ondelete}
          >{$t('rules.database.crud.delete')}</button
        >
      </div>
    {:else}
      <h3 class="modal-title">
        {mode === 'add'
          ? $t('rules.database.crud.add_title')
          : $t('rules.database.crud.edit_title')}
      </h3>
      <div class="modal-form">
        <label class="field"
          ><span>{$t('rules.database.crud.name')}</span>
          <input
            type="text"
            bind:value={form.displayName}
            placeholder={$t('rules.database.crud.name_placeholder')}
          /></label
        >
        <label class="field"
          ><span>{$t('rules.database.crud.process_name')}</span>
          <input
            type="text"
            bind:value={form.processName}
            placeholder={$t('rules.database.crud.process_placeholder')}
          /></label
        >
        <label class="field"
          ><span>{$t('rules.database.crud.category')}</span>
          <select bind:value={form.category}>
            {#each CATEGORIES as [val, label] (val)}
              <option value={val}>{label}</option>
            {/each}
          </select></label
        >
        <label class="field"
          ><span>{$t('rules.database.crud.risk_level')}</span>
          <select bind:value={form.riskProfile}>
            <option value="low">{$t('rules.database.crud.risk_low')}</option>
            <option value="medium">{$t('rules.database.crud.risk_medium')}</option>
            <option value="high">{$t('rules.database.crud.risk_high')}</option>
          </select></label
        >
        <label class="field"
          ><span>{$t('rules.database.crud.description')}</span>
          <input
            type="text"
            bind:value={form.description}
            placeholder={$t('rules.database.crud.desc_placeholder')}
          /></label
        >
      </div>
      <div class="modal-actions">
        <button class="crud-btn" onclick={onclose}>{$t('rules.database.crud.cancel')}</button>
        <button class="crud-btn primary" onclick={onsave}
          >{mode === 'add' ? $t('rules.database.crud.add') : $t('rules.database.crud.save')}</button
        >
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--md-sys-color-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-large);
    padding: var(--aegis-space-10);
    min-width: calc(360px * var(--aegis-ui-scale));
    max-width: 460px;
  }
  .modal-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0 0 var(--aegis-space-8);
  }
  .modal-text {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
    margin: 0 0 var(--aegis-space-9);
  }
  .modal-form {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-6);
    margin-bottom: var(--aegis-space-9);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-2);
  }
  .field span {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
  .field input,
  .field select {
    font: var(--md-sys-typescale-body-medium);
    padding: var(--aegis-space-4) var(--aegis-space-5);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface);
    outline: none;
  }
  .field input:focus,
  .field select:focus {
    border-color: var(--md-sys-color-primary);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--aegis-space-4);
  }
  .crud-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: calc(7px * var(--aegis-ui-scale)) var(--aegis-space-7);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .crud-btn:hover {
    background: var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    border-color: var(--aegis-border-hover);
  }
  .crud-btn.primary {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-primary);
  }
  .crud-btn.danger {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
    border-color: var(--md-sys-color-error);
  }
</style>
