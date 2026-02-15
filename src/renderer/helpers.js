/**
 * @file helpers.js - Utility functions for formatting, rendering, and DOM helpers.
 * Depends on state.js being loaded first (uses agentActivityBins, toastEl).
 * @since 0.1.0
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} Formatted string, e.g. "2h 15m", "5m 30s", "12s".
 * @since 0.1.0
 */
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Shift sparkline bins every 60s
setInterval(() => {
  for (const name of Object.keys(agentActivityBins)) {
    const bins = agentActivityBins[name];
    bins.shift();
    bins.push(0);
  }
}, 60000);

/**
 * Draw a sparkline bar chart on a canvas element.
 * @param {HTMLCanvasElement} canvas - Target canvas element.
 * @param {number[]} bins - Array of 30 numeric values.
 * @param {string} [color] - CSS color string for bar fill.
 * @since 0.1.0
 */
function drawSparkline(canvas, bins, color) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const maxVal = Math.max(1, ...bins);
  const barW = 3;
  const gap = 1;
  const totalBars = bins.length;

  for (let i = 0; i < totalBars; i++) {
    const val = bins[i];
    if (val === 0) continue;
    const barH = Math.max(2, (val / maxVal) * h);
    const x = i * (barW + gap);
    ctx.fillStyle = color || 'rgba(78, 205, 196, 0.7)';
    ctx.fillRect(x, h - barH, barW, barH);
  }
}

/**
 * Format a Date object to a 24-hour time string.
 * @param {Date} date - Date to format.
 * @returns {string} Time string, e.g. "14:30:05".
 * @since 0.1.0
 */
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Format milliseconds as an uptime counter string (HH:MM:SS).
 * @param {number} ms - Uptime in milliseconds.
 * @returns {string} Formatted string, e.g. "02:15:30".
 * @since 0.1.0
 */
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

/**
 * Escape a string for safe insertion into HTML.
 * @param {string} str - Raw string to escape.
 * @returns {string} HTML-safe string with entities escaped.
 * @since 0.1.0
 */
function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Show a toast notification message.
 * @param {string} msg - Message text to display.
 * @param {string} [type] - Toast type: 'success', 'error', 'warn', or empty.
 * @since 0.1.0
 */
function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type || ''}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.className = 'toast hidden'; }, 3000);
}

/**
 * Check whether a file path points to a configuration file.
 * @param {string} filePath - File path to test.
 * @returns {boolean} True if the path matches common config file patterns.
 * @since 0.1.0
 */
function isConfigFile(filePath) {
  return /\.(json|yaml|yml|toml|ini|cfg|conf|config|xml|properties)$/i.test(filePath) ||
         /[\\\/]\.[a-z][a-z0-9]*rc$/i.test(filePath) ||
         /[\\\/]\.gitconfig$/i.test(filePath) ||
         /[\\\/]\.npmrc$/i.test(filePath);
}

/**
 * Get an emoji icon for a file based on its extension or path.
 * @param {string} filePath - File path to inspect.
 * @returns {string} Emoji character representing the file type.
 * @since 0.1.0
 */
function getFileTypeIcon(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: '\uD83D\uDCDC', ts: '\uD83D\uDCDC', jsx: '\uD83D\uDCDC', tsx: '\uD83D\uDCDC',
    json: '\uD83D\uDCC4', yaml: '\uD83D\uDCC4', yml: '\uD83D\uDCC4', toml: '\uD83D\uDCC4',
    env: '\uD83D\uDD12', key: '\uD83D\uDD11', pem: '\uD83D\uDD11',
    py: '\uD83D\uDC0D', rb: '\uD83D\uDC8E', go: '\uD83D\uDCE6',
    css: '\uD83C\uDFA8', html: '\uD83C\uDF10', md: '\uD83D\uDCDD',
    sh: '\uD83D\uDCBB', bat: '\uD83D\uDCBB', ps1: '\uD83D\uDCBB',
    png: '\uD83D\uDDBC', jpg: '\uD83D\uDDBC', svg: '\uD83D\uDDBC',
    zip: '\uD83D\uDCE6', tar: '\uD83D\uDCE6', gz: '\uD83D\uDCE6',
  };
  if (/[\\\/]\.ssh[\\\/]/i.test(filePath)) return '\uD83D\uDD11';
  if (/[\\\/]\.aws[\\\/]/i.test(filePath)) return '\u2601';
  if (/[\\\/]\.env/i.test(filePath)) return '\uD83D\uDD12';
  return map[ext] || '\uD83D\uDCC1';
}

/**
 * Determine the severity CSS class for a feed event.
 * @param {Object} ev - Event object with .sensitive and .file properties.
 * @returns {string} CSS class name: 'sev-sensitive', 'sev-config', or 'sev-normal'.
 * @since 0.1.0
 */
function getSeverityClass(ev) {
  if (ev.sensitive) return 'sev-sensitive';
  // Check for config-like files
  if (/\.(json|yaml|yml|toml|ini|cfg|conf|config)$/i.test(ev.file) ||
      /[\\\/]\.[a-z]/i.test(ev.file)) return 'sev-config';
  return 'sev-normal';
}

/**
 * Shorten a file path to just the last two path segments.
 * @param {string} filePath - Full file path.
 * @returns {string} Shortened path, e.g. ".../folder/file.txt".
 * @since 0.1.0
 */
function shortenPath(filePath) {
  if (!filePath) return '';
  const sep = filePath.includes('/') ? '/' : '\\';
  const parts = filePath.split(sep).filter(Boolean);
  if (parts.length <= 2) return filePath;
  return '...' + sep + parts.slice(-2).join(sep);
}
