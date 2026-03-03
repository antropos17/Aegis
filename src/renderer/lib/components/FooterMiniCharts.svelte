<!--
  FooterMiniCharts.svelte — Mini sparkline charts for footer [F3.2]
  Shows CPU% and Memory MB with 60-second history ring buffers.
  Reuses Sparkline.svelte (F2.1) at compact size.
-->
<script lang="ts">
  import { resourceUsage } from '../stores/ipc.js';
  import Sparkline from './Sparkline.svelte';
  import { createRingBuffer } from '../utils/ring-buffer';

  /** Ring buffers: 60 data points = 60 seconds of history */
  const HISTORY_SIZE = 60;
  const cpuHistory = createRingBuffer(HISTORY_SIZE);
  const memHistory = createRingBuffer(HISTORY_SIZE);

  /** Reactive arrays fed to Sparkline (rebuilt each push) */
  let cpuData = $state<number[]>([]);
  let memData = $state<number[]>([]);

  /** Current display values */
  let cpuPct = $state(0);
  let memMB = $state(0);

  /** CPU delta tracking (same approach as Footer.svelte) */
  let lastCpuUser = 0;
  let lastCpuSystem = 0;
  let lastCpuTime = 0;

  /** Sample resource usage every second into ring buffers */
  $effect(() => {
    const id = setInterval(() => {
      const u = $resourceUsage;
      if (!u || !u.cpuUser) return;

      // CPU percentage (delta-based)
      const now = Date.now();
      const elapsed = (now - lastCpuTime) * 1000;
      if (elapsed > 0 && lastCpuTime > 0) {
        const delta = u.cpuUser - lastCpuUser + (u.cpuSystem - lastCpuSystem);
        cpuPct = Math.min(100, Math.round((delta / elapsed) * 100));
      }
      lastCpuUser = u.cpuUser;
      lastCpuSystem = u.cpuSystem;
      lastCpuTime = now;

      // Memory
      const mem = typeof u.memMB === 'number' ? u.memMB : 0;
      memMB = mem;

      // Push into ring buffers
      cpuHistory.push(cpuPct);
      memHistory.push(mem);

      // Rebuild reactive arrays
      cpuData = cpuHistory.toArray();
      memData = memHistory.toArray();
    }, 1000);

    return () => clearInterval(id);
  });

  /** Formatted display strings */
  let cpuDisplay = $derived(cpuPct + '%');
  let memDisplay = $derived(memMB + ' MB');
</script>

<div class="mini-charts">
  <div class="mini-chart-item">
    <span class="mini-label">CPU</span>
    <span class="mini-value cpu">{cpuDisplay}</span>
    <div class="mini-sparkline">
      <Sparkline
        data={cpuData}
        color="var(--fancy-accent)"
        width={60}
        height={16}
        showArea={false}
        strokeWidth={1}
      />
    </div>
  </div>

  <div class="mini-chart-item">
    <span class="mini-label">MEM</span>
    <span class="mini-value mem">{memDisplay}</span>
    <div class="mini-sparkline">
      <Sparkline
        data={memData}
        color="var(--fancy-info)"
        width={60}
        height={16}
        showArea={false}
        strokeWidth={1}
      />
    </div>
  </div>
</div>

<style>
  .mini-charts {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
  }

  .mini-chart-item {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
  }

  .mini-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .mini-value {
    font: var(--md-sys-typescale-label-medium);
    font-family: var(--fancy-font-mono);
    font-variant-numeric: tabular-nums;
    min-width: 42px;
    text-align: right;
  }

  .mini-value.cpu {
    color: var(--fancy-accent);
  }

  .mini-value.mem {
    color: var(--fancy-info);
  }

  .mini-sparkline {
    width: 60px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
