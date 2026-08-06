/**
 * production-no-demo.test.ts — what a production build does with no preload bridge.
 *
 * The demo engine used to start on `!window.aegis` alone, so a release artifact that
 * failed to load `preload.js` filled its dashboard with fabricated agents, files and
 * connections — indistinguishable, to a viewer, from a live scan. The engine is now
 * reachable only through a build-time flag, and this pins the resulting behaviour: no
 * bridge and no demo build means empty stores and an explicit unavailable state.
 *
 * `import.meta.env.VITE_DEMO_MODE` is undefined under Vitest — exactly the production
 * case — so these run the default build's code path without any stubbing.
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

// No `window.aegis` is installed: this file is the no-bridge case. `stores/ipc` decides
// at module evaluation, so the import must happen with the bridge already absent.
expect((window as unknown as { aegis?: unknown }).aegis).toBeUndefined();

const ipc = await import('../../../src/renderer/lib/stores/ipc.js');
const BridgeUnavailableBanner = (
  await import('../../../src/renderer/lib/components/BridgeUnavailableBanner.svelte')
).default;
const ThreatAnalysis = (await import('../../../src/renderer/lib/components/ThreatAnalysis.svelte'))
  .default;

describe('production build without the preload bridge', () => {
  describe('build flags', () => {
    it('is not a demo build', () => {
      expect(ipc.isDemoBuild).toBe(false);
    });

    it('reports the bridge as absent and live data as unavailable', () => {
      expect(ipc.bridgeAvailable).toBe(false);
      expect(ipc.liveDataUnavailable).toBe(true);
    });

    it('still disables desktop-only actions via isDemoMode', () => {
      // isDemoMode is broader than isDemoBuild on purpose — it gates the export/audit
      // buttons, which need the bridge whatever the build is.
      expect(ipc.isDemoMode).toBe(true);
    });
  });

  describe('stores', () => {
    it('holds no agents, events, network connections or stats', () => {
      expect(get(ipc.agents)).toEqual([]);
      expect(get(ipc.events)).toEqual([]);
      expect(get(ipc.network)).toEqual([]);
      expect(get(ipc.stats)).toEqual({});
      expect(get(ipc.anomalies)).toEqual({});
    });

    it('stays empty after the microtasks a dynamic import would resolve on', async () => {
      // The demo engine now loads asynchronously in a demo build. If the gate leaked, the
      // seed would land within a few microtasks rather than synchronously — so assert
      // after flushing them, not just at import time.
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      expect(get(ipc.agents)).toEqual([]);
      expect(get(ipc.network)).toEqual([]);
    });

    it('never raises the demo-data indicator', () => {
      expect(get(ipc.demoDataActive)).toBe(false);
    });

    it('leaves firstScanDone false — no scan ran, and none is claimed', () => {
      expect(get(ipc.firstScanDone)).toBe(false);
    });
  });

  describe('BridgeUnavailableBanner', () => {
    it('states that monitoring is not running, as an alert', () => {
      const { container } = render(BridgeUnavailableBanner);
      const alert = container.querySelector('[role="alert"]');
      expect(alert).toBeTruthy();
      expect(alert?.textContent).toContain('Monitoring is not running');
    });

    it('says the emptiness is missing data, not a quiet machine', () => {
      const { container } = render(BridgeUnavailableBanner);
      expect(container.textContent).toContain('Nothing below is simulated');
    });
  });

  describe('ThreatAnalysis', () => {
    it('reports the analysis as unavailable instead of fabricating a verdict', async () => {
      const { container, getByRole } = render(ThreatAnalysis);
      await fireEvent.click(getByRole('button', { name: /analy/i }));

      await waitFor(() => expect(container.querySelector('.ta-error')).toBeTruthy());
      expect(container.querySelector('.ta-error')?.textContent).toContain(
        'Threat analysis is unavailable',
      );
      expect(container.querySelector('.ta-results')).toBeNull();
    });

    it('renders no fictional demo hostname', async () => {
      const { container, getByRole } = render(ThreatAnalysis);
      await fireEvent.click(getByRole('button', { name: /analy/i }));

      await waitFor(() => expect(container.querySelector('.ta-error')).toBeTruthy());
      expect(container.textContent).not.toContain('data-collector-unknown.io');
    });
  });
});
