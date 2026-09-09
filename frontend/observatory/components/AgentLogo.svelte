<script lang="ts">
  import { logo } from '../runtime/artwork';
  import Icon from './Icon.svelte';
  let { id = '', name = '' }: { id?: string; name?: string } = $props();
  let src = $derived(logo(id || name.toLowerCase().replaceAll(' ', '-')));
</script>

<span class="agent-mark"
  >{#if src}<img {src} alt="" width="24" height="24" />{:else}<Icon name="agents" />{/if}</span
>

<style>
  .agent-mark {
    display: inline-flex;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
  }
  img {
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
  }
</style>
