<script lang="ts">
  import { icons } from '../runtime/icons';
  let { name, class: className = '' }: { name: string; class?: string } = $props();
  const parts = $derived(Object.hasOwn(icons, name) ? icons[name] : icons.file);
</script>

<svg class={['icon', className]} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
  >{#each parts as part, i (i)}<svelte:element this={part.tag} {...part.attrs} />{/each}</svg
>
