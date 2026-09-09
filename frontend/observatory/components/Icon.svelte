<script lang="ts">
  import { icons } from '../runtime/icons';
  let { name, class: className = '' }: { name: string; class?: string } = $props();
</script>

<svg class={['icon', className]} viewBox="0 0 24 24" aria-hidden="true"
  >{#each icons[name] || icons.file as part, i (i)}<svelte:element
      this={part.tag}
      {...part.attrs}
    />{/each}</svg
>
