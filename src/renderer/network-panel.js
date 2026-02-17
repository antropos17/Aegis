/**
 * @file network-panel.js
 * @module network-panel
 * @description Safe-domain classification, network connection rendering with
 *   domain color coding, and the other-agents panel toggle.
 * @since v0.1.0
 */

// ═══ NETWORK CONNECTIONS ═══

/**
 * Set of known safe domains used for network domain classification.
 * @type {Set<string>}
 * @since v0.1.0
 */
const SAFE_DOMAINS_SET = new Set([
  'github.com', 'api.github.com', 'googleapis.com', 'anthropic.com', 'api.anthropic.com',
  'openai.com', 'api.openai.com', 'microsoft.com', 'azure.com', 'amazonaws.com', 'npmjs.org',
  'registry.npmjs.org', 'pypi.org', 'docker.io', 'docker.com', 'cloudflare.com', 'sentry.io', 'vscode.dev',
  'google.com', 'googleusercontent.com', '1e100.net', 'gstatic.com', 'googlevideo.com',
  'cloudfront.net', 'akamaiedge.net', 'akamai.net', 'fastly.net',
  'github.io', 'githubusercontent.com', 'githubassets.com',
  'visualstudio.com', 'vsassets.io', 'gallerycdn.vsassets.io',
  'electron.build', 'electronjs.org', 'nodejs.org',
]);

/**
 * Check whether a domain is in the safe-domains whitelist (exact or suffix match).
 * @param {string} domain - The domain string to check.
 * @returns {boolean} True if the domain is considered safe.
 * @since v0.1.0
 */
function isDomainSafe(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (SAFE_DOMAINS_SET.has(d)) return true;
  for (const s of SAFE_DOMAINS_SET) {
    if (d.endsWith('.' + s)) return true;
  }
  return false;
}

/**
 * Render the network connections list, update per-agent connection counts
 * for risk scoring, and apply domain color coding.
 * @param {Object[]} connections - Array of connection objects (agent, remoteIp, remotePort, domain, state, flagged).
 * @returns {void}
 * @since v0.1.0
 */
function renderNetworkConnections(connections) {
  latestNetworkConnections = connections;
  // Update per-agent connection counts for risk scoring
  Object.keys(netConnectionCounts).forEach(k => { netConnectionCounts[k] = 0; });
  Object.keys(netUnknownDomainCounts).forEach(k => { netUnknownDomainCounts[k] = 0; });
  for (const c of connections) {
    netConnectionCounts[c.agent] = (netConnectionCounts[c.agent] || 0) + 1;
    // Track unknown/suspicious domain connections
    if (c.flagged || !isDomainSafe(c.domain)) {
      netUnknownDomainCounts[c.agent] = (netUnknownDomainCounts[c.agent] || 0) + 1;
    }
  }

  if (connections.length === 0) {
    networkList.innerHTML = '<div class="empty-state">No outbound connections detected</div>';
    networkCountEl.textContent = '0 connections';
    networkCountEl.classList.remove('has-flagged');
    return;
  }

  const flaggedCount = connections.filter(c => c.flagged).length;
  const label = connections.length === 1 ? '1 connection' : `${connections.length} connections`;
  networkCountEl.textContent = flaggedCount > 0 ? `${label} (${flaggedCount} flagged)` : label;

  if (flaggedCount > 0) {
    networkCountEl.classList.add('has-flagged');
  } else {
    networkCountEl.classList.remove('has-flagged');
  }

  function getDomainClass(domain, flagged) {
    if (flagged) return 'net-domain domain-suspicious';
    if (!domain) return 'net-domain domain-unknown';
    if (isDomainSafe(domain)) return 'net-domain domain-safe';
    return 'net-domain domain-unknown';
  }

  networkList.innerHTML = connections.map(c => {
    const rowClass = c.flagged ? 'net-row flagged' : 'net-row';
    const domainText = c.domain || 'unknown';
    const domainClass = getDomainClass(c.domain, c.flagged);
    const stateSlug = c.state.toLowerCase().replace(/[^a-z]/g, '');
    const hiddenClass = (selectedAgent && c.agent !== selectedAgent) ? ' filter-hidden' : '';

    return `
      <div class="${rowClass}${hiddenClass}" data-agent="${escapeHtml(c.agent)}">
        <span class="net-agent">${escapeHtml(c.agent)}</span>
        <span class="net-ip">${escapeHtml(c.remoteIp)}</span>
        <span class="net-port">:${c.remotePort}</span>
        <span class="${domainClass}">${escapeHtml(domainText)}</span>
        <span class="net-state ${stateSlug}">${escapeHtml(c.state)}</span>
      </div>`;
  }).join('');
}

// ── Toggle other panel ──

otherToggleBtn.addEventListener('click', () => {
  const isCollapsed = otherPanel.classList.toggle('collapsed');
  otherToggleBtn.textContent = isCollapsed ? 'SHOW' : 'HIDE';
  window.aegis.setOtherPanelExpanded(!isCollapsed);
});
