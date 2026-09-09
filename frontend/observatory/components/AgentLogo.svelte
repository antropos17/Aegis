<script lang="ts">
  import { logo, invertOnDark } from '../runtime/artwork';
  import Icon from './Icon.svelte';
  let { id = '', name = '', size = 24 }: { id?: string; name?: string; size?: number } = $props();
  let src = $derived(
    logo(id.toLowerCase().replaceAll(' ', '-')) ?? logo(name.toLowerCase().replaceAll(' ', '-')),
  );
  let cursor = $derived(src?.endsWith('/cursor.png'));
</script>

<span class="agent-mark" style={`--logo-size:${size}px`}
  >{#if cursor}<img
      class="logo-dark"
      src="assets/agents/cursor-dark.svg"
      alt=""
      width={size}
      height={size}
    /><img
      class="logo-light"
      src="assets/agents/cursor-light.svg"
      alt=""
      width={size}
      height={size}
    />{:else if src}<img
      {src}
      class:invert-dark={invertOnDark(src)}
      alt=""
      width={size}
      height={size}
    />{:else}<Icon name="agents" />{/if}</span
>

<style>
  :global(:root[data-theme^='dark']) .invert-dark {
    filter: invert(1);
  }
  .agent-mark {
    display: inline-flex;
    flex-shrink: 0;
    width: calc(var(--logo-size) * var(--ui-scale));
    height: calc(var(--logo-size) * var(--ui-scale));
    align-items: center;
    justify-content: center;
  }
  img {
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
  }
</style>
