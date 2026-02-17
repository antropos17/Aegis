/**
 * @file radar-draw.js - Canvas drawing functions for radar background, sweep arm,
 * center core, and system nodes.
 * Depends on: theme.js (isDark), radar-state.js (RADAR_NODES, radarState, THREAT_COLORS, degToRad).
 * @since 0.1.0
 */

/** Draw the radar background with gradient, concentric rings, and crosshairs.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy @param {number} r
 * @since 0.1.0 */
function drawRadarBackground(ctx, cx, cy, r) {
  const dark = isDark();
  const grad = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.15, r * 0.1, cx, cy, r);
  grad.addColorStop(0, dark ? '#1a1a1e' : '#EEF1F6');
  grad.addColorStop(0.5, dark ? '#141416' : '#E2E6EE');
  grad.addColorStop(1, dark ? '#0c0c0e' : '#D0D6E0');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  const ringRadii = [0.25, 0.5, 0.75, 1.0];
  for (const frac of ringRadii) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(120, 140, 165, 0.45)';
    ctx.lineWidth = frac === 1.0 ? 1.5 : 1;
    ctx.stroke();
  }

  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.03)' : 'rgba(120, 140, 165, 0.2)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
}

/** Draw the rotating sweep arm with gradient trail and tip dot.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {number} angle - Current sweep angle in radians.
 * @since 0.1.0 */
function drawSweepArm(ctx, cx, cy, r, angle) {
  const trailSteps = 40;
  const trailLength = Math.PI * 0.5;
  for (let i = 0; i < trailSteps; i++) {
    const frac = i / trailSteps;
    const a0 = angle - trailLength * (1 - frac);
    const a1 = angle - trailLength * (1 - (frac + 1 / trailSteps));
    const alpha = frac * frac * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r * 0.95, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `rgba(122, 138, 158, ${alpha})`;
    ctx.fill();
  }

  const lineGrad = ctx.createLinearGradient(
    cx, cy,
    cx + Math.cos(angle) * r * 0.95,
    cy + Math.sin(angle) * r * 0.95
  );
  lineGrad.addColorStop(0, 'rgba(122, 138, 158, 0.9)');
  lineGrad.addColorStop(1, 'rgba(122, 138, 158, 0.15)');
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * r * 0.95, cy + Math.sin(angle) * r * 0.95);
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.stroke();

  const tipX = cx + Math.cos(angle) * r * 0.93;
  const tipY = cy + Math.sin(angle) * r * 0.93;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(122, 138, 158, 0.85)';
  ctx.fill();
}

/** Draw the center core circle with threat-level glow and label.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {string} threatLevel @param {string} threatLabel
 * @since 0.1.0 */
function drawCenterCore(ctx, cx, cy, r, threatLevel, threatLabel) {
  const coreR = r * 0.18;
  const colors = THREAT_COLORS[threatLevel] || THREAT_COLORS.green;

  const glowGrad = ctx.createRadialGradient(cx, cy, coreR * 0.3, cx, cy, coreR * 3);
  glowGrad.addColorStop(0, colors.glow);
  glowGrad.addColorStop(0.5, colors.glow.replace(/[\d.]+\)$/, '0.08)'));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  const dark = isDark();
  const coreGrad = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, coreR * 0.1, cx, cy, coreR);
  coreGrad.addColorStop(0, dark ? colors.core.replace('0.85', '0.95') : colors.core);
  coreGrad.addColorStop(1, colors.core.replace('0.85', '0.7'));
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  ctx.font = '800 11px "Outfit", sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(threatLabel, cx, cy);
}

/** Draw the eight system nodes around the radar perimeter with pulse effects.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {number} now - Current timestamp (Date.now()).
 * @since 0.1.0 */
function drawSystemNodes(ctx, cx, cy, r, now) {
  const dark = isDark();
  const nodeR = r * 0.85;
  const nodeSize = 18;

  for (const node of RADAR_NODES) {
    const a = degToRad(node.angle);
    const nx = cx + Math.cos(a) * nodeR;
    const ny = cy + Math.sin(a) * nodeR;

    // Pulse effect
    const pulse = radarState.nodePulses[node.id];
    let pulseIntensity = 0;
    if (pulse) {
      const elapsed = now - pulse.timestamp;
      if (elapsed < 1500) {
        pulseIntensity = Math.max(0, 1 - elapsed / 1500);
      } else {
        delete radarState.nodePulses[node.id];
      }
    }

    // Node background
    ctx.beginPath();
    ctx.arc(nx, ny, nodeSize, 0, Math.PI * 2);
    const nodeFill = ctx.createRadialGradient(nx - 4, ny - 4, 2, nx, ny, nodeSize);
    nodeFill.addColorStop(0, dark ? '#222226' : '#F5F7FA');
    nodeFill.addColorStop(1, dark ? '#141416' : '#D8DEE8');
    ctx.fillStyle = nodeFill;
    ctx.fill();

    // Border ring
    ctx.beginPath();
    ctx.arc(nx, ny, nodeSize, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(140,155,175,0.25)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Pulse rings
    if (pulseIntensity > 0) {
      const pulseRing = nodeSize + 8 * (1 - pulseIntensity);
      ctx.beginPath();
      ctx.arc(nx, ny, pulseRing, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(122, 138, 158, ${pulseIntensity * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      const pulseR2 = nodeSize + 16 * (1 - pulseIntensity);
      ctx.beginPath();
      ctx.arc(nx, ny, pulseR2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(122, 138, 158, ${pulseIntensity * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Icon
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? '#8896A6' : '#3D4852';
    ctx.fillText(node.icon, nx, ny);

    // Label below
    ctx.font = '600 8px "DM Sans", sans-serif';
    ctx.fillStyle = dark ? '#5a6070' : '#5A6577';
    ctx.fillText(node.label, nx, ny + nodeSize + 10);
  }
}
