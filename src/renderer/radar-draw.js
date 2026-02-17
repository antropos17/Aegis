/**
 * @file radar-draw.js - Solar System canvas drawing: background, core sphere,
 * orbital planets, lightning bolts, sparkles, and flash overlay.
 * Depends on: radar-state.js (ORBITAL_NODES, radarState, THREAT_COLORS).
 * @since 0.2.0
 */

// ── 1. Background with faint elliptical orbit paths ──

/**
 * Draw dark radial gradient background with dashed elliptical orbit paths.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 */
function drawBackground(ctx, cx, cy, r) {
  const grad = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  grad.addColorStop(0, '#1a1a1e');
  grad.addColorStop(0.4, '#141416');
  grad.addColorStop(1, '#0c0c0e');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Faint dashed elliptical orbit paths for each planet
  ctx.save();
  ctx.setLineDash([4, 8]);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (const node of ORBITAL_NODES) {
    const orbitR = r * node.orbitRadius;
    ctx.beginPath();
    ctx.ellipse(cx, cy, orbitR, orbitR * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ── 2. Core Sphere (agent star) ──

/**
 * Draw the central star sphere with ambient waves, solar flares, and agent icon.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} time - performance.now() timestamp
 */
function drawCoreSphere(ctx, cx, cy, r, time) {
  const coreR = r * 0.15;
  const pulse = radarState.corePulse;
  const colors = THREAT_COLORS[radarState.threatLevel] || THREAT_COLORS.green;
  const t = time * 0.001; // seconds

  // Threat glow halo
  const glowGrad = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, coreR * 3.5);
  glowGrad.addColorStop(0, colors.glow);
  glowGrad.addColorStop(0.5, colors.glow.replace(/[\d.]+\)$/, '0.06)'));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 3.5, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // Ambient wave rings (4 expanding / fading rings)
  for (let i = 0; i < 4; i++) {
    const phase = (t * 0.8 + i * 0.7) % 3.0; // 3-second cycle
    const waveR = coreR * (1.0 + phase * 0.8);
    const alpha = Math.max(0, 0.12 - phase * 0.04) * pulse.intensity;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5 - phase * 0.3;
    ctx.stroke();
  }

  // Solar flares (5 bezier arcs rotating slowly around the sphere)
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const flareAngle = t * 0.15 + (i / 5) * Math.PI * 2;
    const flareLen = coreR * (0.5 + 0.3 * Math.sin(t * 0.7 + i * 2.1));
    const fx = cx + Math.cos(flareAngle) * coreR * 0.9;
    const fy = cy + Math.sin(flareAngle) * coreR * 0.9;
    const cpx = cx + Math.cos(flareAngle + 0.3) * (coreR + flareLen);
    const cpy = cy + Math.sin(flareAngle + 0.3) * (coreR + flareLen);
    const ex = cx + Math.cos(flareAngle + 0.5) * coreR * 0.85;
    const ey = cy + Math.sin(flareAngle + 0.5) * coreR * 0.85;

    const flareGrad = ctx.createLinearGradient(fx, fy, cpx, cpy);
    flareGrad.addColorStop(0, `rgba(255,180,60,${0.15 * pulse.intensity})`);
    flareGrad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    ctx.strokeStyle = flareGrad;
    ctx.lineWidth = 2.5 + Math.sin(t + i) * 0.8;
    ctx.stroke();
  }
  ctx.restore();

  // Core sphere body — radial gradient
  const coreGrad = ctx.createRadialGradient(
    cx - coreR * 0.25, cy - coreR * 0.25, coreR * 0.1,
    cx, cy, coreR
  );
  coreGrad.addColorStop(0, colors.core.replace('0.85', '0.95'));
  coreGrad.addColorStop(0.6, colors.core);
  coreGrad.addColorStop(1, colors.core.replace('0.85', '0.6'));
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  // Specular highlight
  const specGrad = ctx.createRadialGradient(
    cx - coreR * 0.3, cy - coreR * 0.3, 0,
    cx - coreR * 0.3, cy - coreR * 0.3, coreR * 0.6
  );
  specGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
  specGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = specGrad;
  ctx.fill();

  // Agent icon or shield in center
  const agent = radarState.selectedAgent;
  if (agent) {
    const db = typeof agentDbMap !== 'undefined' ? agentDbMap[agent] : null;
    const icon = (db && db.icon) || agent.charAt(0).toUpperCase();
    ctx.font = `${Math.round(coreR * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(icon, cx, cy);
  } else {
    // Default shield icon
    ctx.font = `800 ${Math.round(coreR * 0.55)}px "Outfit", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(radarState.threatLabel, cx, cy);
  }
}

// ── 3. Orbital Planets ──

/**
 * Compute planet screen position for a given node.
 * @param {number} cx @param {number} cy @param {number} r
 * @param {{id: string, orbitRadius: number}} node
 * @returns {{px: number, py: number, orbitR: number}}
 */
function getPlanetPos(cx, cy, r, node) {
  const orbit = radarState.orbits[node.id];
  const angle = orbit ? orbit.angle : 0;
  const orbitR = r * node.orbitRadius;
  return {
    px: cx + Math.cos(angle) * orbitR,
    py: cy + Math.sin(angle) * orbitR * 0.6, // pseudo-3D perspective
    orbitR,
  };
}

/**
 * Draw orbital planets. Use layer param for z-ordering.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} time
 * @param {'back'|'front'} layer - 'back' = planets behind core (py < cy), 'front' = in front
 */
function drawOrbitalPlanets(ctx, cx, cy, r, time, layer) {
  const t = time * 0.001;

  for (const node of ORBITAL_NODES) {
    const { px, py } = getPlanetPos(cx, cy, r, node);
    const isBehind = py < cy;
    if (layer === 'back' && !isBehind) continue;
    if (layer === 'front' && isBehind) continue;

    const planetR = 13;
    // Depth-based alpha: planets behind are dimmer
    const depthAlpha = isBehind ? 0.6 : 1.0;

    // Check if this planet was recently hit by lightning
    let hitPulse = 0;
    for (const l of radarState.lightnings) {
      if (l.targetNodeId === node.id) {
        const elapsed = time - l.startTime;
        if (elapsed >= 0 && elapsed < l.duration + 300) {
          hitPulse = Math.max(hitPulse, l.intensity * Math.max(0, 1 - elapsed / (l.duration + 300)));
        }
      }
    }

    // Glow behind planet
    const glowR = planetR + 8 + hitPulse * 12;
    const glowGrad = ctx.createRadialGradient(px, py, planetR * 0.3, px, py, glowR);
    const glowAlpha = (0.12 + hitPulse * 0.25) * depthAlpha;
    glowGrad.addColorStop(0, colorAlpha(node.color, glowAlpha));
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(px, py, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Planet body
    const bodyGrad = ctx.createRadialGradient(
      px - planetR * 0.3, py - planetR * 0.3, planetR * 0.1,
      px, py, planetR
    );
    bodyGrad.addColorStop(0, colorAlpha(node.color, 0.95 * depthAlpha));
    bodyGrad.addColorStop(1, colorAlpha(node.color, 0.55 * depthAlpha));
    ctx.beginPath();
    ctx.arc(px, py, planetR, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Specular highlight on planet
    const specG = ctx.createRadialGradient(
      px - planetR * 0.3, py - planetR * 0.3, 0,
      px - planetR * 0.3, py - planetR * 0.3, planetR * 0.5
    );
    specG.addColorStop(0, `rgba(255,255,255,${0.35 * depthAlpha})`);
    specG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(px, py, planetR, 0, Math.PI * 2);
    ctx.fillStyle = specG;
    ctx.fill();

    // Icon
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,255,255,${0.9 * depthAlpha})`;
    ctx.fillText(node.icon, px, py);

    // Label below
    ctx.font = '600 8px "DM Sans", sans-serif';
    ctx.fillStyle = `rgba(160,170,185,${0.7 * depthAlpha})`;
    ctx.textAlign = 'center';
    ctx.fillText(node.label, px, py + planetR + 11);
  }
}

// ── 4. Lightning Bolts ──

/**
 * Generate zigzag lightning path points from (sx,sy) to (ex,ey).
 * @param {number} sx @param {number} sy @param {number} ex @param {number} ey
 * @param {number} segments @param {number} spread - max perpendicular offset
 * @param {number} seed - deterministic seed for stable shape
 * @param {number} time
 * @returns {Array<{x: number, y: number}>}
 */
function generateLightningPath(sx, sy, ex, ey, segments, spread, seed, time) {
  const points = [{ x: sx, y: sy }];
  const dx = ex - sx, dy = ey - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Perpendicular unit vector
  const nx = -dy / len, ny = dx / len;

  for (let i = 1; i < segments; i++) {
    const frac = i / segments;
    const bx = sx + dx * frac;
    const by = sy + dy * frac;
    // Deterministic offset using sin seeding — holds shape across frames
    const offset = Math.sin(i * 7.3 + seed + time * 0.002) * spread;
    points.push({ x: bx + nx * offset, y: by + ny * offset });
  }
  points.push({ x: ex, y: ey });
  return points;
}

/**
 * Draw a multi-layer lightning bolt path.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} points
 * @param {string} color
 * @param {number} intensity - 0..1
 * @param {string} riskLevel
 * @param {number} alpha - fade multiplier
 */
function drawLightningPath(ctx, points, color, intensity, riskLevel, alpha) {
  if (points.length < 2) return;

  const riskMult = { low: 1, medium: 1.5, high: 2.2, critical: 2.8 }[riskLevel] || 1;

  // Layer 1: Outer glow
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = colorAlpha(color, 0.12 * alpha * intensity);
  ctx.lineWidth = (8 + riskMult * 2) * intensity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Layer 2: Colored middle
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = colorAlpha(color, 0.5 * alpha);
  ctx.lineWidth = (2 + riskMult) * intensity;
  ctx.stroke();

  // Layer 3: White/bright core
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * alpha})`;
  ctx.lineWidth = Math.max(0.5, riskMult * 0.6) * intensity;
  ctx.stroke();
}

/**
 * Draw all active lightning bolts from center to target planets.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} time
 */
function drawLightning(ctx, cx, cy, r, time) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const bolt of radarState.lightnings) {
    const node = ORBITAL_NODES.find(n => n.id === bolt.targetNodeId);
    if (!node) continue;

    const elapsed = time - bolt.startTime;
    if (elapsed < 0 || elapsed > bolt.duration) continue;

    const progress = Math.min(1, elapsed / (bolt.duration * 0.3)); // grow to full in 30% of duration
    const fade = elapsed > bolt.duration * 0.6
      ? Math.max(0, 1 - (elapsed - bolt.duration * 0.6) / (bolt.duration * 0.4))
      : 1;

    const { px: tx, py: ty } = getPlanetPos(cx, cy, r, node);
    const segments = 10;
    const spread = 18 + bolt.intensity * 12;

    // Main bolt
    const mainPath = generateLightningPath(cx, cy, tx, ty, segments, spread, bolt.seed, time);
    // Trim path to current progress
    const visibleCount = Math.max(2, Math.ceil(mainPath.length * progress));
    const visiblePath = mainPath.slice(0, visibleCount);

    drawLightningPath(ctx, visiblePath, bolt.color, bolt.intensity, bolt.riskLevel, fade);

    // Branches (risk-dependent count)
    const branchCount = { low: 1, medium: 2, high: 3, critical: 4 }[bolt.riskLevel] || 1;
    if (progress > 0.3) {
      for (let b = 0; b < branchCount; b++) {
        const branchIdx = Math.min(visiblePath.length - 1, Math.floor(2 + b * (visiblePath.length / (branchCount + 1))));
        const bp = visiblePath[branchIdx];
        if (!bp) continue;
        const branchAngle = Math.sin(bolt.seed * (b + 1) * 3.7) * Math.PI * 0.8;
        const branchLen = 20 + bolt.intensity * 15;
        const bex = bp.x + Math.cos(branchAngle) * branchLen;
        const bey = bp.y + Math.sin(branchAngle) * branchLen;
        const branchPath = generateLightningPath(bp.x, bp.y, bex, bey, 4, spread * 0.5, bolt.seed + b * 11, time);
        drawLightningPath(ctx, branchPath, bolt.color, bolt.intensity * 0.6, 'low', fade * 0.7);
      }
    }
  }
  ctx.restore();
}

// ── 5. Sparkle Particles ──

/**
 * Draw and update all sparkle particles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawSparkles(ctx, time) {
  for (const s of radarState.sparkles) {
    const age = time - s.born;
    if (age > s.maxLife) continue;

    const life = 1 - age / s.maxLife;
    const alpha = life * life; // quadratic fade
    const size = s.size * life;
    if (size < 0.2) continue;

    // Glow
    const glowGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size * 3);
    glowGrad.addColorStop(0, colorAlpha(s.color, alpha * 0.3));
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(s.x, s.y, size * 3, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Core dot
    ctx.beginPath();
    ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
    ctx.fillStyle = colorAlpha(s.color, alpha);
    ctx.fill();
  }
}

/**
 * Spawn sparkle particles at a point (called when lightning strikes a planet).
 * @param {number} x @param {number} y
 * @param {string} color
 * @param {number} intensity - 0..1 controls particle count
 * @param {number} time
 */
function spawnSparkles(x, y, color, intensity, time) {
  const count = Math.round(8 + intensity * 17); // 8-25 particles
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 80 * intensity;
    // Mix in some white sparkles
    const c = Math.random() < 0.3 ? '#ffffff' : color;
    radarState.sparkles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: c,
      size: 1 + Math.random() * 2.5,
      born: time,
      maxLife: 300 + Math.random() * 400, // 300-700ms
    });
  }
  // Cap at 200 particles
  if (radarState.sparkles.length > 200) {
    radarState.sparkles.splice(0, radarState.sparkles.length - 200);
  }
}

// ── 6. Lightning Flash Overlay ──

/**
 * Draw a brief white flash when lightning strikes.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} intensity
 */
function drawLightningFlash(ctx, cx, cy, r, intensity) {
  if (intensity <= 0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${intensity * 0.03})`;
  ctx.fill();
}
