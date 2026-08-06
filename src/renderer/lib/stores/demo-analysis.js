/**
 * @file Fabricated threat-analysis result for browser-only demo mode.
 *
 * Lifted out of `ThreatAnalysis.svelte` so the fictional hostname it names lives behind
 * the same build-time gate as the rest of the demo surface. Reachable ONLY through the
 * dynamic import in `ThreatAnalysis.svelte`, guarded by `import.meta.env.VITE_DEMO_MODE`;
 * the default build drops the branch and this module with it. A production build with no
 * preload bridge reports the analysis as unavailable instead of showing this.
 */

/**
 * Build the static analysis the deployed demo shows when there is no Electron IPC.
 * @param {{agents: Array<{name: string}>, agentName: string}} ctx - Live risk-enriched
 *   agents from the demo stores, and the label for the analysis target (a selected
 *   agent name, or a phrase covering the whole session).
 * @returns {{summary: string, findings: string[], riskRating: string, riskJustification: string, recommendations: string[]}}
 */
export function buildDemoAnalysis({ agents, agentName }) {
  const names = agents.map((a) => a.name).join(', ') || 'Claude Code, GitHub Copilot';
  return {
    summary: `Analysis of ${agentName}: ${agents.length} agent(s) monitored (${names}). File access patterns and network connections reviewed.`,
    findings: [
      'Sensitive file access detected: .env.local, .ssh/id_rsa, .aws/credentials',
      'Normal code editing activity: src/, tests/, package.json',
      'Suspicious outbound connection to data-collector-unknown.io:4444',
      'All API traffic uses TLS on port 443',
    ],
    riskRating: agents.length > 3 ? 'HIGH' : 'MEDIUM',
    riskJustification:
      'Sensitive credential files accessed by multiple agents. Flagged network destination requires investigation.',
    recommendations: [
      'Review .ssh and .aws access — restrict to specific agents only',
      'Block data-collector-unknown.io in firewall rules',
      'Enable per-agent file access permissions in Rules tab',
      'Consider rotating exposed credentials',
    ],
  };
}
