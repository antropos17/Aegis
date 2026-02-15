/**
 * @file theme.js - Dark/light mode toggle, persistence, and initialization.
 * Depends on state.js (no direct references needed beyond DOM).
 * @since 0.1.0
 */

/**
 * Check whether dark mode is currently active.
 * @returns {boolean} True if the body has the 'dark' class.
 * @since 0.1.0
 */
function isDark() { return document.body.classList.contains('dark'); }

const themeToggle = document.getElementById('theme-toggle');

/**
 * Apply or remove dark mode on the document body and update toggle icon.
 * @param {boolean} dark - True to enable dark mode, false for light.
 * @since 0.1.0
 */
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  themeToggle.textContent = dark ? '\uD83C\uDF19' : '\u2600\uFE0F';
}

themeToggle.addEventListener('click', async () => {
  const dark = !document.body.classList.contains('dark');
  applyTheme(dark);
  const s = await window.aegis.getSettings();
  s.darkMode = dark;
  await window.aegis.saveSettings(s);
});

// Load dark mode preference on init
window.aegis.getSettings().then(s => { if (s.darkMode) applyTheme(true); });
