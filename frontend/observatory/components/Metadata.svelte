<script lang="ts">
  import { t } from '../runtime/i18n';

  import { informationFields, type InfoField } from '../runtime/detail-fields';
  import Icon from './Icon.svelte';
  const fieldIcons: Record<string, string> = {
    pid: 'cpu',
    ppid: 'cpu',
    instanceId: 'cpu',
    process: 'cpu',
    names: 'cpu',
    file: 'file',
    path: 'file',
    cwd: 'folder',
    configPaths: 'fileConfig',
    domain: 'globe',
    knownDomains: 'globe',
    localIp: 'server',
    remoteIp: 'server',
    localPort: 'network',
    remotePort: 'network',
    knownPorts: 'network',
    timestamp: 'history',
    firstSeen: 'history',
    lastSeen: 'history',
  };
  const fieldIcon = (key: string) => (Object.hasOwn(fieldIcons, key) ? fieldIcons[key] : '');
  let { value }: { value: unknown } = $props();
  let fields = $derived(informationFields(value));
</script>

{#snippet entries(items: InfoField[])}
  {@const simple = items.filter((field) => !field.children && !field.items)}
  {#if simple.length}<dl class="attribute-list metadata">
      {#each simple as field (field.key)}<div class="attribute">
          <dt class="field-name">
            {#if fieldIcon(field.key)}<Icon name={fieldIcon(field.key)} />{/if}{$t(field.label)}
          </dt>
          <dd>{field.value}</dd>
        </div>{/each}
    </dl>{/if}
  {#each items.filter((field) => field.items) as field (field.key)}
    <div class="attribute-group">
      <h4 class="field-name">
        {#if fieldIcon(field.key)}<Icon name={fieldIcon(field.key)} />{/if}{$t(field.label)}
      </h4>
      <ul class="attribute-tags">
        {#each field.items ?? [] as value, i (i)}<li>{value}</li>{:else}<li>
            {$t('None recorded')}
          </li>{/each}
      </ul>
    </div>
  {/each}
  {#each items.filter((field) => field.children) as field (field.key)}
    <details class="attribute-group">
      <summary
        ><span class="field-name"
          >{#if fieldIcon(field.key)}<Icon name={fieldIcon(field.key)} />{/if}{$t(
            field.label,
          )}</span
        ><small>{field.children?.length} {$t('fields')}</small></summary
      >
      <div class="attribute-group-body">{@render entries(field.children ?? [])}</div>
    </details>
  {/each}
{/snippet}

{#if fields.length}{@render entries(fields)}{:else}<p class="entity-note">
    {$t('No additional information recorded.')}
  </p>{/if}

<style>
  .field-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
</style>
