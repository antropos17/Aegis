<script>
  /** @type {{ lines?: number, style?: 'card' | 'list' }} */
  let { lines = 3, style = 'card' } = $props();
</script>

<div class="skeleton skeleton--{style}">
  {#each Array(lines) as _, i (i)}
    <div class="skeleton__line" style="animation-delay: {i * 100}ms"></div>
  {/each}
</div>

<style>
  .skeleton {
    padding: var(--fancy-space-md);
  }

  .skeleton__line {
    height: 12px;
    border-radius: 6px;
    background: var(--fancy-surface);
    margin-bottom: 8px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .skeleton--card .skeleton__line:first-child {
    width: 40%;
    height: 16px;
  }

  .skeleton--card .skeleton__line:nth-child(2) {
    width: 70%;
  }

  .skeleton--card .skeleton__line:nth-child(3) {
    width: 55%;
  }

  .skeleton--list .skeleton__line {
    width: 90%;
  }

  .skeleton--list .skeleton__line:nth-child(odd) {
    width: 75%;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.6;
    }
  }
</style>
