/**
 * NetworkPanel.test.ts — the label a connection actually shows.
 *
 * `network-monitor.test.js` pins what the classifier decides; this pins that the decision
 * survives to the screen. It exists because it did not: the panel derived its label from
 * `(flagged, domain)`, which rendered a confirmed-but-unlisted host as UNKNOWN and a host
 * with no name at all as FLAGGED — the two non-safe labels swapped. These assert the row
 * badge equals the recorded verdict, that a record without a verdict still renders, and
 * that the reason code is reachable by a person (row title).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

/**
 * `window.aegis` must exist BEFORE `stores/ipc` is evaluated — otherwise that module takes
 * the demo-mode branch and pushes synthetic connections into the panel under test. Hence
 * the dynamic imports below.
 */
const noop = () => {};
(window as unknown as { aegis: unknown }).aegis = {
  onScanBatch: noop,
  onFileAccess: noop,
  onStatsUpdate: noop,
  onNetworkUpdate: noop,
  onScanStatus: noop,
  onTokenCosts: noop,
  onAgentResourceUsage: noop,
  getStats: () => Promise.resolve({}),
  getResourceUsage: () => Promise.resolve({}),
  getFalsePositives: () => Promise.resolve([]),
  getSettings: () => Promise.resolve({}),
  saveSettings: () => Promise.resolve({}),
  getAuditEntriesBefore: () => Promise.resolve([]),
};

const { network } = await import('../../../src/renderer/lib/stores/ipc.js');
const NetworkPanel = (await import('../../../src/renderer/lib/components/NetworkPanel.svelte'))
  .default;

/** One connection, shaped as scanNetworkConnections emits it. */
function conn(over: Record<string, unknown>) {
  return {
    agent: 'Claude Code',
    pid: 100,
    parentEditor: null,
    cwd: null,
    category: 'ai',
    remoteIp: '160.79.104.10',
    remotePort: 443,
    domain: '',
    state: 'ESTABLISHED',
    flagged: false,
    httpUnencrypted: false,
    userAgent: 'claude',
    ...over,
  };
}

/** Badge text of every rendered row, in order. */
function badges(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.net-badge')].map((el) => el.textContent?.trim() ?? '');
}

/** Row titles, in order. */
function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.net-row')].map((el) => el.getAttribute('title') ?? '');
}

describe('NetworkPanel — labels follow the verdict', () => {
  beforeEach(() => {
    network.set([]);
  });

  it('renders each of the three verdicts under its own pill', async () => {
    network.set([
      // The agent's own API endpoint: inside the published range, no PTR record at all.
      conn({
        remoteIp: '160.79.104.10',
        domain: '',
        verdict: 'allowlisted',
        verdictReason: 'ip-allowlist',
        flagged: false,
      }),
      // A confirmed name that is on no allowlist — the one case that IS an accusation.
      conn({
        pid: 101,
        remoteIp: '34.83.12.7',
        domain: '7.12.83.34.bc.googleusercontent.com',
        verdict: 'flagged',
        verdictReason: 'domain-not-allowlisted',
        flagged: true,
      }),
      // No name established. Not evidence of anything.
      conn({
        pid: 102,
        remoteIp: '45.33.32.156',
        domain: '',
        verdict: 'unknown',
        verdictReason: 'ptr-missing',
        flagged: true,
      }),
    ] as never);

    const { container } = render(NetworkPanel);
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(3));

    expect(badges(container)).toEqual(['safe', 'flagged', 'unknown']);
  });

  it('counts the class pills by verdict', async () => {
    network.set([
      conn({ verdict: 'allowlisted', verdictReason: 'ip-allowlist', flagged: false }),
      conn({ pid: 101, verdict: 'unknown', verdictReason: 'ptr-missing', flagged: true }),
      conn({
        pid: 102,
        domain: 'evil-server.xyz',
        verdict: 'flagged',
        verdictReason: 'domain-not-allowlisted',
        flagged: true,
      }),
      conn({
        pid: 103,
        domain: 'api.anthropic.com',
        verdict: 'allowlisted',
        verdictReason: 'domain-allowlist',
        flagged: false,
      }),
    ] as never);

    const { container } = render(NetworkPanel);
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(4));

    const pill = (cls: string) =>
      container.querySelector(`.pill.cls-${cls}`)?.textContent?.trim() ?? '';
    expect(pill('safe')).toBe('safe (2)');
    expect(pill('unknown')).toBe('unknown (1)');
    expect(pill('flagged')).toBe('flagged (1)');
  });

  it('shows the reason code and its explanation on the row', async () => {
    network.set([
      conn({ verdict: 'allowlisted', verdictReason: 'ip-allowlist', flagged: false }),
      conn({
        pid: 101,
        remoteIp: '45.33.32.156',
        verdict: 'unknown',
        verdictReason: 'ptr-unconfirmed',
        flagged: true,
      }),
    ] as never);

    const { container } = render(NetworkPanel);
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(2));

    const [first, second] = titles(container);
    expect(first).toContain('ip-allowlist');
    expect(first).toContain('published Anthropic IP range');
    // The endpoint the domain span used to carry in its own title is still reachable.
    expect(first).toContain('160.79.104.10:443');
    expect(second).toContain('ptr-unconfirmed');
    expect(second).toContain('did not resolve back');
  });

  it('falls back for records that predate the verdict field', async () => {
    // Demo pools and scans cached by an older build carry only `flagged` + `domain`.
    network.set([
      conn({ domain: 'api.anthropic.com', flagged: false }),
      conn({ pid: 101, domain: 'data-collector-unknown.io', flagged: true }),
      conn({ pid: 102, remoteIp: '45.33.32.156', domain: '', flagged: true }),
    ] as never);

    const { container } = render(NetworkPanel);
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(3));

    // A name that was not recognized is the flagged case; no name at all is unknown.
    expect(badges(container)).toEqual(['safe', 'flagged', 'unknown']);
    expect(titles(container)[1]).toContain('legacy');
  });

  it('filters rows by the verdict-derived class', async () => {
    network.set([
      conn({ verdict: 'allowlisted', verdictReason: 'ip-allowlist', flagged: false }),
      conn({
        pid: 101,
        remoteIp: '45.33.32.156',
        verdict: 'unknown',
        verdictReason: 'ptr-missing',
        flagged: true,
      }),
    ] as never);

    const { container } = render(NetworkPanel);
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(2));

    const unknownPill = container.querySelector('.pill.cls-unknown') as HTMLElement;
    unknownPill.click();
    await waitFor(() => expect(container.querySelectorAll('.net-row')).toHaveLength(1));
    expect(badges(container)).toEqual(['unknown']);
  });
});
