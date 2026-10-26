'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Launch the actual desktop host with an owned home/profile and normal monitoring.
 * @param {string} root Repository. @param {string} directory Arm-owned directory.
 * @param {number} pid Fixed workload PID. @returns {Promise<object>} Capture and close operations.
 * @since 0.21.0 */
async function startMonitor(root, directory, pid) {
  const { _electron } = require('playwright');
  const profile = path.join(directory, 'profile'),
    home = path.join(directory, 'home');
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      scanIntervalSec: 1,
      startMinimized: true,
      automaticUpdatesEnabled: false,
      notificationsEnabled: false,
      customAgents: [
        {
          id: 'native-workload-fixture',
          displayName: 'Native workload fixture',
          names: ['aegis-bench-workload.exe'],
          category: 'cli-tool',
          riskProfile: 'low',
          defaultTrust: 100,
        },
      ],
    }),
  );
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: [
      root,
      '--user-data-dir=' + profile,
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    env,
    timeout: 45000,
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
      .waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(
      ({ owned, pid }) => {
        globalThis.__nativeBench = { events: [], evicted: 0, actorSeen: false };
        globalThis.aegis.onScanBatch((batch) => {
          if (
            batch.agents?.some((row) => row.pid === pid && row.agent === 'Native workload fixture')
          )
            globalThis.__nativeBench.actorSeen = true;
        });
        globalThis.aegis.onFileAccess((value) => {
          for (const row of Array.isArray(value) ? value : [value])
            if (
              typeof row.file === 'string' &&
              row.file
                .replaceAll('/', '\\')
                .toLowerCase()
                .startsWith(owned.replaceAll('/', '\\').toLowerCase() + '\\')
            ) {
              const capture = globalThis.__nativeBench;
              if (capture.events.length === 1024) {
                capture.events.shift();
                capture.evicted++;
              }
              capture.events.push({
                eventId: row.eventId || null,
                file: row.file,
                action: row.action || null,
                instanceId: row.instanceId || null,
                timestamp: row.timestamp || null,
                sensitive: row.sensitive === true,
              });
            }
        });
      },
      { owned: directory, pid },
    );
    return {
      async snapshot() {
        return page.evaluate(async () => ({
          ...globalThis.__nativeBench,
          stats: await globalThis.aegis.getStats(),
        }));
      },
      async close() {
        await closeApp(app);
      },
    };
  } catch (error) {
    await closeApp(app);
    throw error;
  }
}
async function closeApp(app) {
  const own = app.process();
  const timer = setTimeout(() => {
    if (own.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(own.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {
        /* Owned process exited. */
      }
    }
  }, 8000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { startMonitor };
