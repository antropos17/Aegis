<script lang="ts">
  import { record } from '../runtime/host';
  let { value }: { value: unknown } = $props();
  let fields = $derived(
    Object.entries(record(value)).filter(
      ([key]) => !/api.?key|secret|password|authorization/i.test(key),
    ),
  );
  function display(value: unknown): string {
    if (value === null || value === undefined) return 'Unavailable';
    if (typeof value === 'object')
      return JSON.stringify(
        value,
        (key, val: unknown) =>
          /api.?key|secret|password|authorization/i.test(key) ? undefined : val,
        2,
      );
    return String(value);
  }
</script>

<dl class="metadata">
  {#each fields as [key, val] (key)}<dt>{key}</dt>
    <dd>{display(val)}</dd>{/each}
</dl>

<style>
  .metadata {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) minmax(0, 3fr);
    gap: 10px 16px;
  }
  dt {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 12px/1.6 var(--mono);
  }
  @media (max-width: 600px) {
    .metadata {
      grid-template-columns: 1fr;
    }
  }
</style>
