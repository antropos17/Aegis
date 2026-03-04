/**
 * @file capture-screenshots.mjs
 * @description Captures fullscreen screenshots of every Aegis tab using Playwright Electron.
 *   Uses the demo build (dist/demo/) so all tabs have populated data.
 *   Run: node scripts/capture-screenshots.mjs
 */
import { _electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const DEMO_HTML = path.join(ROOT, 'dist', 'demo', 'index.html');

// Tabs to capture — id matches #tab-{id} selector in TabBar.svelte
const TABS = [
  { id: 'shield', filename: '01-shield-tab.png' },
  { id: 'activity', filename: '02-activity-tab.png' },
  { id: 'rules', filename: '03-rules-tab.png' },
  { id: 'reports', filename: '04-reports-tab.png' },
  { id: 'stats', filename: '05-stats-tab.png' },
];

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Verify demo build exists
  if (!fs.existsSync(DEMO_HTML)) {
    console.error('Demo build not found. Run: npm run build:demo');
    process.exit(1);
  }

  console.log('Launching Electron...');

  // VS Code terminals set ELECTRON_RUN_AS_NODE=1 which prevents Electron GUI.
  // Pass a clean env without it so Electron launches as a proper desktop app.
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  // Launch minimal Electron app via _screenshot-entry.cjs.
  // Without preload, window.aegis is undefined → renderer enters demo mode automatically.
  const ENTRY = path.join(ROOT, 'scripts', '_screenshot-entry.cjs');
  const electronApp = await _electron.launch({
    args: ['--no-sandbox', ENTRY],
    env: cleanEnv,
  });

  const page = await electronApp.firstWindow();
  console.log('Window opened, waiting for demo data to populate...');

  // Wait for DOM + demo mode to seed stores + Svelte to render
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);

  // Capture each tab
  for (const tab of TABS) {
    console.log(`  Capturing: ${tab.id}...`);
    await page.click(`#tab-${tab.id}`);
    // Wait for slide animation (220ms) + extra buffer for rendering
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, tab.filename),
      fullPage: false,
    });
    console.log(`    -> ${tab.filename}`);
  }

  // Capture Settings overlay
  console.log('  Capturing: settings...');
  await page.keyboard.press('s');
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUT_DIR, '06-settings.png'),
    fullPage: false,
  });
  console.log('    -> 06-settings.png');

  // Close
  await electronApp.close();
  console.log('\nDone! Screenshots saved to docs/screenshots/');
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
