/**
 * @file radar-engine.js - Radar animation loop, agent orbits, connection lines,
 * blocked flash, and radar API functions.
 * Depends on: theme.js (isDark), radar-state.js (radarState, RADAR_NODES, AGENT_COLORS,
 * REASON_TO_NODE, degToRad), radar-draw.js, state.js (radarCanvas, radarCtx, agentDbMap).
 * @since 0.1.0
 */

/** Convert a CSS color to rgba with given alpha. Handles hex and rgb() formats.
 * @param {string} c - CSS color. @param {number} a - Alpha 0-1. @returns {string} @since 0.1.0 */
function colorAlpha(c, a) {
  if (c.startsWith('#')) {
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c.replace(')', `, ${a})`).replace('rgb', 'rgba');
}

/** Draw agent orbit ring and all agent dots with trails and labels.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {number} now @since 0.1.0 */
function drawAgentOrbits(ctx, cx, cy, r, now) {
  const orbitR = r * 0.55;
  const agents = Object.entries(radarState.agentOrbits);
  if (agents.length > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
    ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(120,140,165,0.12)';
    ctx.lineWidth = 0.5; ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const [name, orbit] of agents) {
    const a = orbit.angle, ax = cx + Math.cos(a) * orbitR, ay = cy + Math.sin(a) * orbitR;
    const dbEntry = agentDbMap[name];
    const dc = dbEntry ? dbEntry.color : orbit.color;
    if (orbit.static) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.003), dotR = 6 + pulse * 2;
      ctx.beginPath(); ctx.arc(ax, ay, dotR + 6, 0, Math.PI * 2);
      ctx.fillStyle = colorAlpha(dc, 0.08 + pulse * 0.06); ctx.fill();
      ctx.beginPath(); ctx.arc(ax, ay, dotR, 0, Math.PI * 2);
      ctx.fillStyle = dc; ctx.fill();
      ctx.beginPath(); ctx.arc(ax - 1.5, ay - 1.5, dotR * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.fillStyle = dc; ctx.fill();
      ctx.beginPath(); ctx.arc(ax, ay, 10, 0, Math.PI * 2);
      ctx.fillStyle = colorAlpha(dc, 0.15); ctx.fill();
      for (let t = 1; t <= 3; t++) {
        const ta = a - orbit.speed * t * 8;
        ctx.beginPath(); ctx.arc(cx + Math.cos(ta) * orbitR, cy + Math.sin(ta) * orbitR, 3.5 - t * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = colorAlpha(dc, 0.3 - t * 0.08); ctx.fill();
      }
    }
    ctx.font = '600 9px "DM Sans", sans-serif';
    ctx.fillStyle = dc; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(orbit.label, ax, ay - 11);
  }
}

/** Draw animated connection lines between agents and system nodes.
 * @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 * @param {number} r @param {number} now @since 0.1.0 */
function drawConnectionLines(ctx, cx, cy, r, now) {
  const orbitR = r * 0.55, nodeR = r * 0.85;
  radarState.connectionLines = radarState.connectionLines.filter(conn => {
    const elapsed = now - conn.timestamp;
    if (elapsed > 2000) return false;
    const progress = Math.min(1, elapsed / 600);
    const fade = elapsed > 1200 ? Math.max(0, 1 - (elapsed - 1200) / 800) : 1;
    const sx = cx + Math.cos(conn.fromAngle) * orbitR, sy = cy + Math.sin(conn.fromAngle) * orbitR;
    const targetNode = RADAR_NODES.find(n => n.id === conn.toNodeId);
    if (!targetNode) return false;
    const ta = degToRad(targetNode.angle);
    const tx = cx + Math.cos(ta) * nodeR, ty = cy + Math.sin(ta) * nodeR;
    const ex = sx + (tx - sx) * progress, ey = sy + (ty - sy) * progress;
    const color = conn.blocked ? `rgba(220,53,69,${fade * 0.8})` : `rgba(78,205,196,${fade * 0.6})`;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = color; ctx.lineWidth = conn.blocked ? 2.5 : 1.5;
    ctx.setLineDash(conn.blocked ? [4, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    if (progress < 1) {
      const dp = (elapsed % 400) / 400;
      ctx.beginPath(); ctx.arc(sx + (ex - sx) * dp, sy + (ey - sy) * dp, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    if (conn.blocked && progress >= 0.9) {
      ctx.strokeStyle = `rgba(220,53,69,${fade})`; ctx.lineWidth = 2; const xs = 6;
      ctx.beginPath();
      ctx.moveTo(ex - xs, ey - xs); ctx.lineTo(ex + xs, ey + xs);
      ctx.moveTo(ex + xs, ey - xs); ctx.lineTo(ex - xs, ey + xs); ctx.stroke();
    }
    return true;
  });
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

let radarDprSet = false;

/** Main radar animation frame callback. Draws all layers and advances state. @since 0.1.0 */
function renderRadar() {
  requestAnimationFrame(renderRadar);
  const now = Date.now(), canvas = radarCanvas, ctx = radarCtx;
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const dW = canvas.clientWidth, dH = canvas.clientHeight;
  if (dW <= 0 || dH <= 0) return;
  if (!radarDprSet || canvas.width !== dW * dpr || canvas.height !== dH * dpr) {
    canvas.width = dW * dpr; canvas.height = dH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); radarDprSet = true;
  }
  ctx.clearRect(0, 0, dW, dH);
  const cx = dW / 2, cy = dH / 2, r = Math.min(cx, cy) - 4;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  drawRadarBackground(ctx, cx, cy, r);
  drawSweepArm(ctx, cx, cy, r, radarState.sweepAngle);
  drawBlockedFlash(ctx, cx, cy, r, now);
  drawConnectionLines(ctx, cx, cy, r, now);
  drawAgentOrbits(ctx, cx, cy, r, now);
  ctx.restore();
  drawSystemNodes(ctx, cx, cy, r, now);
  drawCenterCore(ctx, cx, cy, r, radarState.threatLevel, radarState.threatLabel);
  radarState.sweepAngle += 0.0131;
  if (radarState.sweepAngle > Math.PI * 2) radarState.sweepAngle -= Math.PI * 2;
  for (const orbit of Object.values(radarState.agentOrbits)) {
    if (orbit.static) continue;
    orbit.angle += orbit.speed;
    if (orbit.angle > Math.PI * 2) orbit.angle -= Math.PI * 2;
  }
}

/** Sync radar orbit state with detected agents. Adds new, removes departed.
 * @param {Array<{agent: string, category: string}>} agents @since 0.1.0 */
function updateRadarAgents(agents) {
  const aiAgents = agents.filter(a => a.category === 'ai');
  const existing = new Set(Object.keys(radarState.agentOrbits));
  const current = new Set(aiAgents.map(a => a.agent));
  for (const name of existing) { if (!current.has(name)) delete radarState.agentOrbits[name]; }
  aiAgents.forEach((a, i) => {
    if (!radarState.agentOrbits[a.agent]) {
      const isClaude = a.agent.toLowerCase().includes('claude');
      const db = agentDbMap[a.agent];
      radarState.agentOrbits[a.agent] = {
        angle: (i / Math.max(aiAgents.length, 1)) * Math.PI * 2,
        speed: isClaude ? 0 : (0.006 + Math.random() * 0.005),
        color: (db && db.color) || AGENT_COLORS[i % AGENT_COLORS.length],
        label: a.agent.split(' ')[0].substring(0, 10), static: isClaude,
      };
    }
  });
}

/** Create a connection line animation from an agent to a system node.
 * @param {string} agentName @param {string} reason @param {boolean} blocked @since 0.1.0 */
function triggerRadarConnection(agentName, reason, blocked) {
  const nodeId = REASON_TO_NODE[reason];
  if (!nodeId) return;
  const orbit = radarState.agentOrbits[agentName];
  const fromAngle = orbit ? orbit.angle : Math.random() * Math.PI * 2;
  radarState.connectionLines.push({ fromAngle, toNodeId: nodeId, timestamp: Date.now(), blocked: !!blocked });
  radarState.nodePulses[nodeId] = { intensity: 1, timestamp: Date.now() };
  if (blocked) radarState.blockedFlash = { active: true, timestamp: Date.now() };
}

/** Temporarily boost an agent's orbit speed on activity, then decay back.
 * @param {string} agentName @since 0.1.0 */
function boostAgentSpeed(agentName) {
  const orbit = radarState.agentOrbits[agentName];
  if (!orbit) return;
  orbit.speed = Math.min(0.04, orbit.speed + 0.005);
  setTimeout(() => {
    if (radarState.agentOrbits[agentName])
      radarState.agentOrbits[agentName].speed = Math.max(0.008, radarState.agentOrbits[agentName].speed - 0.005);
  }, 3000);
}

requestAnimationFrame(renderRadar);
