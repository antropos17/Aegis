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
 * Initialise with shared state references.
 * @param {Object} state
 * @param {Function} state.getSettings - returns current settings object
 * @param {Array}    state.activityLog - shared activity log
 * @param {Function} state.getLatestAgents - returns current agents
 * @param {Function} state.getLatestNetConnections - returns network connections
 * @returns {void}
 * @since v0.1.0
 */
function init(state) { _state = state; }

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
    const agentEvents = _state.activityLog.filter(e => e.agent === agentName);
    const sensitiveEvents = agentEvents.filter(e => e.sensitive);
    const agentInfo = _state.getLatestAgents().find(a => a.agent === agentName);
    const agentNetConns = _state.getLatestNetConnections().filter(c => c.agent === agentName);
    const parentChain = agentInfo && agentInfo.parentChain ? agentInfo.parentChain.join(' -> ') : 'unknown';
    const sensitiveList = sensitiveEvents.map(e => `  - ${e.file} (${e.reason}, ${e.action})`).join('\n') || '  (none)';
    const netList = agentNetConns.map(c => {
      const flag = c.flagged ? ' [FLAGGED]' : '';
      return `  - ${c.remoteIp}:${c.remotePort} -> ${c.domain || 'unknown'}${flag} (${c.state})`;
    }).join('\n') || '  (none)';
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
      `Network connections: ${agentNetConns.length} (${agentNetConns.filter(c => c.flagged).length} flagged)`,
      netList !== '  (none)' ? `Connection details:\n${netList}` : '',
    ].filter(Boolean).join('\n');
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: 'You are a cybersecurity analyst reviewing AI agent activity on a Windows workstation. Provide a concise, plain-English risk assessment. Structure your response as: 1) Summary (1-2 sentences), 2) Key findings (bullet points), 3) Risk level (Low/Medium/High/Critical with brief justification), 4) Recommendations (1-3 actionable items). Be direct and specific. Do not use markdown headers — use plain text with simple formatting.',
      messages: [{ role: 'user', content: userMessage }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content && parsed.content[0] && parsed.content[0].text) {
            resolve({ success: true, analysis: parsed.content[0].text });
          } else if (parsed.error) {
            resolve({ success: false, error: parsed.error.message || 'API error' });
          } else {
            resolve({ success: false, error: 'Unexpected API response' });
          }
        } catch (_) {
          resolve({ success: false, error: 'Failed to parse API response' });
        }
      });
    });
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

module.exports = { init, analyzeAgentActivity };
