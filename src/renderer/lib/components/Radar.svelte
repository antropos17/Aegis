<script>
  import { enrichedAgents } from '../stores/risk.js';
  import { theme } from '../stores/theme.js';

  let canvas, ctx, animId;
  let tk = {},
    sweepRgb = '',
    lineRgb = '',
    labelRgb = '';

  function resolveTokens(el) {
    const s = getComputedStyle(el);
    const g = (v) => s.getPropertyValue(v).trim();
    tk = {
      tertiary: g('--md-sys-color-tertiary'),
      secondary: g('--md-sys-color-secondary'),
      error: g('--md-sys-color-error'),
    };
    sweepRgb = g('--radar-sweep-rgb');
    lineRgb = g('--radar-line-rgb');
    labelRgb = g('--radar-label-rgb');
  }

  // ═══ COLORS ═══

  function dotColor(grade) {
    if (['A+', 'A', 'B+', 'B'].includes(grade)) return tk.tertiary;
    if (grade === 'C') return tk.secondary;
    return tk.error;
  }

  // ═══ DRAWING ═══

  function drawBackground(cx, cy, r) {
    ctx.strokeStyle = `rgba(${lineRgb}, 0.12)`;
    ctx.lineWidth = 1;
    for (const frac of [0.33, 0.66, 1.0]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = `rgba(${lineRgb}, 0.09)`;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
  }

  function drawSweep(cx, cy, r, angle) {
    const trailLen = Math.PI * 0.4;
    const trailGrad = ctx.createConicGradient(angle - trailLen, cx, cy);
    trailGrad.addColorStop(0, `rgba(${sweepRgb},0)`);
    trailGrad.addColorStop(0.8, `rgba(${sweepRgb},0.12)`);
    trailGrad.addColorStop(1, `rgba(${sweepRgb},0.3)`);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle - trailLen, angle);
    ctx.closePath();
    ctx.fillStyle = trailGrad;
    ctx.fill();

    const ex = cx + Math.cos(angle) * r;
    const ey = cy + Math.sin(angle) * r;
    const lineGrad = ctx.createLinearGradient(cx, cy, ex, ey);
    lineGrad.addColorStop(0, `rgba(${sweepRgb},0)`);
    lineGrad.addColorStop(1, `rgba(${sweepRgb},0.5)`);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawAgentDots(cx, cy, r) {
    // Group by name — one dot per agent
    const byName = new Map();
    for (const agent of $enrichedAgents) {
      const prev = byName.get(agent.name);
      if (!prev || (agent.riskScore || 0) > (prev.riskScore || 0)) {
        byName.set(agent.name, agent);
      }
    }

    for (const agent of byName.values()) {
      const score = Math.min(agent.riskScore || 0, 100);
      const dist = (0.2 + (score / 100) * 0.75) * r;
      let hash = 0;
      for (let i = 0; i < (agent.name?.length || 0); i++) {
        hash = (hash * 31 + agent.name.charCodeAt(i)) | 0;
      }
      const angle = (Math.abs(hash) * 2.654) % (Math.PI * 2);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const color = dotColor(agent.trustGrade);

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${lineRgb}, 0.5)`;
      ctx.fill();

      ctx.font = "500 9px 'DM Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${labelRgb}, 0.8)`;
      ctx.fillText(agent.name?.split(' ')[0] || '', x, y + 14);
    }
  }

  function drawCenter(cx, cy) {
    ctx.font = "600 11px 'Outfit', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${labelRgb}, 0.7)`;
    ctx.fillText('AEGIS', cx, cy);
  }

  // ═══ ANIMATION LOOP ═══

  function render(timestamp) {
    animId = requestAnimationFrame(render);
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const dW = canvas.clientWidth;
    const dH = canvas.clientHeight;
    if (dW <= 0 || dH <= 0) return;

    if (canvas.width !== dW * dpr || canvas.height !== dH * dpr) {
      canvas.width = dW * dpr;
      canvas.height = dH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.clearRect(0, 0, dW, dH);

    const cx = dW / 2;
    const cy = dH / 2;
    const r = Math.min(cx, cy) - 4;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const angle = ((timestamp % 4000) / 4000) * Math.PI * 2 - Math.PI / 2;

    drawBackground(cx, cy, r);
    drawSweep(cx, cy, r, angle);
    drawAgentDots(cx, cy, r);
    drawCenter(cx, cy);

    ctx.restore();
  }

  $effect(() => {
    $theme; // re-resolve tokens on theme change
    ctx = canvas.getContext('2d');
    resolveTokens(canvas);
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  });
</script>

<div class="radar-wrap">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .radar-wrap {
    --radar-sweep-rgb: 122, 138, 158;
    --radar-line-rgb: 255, 255, 255;
    --radar-label-rgb: 232, 230, 226;
    aspect-ratio: 1 / 1;
    width: 100%;
    max-height: 380px;
    max-width: 380px;
    background: transparent;
    border-radius: var(--md-sys-shape-corner-medium);
    overflow: hidden;
  }

  :global([data-theme='light']) .radar-wrap {
    --radar-line-rgb: 0, 0, 0;
    --radar-label-rgb: 30, 30, 30;
    --radar-sweep-rgb: 60, 80, 100;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
