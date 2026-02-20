/**
 * @file ai-analysis.js
 * @module main/ai-analysis
 * @description AI-powered agent activity analysis via the Anthropic Messages API.
 *   Gathers per-agent file, sensitive-file, and network activity, then requests
 *   a structured risk assessment from Claude.
 * @requires https
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const https = require('https');

let _state = null;

/**
 * Try to extract valid JSON from an API response that may contain
 * markdown fences, preamble text, or trailing explanations.
 * @param {string} text - raw API response text
 * @returns {Object|null} parsed JSON or null
 */
function extractJSON(text) {
  const trimmed = text.trim();
  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    /* continue */
  }
  // 2. Strip markdown code fences
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {
    /* continue */
  }
  // 3. Extract first {...} block
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(stripped.slice(first, last + 1));
    } catch (_) {
      /* continue */
    }
  }
  return null;
}

/**
 * Initialise with shared state references.
 * @param {Object} state
 * @param {Function} state.getSettings - returns current settings object
 * @param {Array}    state.activityLog - shared activity log
 * @param {Function} state.getLatestAgents - returns current agents
 * @param {Function} state.getLatestNetConnections - returns network connections
 * @returns {void}
 * @since v0.1.0
 */
function init(state) {
  _state = state;
}

/**
 * Analyse a named agent's activity via the Anthropic API.
 * @param {string} agentName - Display name of the agent to analyse
 * @returns {Promise<{success:boolean, analysis?:string, error?:string}>}
 * @since v0.1.0
 */
function analyzeAgentActivity(agentName) {
  return new Promise((resolve) => {
    const apiKey = _state.getSettings().anthropicApiKey;
    if (!apiKey) {
      resolve({ success: false, error: 'No API key configured' });
      return;
    }
    const agentEvents = _state.activityLog.filter((e) => e.agent === agentName);
    const sensitiveEvents = agentEvents.filter((e) => e.sensitive);
    const agentInfo = _state.getLatestAgents().find((a) => a.agent === agentName);
    const agentNetConns = _state.getLatestNetConnections().filter((c) => c.agent === agentName);
    const parentChain =
      agentInfo && agentInfo.parentChain ? agentInfo.parentChain.join(' -> ') : 'unknown';
    const sensitiveList =
      sensitiveEvents.map((e) => `  - ${e.file} (${e.reason}, ${e.action})`).join('\n') ||
      '  (none)';
    const netList =
      agentNetConns
        .map((c) => {
          const flag = c.flagged ? ' [FLAGGED]' : '';
          return `  - ${c.remoteIp}:${c.remotePort} -> ${c.domain || 'unknown'}${flag} (${c.state})`;
        })
        .join('\n') || '  (none)';
    const userMessage = [
      `Agent: ${agentName}`,
      `Process: ${agentInfo ? agentInfo.process : 'unknown'} (PID ${agentInfo ? agentInfo.pid : '?'})`,
      `Category: ${agentInfo ? agentInfo.category : 'unknown'}`,
      `Parent chain: ${parentChain}`,
      '',
      `Files accessed: ${agentEvents.length}`,
      `Sensitive files: ${sensitiveEvents.length}`,
      sensitiveList !== '  (none)' ? `Sensitive file details:\n${sensitiveList}` : '',
      '',
      `Network connections: ${agentNetConns.length} (${agentNetConns.filter((c) => c.flagged).length} flagged)`,
      netList !== '  (none)' ? `Connection details:\n${netList}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        'You are AEGIS, a cybersecurity analyst reviewing AI agent activity on a Windows workstation. Respond with valid JSON only (no markdown, no code fences). Use this exact structure: {"summary":"1-2 sentence executive summary","findings":["finding 1","finding 2","finding 3"],"riskLevel":"LOW|MEDIUM|HIGH|CRITICAL","riskJustification":"brief reason for the rating","recommendations":["action 1","action 2"]}. Be concise, specific, and direct.',
      messages: [{ role: 'user', content: userMessage }],
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.content && parsed.content[0] && parsed.content[0].text) {
              const text = parsed.content[0].text.trim();
              const result = extractJSON(text);
              resolve(
                result
                  ? { success: true, analysis: text, structured: result }
                  : { success: true, analysis: text },
              );
            } else if (parsed.error) {
              resolve({ success: false, error: parsed.error.message || 'API error' });
            } else {
              resolve({ success: false, error: 'Unexpected API response' });
            }
          } catch (_) {
            resolve({ success: false, error: 'Failed to parse API response' });
          }
        });
      },
    );
    req.on('error', (err) => {
      resolve({ success: false, error: err.message || 'Network error' });
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out' });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Analyse the full monitoring session via the Anthropic API.
 * Gathers all agents, file accesses, network connections, anomaly scores,
 * and config access events for a comprehensive threat assessment.
 * @returns {Promise<{success:boolean, summary?:string, findings?:string[], riskRating?:string, recommendations?:string[], error?:string}>}
 * @since v0.2.0
 */
function analyzeSessionActivity() {
  return new Promise((resolve) => {
    const apiKey = _state.getSettings().anthropicApiKey;
    if (!apiKey) {
      resolve({ success: false, error: 'Set your Anthropic API key in Settings' });
      return;
    }

    const agents = _state.getLatestAgents();
    const allEvents = _state.activityLog;
    const sensitiveEvents = allEvents.filter((e) => e.sensitive);
    const configAccessEvents = allEvents.filter(
      (e) => e.reason && e.reason.startsWith('AI agent config'),
    );
    const netConns = _state.getLatestNetConnections();
    const anomalyScores = _state.getAnomalyScores ? _state.getAnomalyScores() : {};

    // Per-agent summary
    const agentSummaries = {};
    for (const ev of allEvents) {
      if (!agentSummaries[ev.agent])
        agentSummaries[ev.agent] = { files: 0, sensitive: 0, configAccess: 0, reasons: new Set() };
      agentSummaries[ev.agent].files++;
      if (ev.sensitive) {
        agentSummaries[ev.agent].sensitive++;
        agentSummaries[ev.agent].reasons.add(ev.reason);
      }
      if (ev.reason && ev.reason.startsWith('AI agent config'))
        agentSummaries[ev.agent].configAccess++;
    }
    let agentSection = '';
    for (const [name, stats] of Object.entries(agentSummaries)) {
      const agent = agents.find((a) => a.agent === name);
      const score = anomalyScores[name] || 0;
      agentSection += `  ${name}: ${stats.files} files, ${stats.sensitive} sensitive, ${stats.configAccess} config accesses, anomaly score: ${score}`;
      if (agent) agentSection += `, parent: ${(agent.parentChain || []).join(' -> ') || 'unknown'}`;
      agentSection += `\n    Sensitive categories: ${[...stats.reasons].join(', ') || 'none'}\n`;
    }

    const sensitiveDetails =
      sensitiveEvents
        .slice(-30)
        .map((e) => `  - [${e.agent}] ${e.action}: ${e.file} (${e.reason})`)
        .join('\n') || '  (none)';
    const configDetails =
      configAccessEvents
        .slice(-20)
        .map((e) => `  - [${e.agent}] ${e.action}: ${e.file} (${e.reason})`)
        .join('\n') || '  (none)';
    const netDetails =
      netConns
        .map((c) => {
          const flag = c.flagged ? ' [FLAGGED]' : '';
          return `  - [${c.agent}] ${c.remoteIp}:${c.remotePort} -> ${c.domain || 'unknown'}${flag}`;
        })
        .join('\n') || '  (none)';

    const userMessage = [
      'AEGIS Monitoring Session Data:',
      '',
      `Active agents: ${agents.length}`,
      `Total file events: ${allEvents.length}`,
      `Sensitive file accesses: ${sensitiveEvents.length}`,
      `AI config accesses: ${configAccessEvents.length}`,
      `Network connections: ${netConns.length} (${netConns.filter((c) => c.flagged).length} flagged)`,
      '',
      'Per-agent summary:',
      agentSection,
      'Recent sensitive file accesses (last 30):',
      sensitiveDetails,
      '',
      'AI agent config accesses:',
      configDetails,
      '',
      'Network connections:',
      netDetails,
    ].join('\n');

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system:
        'You are AEGIS, an AI security analyst monitoring AI agents on a user\'s workstation. Analyze the monitoring session data and respond with valid JSON only (no markdown, no code fences). Use this exact structure: {"summary":"executive threat summary in 2-3 sentences","findings":["finding 1","finding 2"],"riskRating":"CLEAR|LOW|MEDIUM|HIGH|CRITICAL","riskJustification":"brief reason for the rating","recommendations":["action 1","action 2"]}. Be specific about which agents and which files are concerning.',
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.content && parsed.content[0] && parsed.content[0].text) {
              const text = parsed.content[0].text.trim();
              const result = extractJSON(text);
              if (result) {
                resolve({
                  success: true,
                  summary: result.summary,
                  findings: result.findings || [],
                  riskRating: result.riskRating || 'UNKNOWN',
                  riskJustification: result.riskJustification || '',
                  recommendations: result.recommendations || [],
                });
              } else {
                resolve({
                  success: true,
                  summary: text,
                  findings: [],
                  riskRating: 'UNKNOWN',
                  recommendations: [],
                });
              }
            } else if (parsed.error) {
              resolve({ success: false, error: parsed.error.message || 'API error' });
            } else {
              resolve({ success: false, error: 'Unexpected API response' });
            }
          } catch (_) {
            resolve({ success: false, error: 'Failed to parse API response' });
          }
        });
      },
    );
    req.on('error', (err) => {
      resolve({ success: false, error: err.message || 'Network error' });
    });
    req.setTimeout(60000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out (60s)' });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { init, analyzeAgentActivity, analyzeSessionActivity };
