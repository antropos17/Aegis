/**
 * @file radar-engine.js - Solar System animation loop, lightning triggers,
 * sparkle physics, and radar API functions.
 * Depends on: radar-state.js (ORBITAL_NODES, radarState, REASON_TO_NODE, AGENT_COLORS),
 * radar-draw.js (all draw* functions, getPlanetPos, spawnSparkles),
 * state.js (radarCanvas, radarCtx, agentDbMap).
 * @since 0.2.0
 */

/** Convert a CSS color to rgba with given alpha. Handles hex and rgb() formats.
 * @param {string} c - CSS color. @param {number} a - Alpha 0-1. @returns {string} @since 0.1.0 */
function colorAlpha(c, a) {
  if (c.startsWith('#')) {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c.replace(')', `, ${a})`).replace('rgb', 'rgba');
}

/** Draw a brief red flash overlay when access is blocked.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {number} now @since 0.1.0 */
function drawBlockedFlash(ctx, cx, cy, r, now) {
  if (!radarState.blockedFlash.active) return;
  const elapsed = now - radarState.blockedFlash.timestamp;
  if (elapsed > 600) { radarState.blockedFlash.active = false; return; }
  const i = Math.max(0, 1 - elapsed / 600);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,53,69,${i * 0.12})`; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(220,53,69,${i * 0.5})`; ctx.lineWidth = 3; ctx.stroke();
}

// ═══ ANIMATION LOOP ═══

let radarDprSet = false;
let lastFrameTime = 0;

/** Main radar animation frame callback. Draws all layers and advances state. @since 0.2.0 */
function renderRadar(timestamp) {
  requestAnimationFrame(renderRadar);

  const time = timestamp || performance.now();
  const dt = lastFrameTime ? (time - lastFrameTime) / 1000 : 0.016; // delta in seconds
  lastFrameTime = time;

  const canvas = radarCanvas, ctx = radarCtx;
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const dW = canvas.clientWidth, dH = canvas.clientHeight;
  if (dW <= 0 || dH <= 0) return;

  if (!radarDprSet || canvas.width !== dW * dpr || canvas.height !== dH * dpr) {
    canvas.width = dW * dpr; canvas.height = dH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radarDprSet = true;
  }

  ctx.clearRect(0, 0, dW, dH);
  const cx = dW / 2, cy = dH / 2, r = Math.min(cx, cy) - 4;

  // Clip to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // ── Draw order ──

  // 1. Background (orbit paths)
  drawBackground(ctx, cx, cy, r);

  // 2. Back planets (behind core, py < cy)
  drawOrbitalPlanets(ctx, cx, cy, r, time, 'back');

  // 3. Core sphere (agent star)
  drawCoreSphere(ctx, cx, cy, r, time);

  // 4. Front planets (in front of core, py >= cy)
  drawOrbitalPlanets(ctx, cx, cy, r, time, 'front');

  // 5. Lightning bolts
  drawLightning(ctx, cx, cy, r, time);

  // 6. Sparkles
  drawSparkles(ctx, time);

  // 7. Blocked flash overlay
  drawBlockedFlash(ctx, cx, cy, r, time);

  // 8. Lightning flash overlay (triggered by new bolts)
  let flashIntensity = 0;
  for (const bolt of radarState.lightnings) {
    const elapsed = time - bolt.startTime;
    if (elapsed >= 0 && elapsed < 100) {
      flashIntensity = Math.max(flashIntensity, bolt.intensity * (1 - elapsed / 100));
    }
  }
  drawLightningFlash(ctx, cx, cy, r, flashIntensity);

  ctx.restore();

  // ═══ STATE ADVANCES ═══

  // Advance planet orbital angles
  for (const node of ORBITAL_NODES) {
    const orbit = radarState.orbits[node.id];
    if (orbit) {
      orbit.angle += node.speed * dt;
      if (orbit.angle > Math.PI * 2) orbit.angle -= Math.PI * 2;
    }
  }

  // Advance core pulse phase
  radarState.corePulse.phase += dt * 2.0;
  if (radarState.corePulse.phase > Math.PI * 2) radarState.corePulse.phase -= Math.PI * 2;

  // Spawn sparkles at lightning impact points (once per bolt, when it reaches target)
  for (const bolt of radarState.lightnings) {
    if (bolt._sparkled) continue;
    const elapsed = time - bolt.startTime;
    if (elapsed >= bolt.duration * 0.25) {
      const node = ORBITAL_NODES.find(n => n.id === bolt.targetNodeId);
      if (node) {
        const { px, py } = getPlanetPos(cx, cy, r, node);
        spawnSparkles(px, py, bolt.color, bolt.intensity, time);
      }
      bolt._sparkled = true;
    }
  }

  // Update sparkle positions (simple physics)
  for (const s of radarState.sparkles) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 60 * dt; // gravity
    s.vx *= 0.97; // drag
    s.vy *= 0.97;
  }

  // Cleanup expired sparkles
  const sparkleNow = time;
  radarState.sparkles = radarState.sparkles.filter(s => (sparkleNow - s.born) < s.maxLife);

  // Cleanup expired lightnings (keep for duration + 200ms fade buffer)
  radarState.lightnings = radarState.lightnings.filter(l => (time - l.startTime) < l.duration + 200);
}

// ═══ EXTERNAL API (signatures preserved) ═══

/** Sync radar state with detected agents. Sets selectedAgent for core display.
 * @param {Array<{agent: string, category: string}>} agents @since 0.1.0 */
function updateRadarAgents(agents) {
  const aiAgents = agents.filter(a => a.category === 'ai');
  const existing = new Set(Object.keys(radarState.agentOrbits));
  const current = new Set(aiAgents.map(a => a.agent));

  // Remove departed agents
  for (const name of existing) { if (!current.has(name)) delete radarState.agentOrbits[name]; }

  // Add new agents
  aiAgents.forEach((a, i) => {
    if (!radarState.agentOrbits[a.agent]) {
      const db = agentDbMap[a.agent];
      radarState.agentOrbits[a.agent] = {
        color: (db && db.color) || AGENT_COLORS[i % AGENT_COLORS.length],
        label: a.agent.split(' ')[0].substring(0, 10),
      };
    }
  });

  // Set first AI agent as selected for core display
  if (aiAgents.length > 0) {
    if (!radarState.selectedAgent || !current.has(radarState.selectedAgent)) {
      radarState.selectedAgent = aiAgents[0].agent;
    }
  } else {
    radarState.selectedAgent = null;
  }
}

/** Create a lightning bolt from center to a system node (replaces connection line).
 * @param {string} agentName @param {string} reason @param {boolean} blocked @since 0.1.0 */
function triggerRadarConnection(agentName, reason, blocked) {
  const nodeId = REASON_TO_NODE[reason];
  if (!nodeId) return;

  const node = ORBITAL_NODES.find(n => n.id === nodeId);
  if (!node) return;

  const riskLevel = blocked ? 'high' : 'low';
  const intensity = blocked ? 1.0 : 0.5;
  const duration = blocked ? 700 : 400;
  const color = blocked ? '#dc3545' : node.color;

  radarState.lightnings.push({
    targetNodeId: nodeId,
    startTime: performance.now(),
    duration,
    intensity,
    riskLevel,
    color,
    seed: Math.random() * 1000,
  });

  if (blocked) {
    radarState.blockedFlash = { active: true, timestamp: performance.now() };
  }
}

/** Spawn a solar flare + boost core pulse on agent activity (replaces orbit speed boost).
 * @param {string} agentName @since 0.1.0 */
function boostAgentSpeed(agentName) {
  if (!radarState.agentOrbits[agentName]) return;

  // Boost core pulse temporarily
  radarState.corePulse.intensity = Math.min(1.0, radarState.corePulse.intensity + 0.15);
  setTimeout(() => {
    radarState.corePulse.intensity = Math.max(0.3, radarState.corePulse.intensity - 0.15);
  }, 2000);
}

/** Trigger a lightning bolt to a specific node (new direct API for external callers).
 * @param {string} nodeId - ORBITAL_NODES id (e.g. 'ssh', 'env')
 * @param {string} [riskLevel='low'] - 'low'|'medium'|'high'|'critical'
 */
function triggerLightning(nodeId, riskLevel) {
  riskLevel = riskLevel || 'low';
  const node = ORBITAL_NODES.find(n => n.id === nodeId);
  if (!node) return;

  const intensity = { low: 0.4, medium: 0.7, high: 1.0, critical: 1.0 }[riskLevel] || 0.4;
  const duration = { low: 300, medium: 500, high: 700, critical: 900 }[riskLevel] || 300;

  radarState.lightnings.push({
    targetNodeId: nodeId,
    startTime: performance.now(),
    duration,
    intensity,
    riskLevel,
    color: node.color,
    seed: Math.random() * 1000,
  });
}

requestAnimationFrame(renderRadar);
