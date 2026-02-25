<script>
  import { events, network } from '../stores/ipc.js';

  const PAD = 12;
  const DOT_R = 4;
  const H = 40;
  const MID = H / 2;

  function getSeverity(ev) {
    if (ev._type === 'network') return ev.flagged ? 'high' : 'low';
    if (ev._denied) return 'critical';
    if (ev.sensitive) return 'high';
    if (ev.action === 'deleted') return 'medium';
    return 'low';
  }

  function sevColor(sev) {
    if (sev === 'critical') return 'var(--md-sys-color-error)';
    if (sev === 'high') return 'var(--md-sys-color-secondary)';
    if (sev === 'medium') return 'var(--md-sys-color-primary)';
    return 'var(--md-sys-color-on-surface-variant)';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  let width = $state(600);

  let dots = $derived.by(() => {
    const fileEvs = $events.map((ev) => ({ ...ev, _type: 'file' }));
    const netEvs = $network.map((conn) => ({
      agent: conn.agent || 'Unknown',
      timestamp: conn.timestamp || Date.now(),
      _type: 'network',
      flagged: !!conn.flagged,
    }));
    const all = [...fileEvs, ...netEvs]
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-100);

    if (all.length === 0) return [];

    const minT = all[0].timestamp || 0;
    const maxT = all[all.length - 1].timestamp || 0;
    const range = maxT - minT || 1;
    const usable = width - PAD * 2;

    return all.map((ev) => {
      const sev = getSeverity(ev);
      return {
        x: PAD + (((ev.timestamp || 0) - minT) / range) * usable,
        color: sevColor(sev),
        tip: `${formatTime(ev.timestamp)} | ${ev.agent} | ${ev._type} | ${sev}`,
      };
    });
  });
</script>

<div class="timeline" bind:clientWidth={width}>
  <svg {width} height={H}>
    <line
      x1={PAD}
      y1={MID}
      x2={width - PAD}
      y2={MID}
      stroke="var(--md-sys-color-outline)"
      stroke-width="1"
    />
    {#each dots as dot, i (i)}
      <circle cx={dot.x} cy={MID} r={DOT_R} fill={dot.color} opacity="0.85">
        <title>{dot.tip}</title>
      </circle>
    {/each}
  </svg>
</div>

<style>
  .timeline {
    width: 100%;
    height: 40px;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-small);
    overflow: hidden;
  }

  svg {
    display: block;
  }

  circle {
    transition: opacity var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  circle:hover {
    opacity: 1;
    filter: brightness(1.3);
  }
</style>
