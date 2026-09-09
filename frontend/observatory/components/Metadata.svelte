<script lang="ts">
  import { informationFields, type InfoField } from '../runtime/detail-fields';
  let { value }: { value: unknown } = $props();
  let fields = $derived(informationFields(value));
</script>

{#snippet entries(items: InfoField[])}
  {@const simple = items.filter((field) => !field.children && !field.items)}
  {#if simple.length}<dl class="attribute-list metadata">
      {#each simple as field (field.key)}<div class="attribute">
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>{/each}
    </dl>{/if}
  {#each items.filter((field) => field.items) as field (field.key)}
    <div class="attribute-group">
      <h4>{field.label}</h4>
      <ul class="attribute-tags">
        {#each field.items ?? [] as value, i (i)}<li>{value}</li>{:else}<li>
            None recorded
          </li>{/each}
      </ul>
    </div>
  {/each}
  {#each items.filter((field) => field.children) as field (field.key)}
    <details class="attribute-group">
      <summary><span>{field.label}</span><small>{field.children?.length} fields</small></summary>
      <div class="attribute-group-body">{@render entries(field.children ?? [])}</div>
    </details>
  {/each}
{/snippet}

{#if fields.length}{@render entries(fields)}{:else}<p class="entity-note">
    No additional information recorded.
  </p>{/if}
