<script>
  import { enrichedAgents } from '../stores/risk.js';

  let canvas, ctx, animId;
  let tk = {}, sweepRgb = '';

  function resolveTokens(el) {
    const s = getComputedStyle(el);
    const g = (v) => s.getPropertyValue(v).trim();
    tk = { surface: g('--md-sys-color-surface'),
      surfaceContainer: g('--md-sys-color-surface-container'),
      outline: g('--md-sys-color-outline'), outlineVariant: g('--md-sys-color-outline-variant'),
      tertiary: g('--md-sys-color-tertiary'), secondary: g('--md-sys-color-secondary'),
      error: g('--md-sys-color-error') };
    sweepRgb = g('--radar-sweep-rgb');
  }

  // ═══ COLORS ═══

  function dotColor(grade) {
    if (['A+', 'A', 'B+', 'B'].includes(grade)) return tk.tertiary;
    if (grade === 'C') return tk.secondary;
    return tk.error;
  }

  // ═══ DRAWING ═══

  function drawBackground(cx, cy, r) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, tk.surfaceContainer);
    grad.addColorStop(1, tk.surface);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = tk.outline;
    ctx.lineWidth = 1;
    for (const frac of [0.33, 0.66, 1.0]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = tk.outlineVariant;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
  }

  function drawSweep(cx, cy, r, angle) {
    const trailLen = Math.PI * 0.4;
    const trailGrad = ctx.createConicGradient(angle - trailLen, cx, cy);
    trailGrad.addColorStop(0, `rgba(${sweepRgb},0)`);
    trailGrad.addColorStop(0.8, `rgba(${sweepRgb},0.04)`);
    trailGrad.addColorStop(1, `rgba(${sweepRgb},0.08)`);

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
    lineGrad.addColorStop(1, `rgba(${sweepRgb},0.35)`);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawAgentDots(cx, cy, r) {
    for (const agent of $enrichedAgents) {
      const score = Math.min(agent.riskScore || 0, 100);
      const dist = (0.2 + (score / 100) * 0.75) * r;
      const angle = ((agent.pid || 0) * 2.654) % (Math.PI * 2);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const color = dotColor(agent.trustGrade);

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();

      ctx.font = "500 9px 'DM Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(agent.name?.split(' ')[0] || '', x, y + 14);
    }
  }

  function drawCenter(cx, cy) {
    ctx.font = "600 11px 'Outfit', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
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
    --radar-sweep-rgb: 78, 205, 196;
    aspect-ratio: 1 / 1;
    width: 100%;
    background: var(--md-sys-color-surface-container);
    border-radius: var(--md-sys-shape-corner-medium);
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
