'use strict';

const MAX_EXTERNAL_URL_LENGTH = 2048;
const SETUP_GUIDES = new Set(
  [
    'ACTION-MCP-CONFIG.md',
    'ACTION-MCP-REVIEW.md',
    'ACTION-DELETE-FILE.md',
    'ACTION-MCP-STATUS.md',
  ].map((file) => `https://github.com/antropos17/Aegis/blob/master/docs/${file}`),
);

/** Parse a renderer supplied website URL before passing its canonical form to the OS.
 * @param {unknown} value Candidate URL.
 * @returns {{href: string, origin: string}|null} Bounded HTTP(S) URL, or null.
 * @since v0.16.0-alpha
 */
function parseExternalUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_EXTERNAL_URL_LENGTH ||
    value.trim() !== value ||
    value.includes('\\') ||
    !/^https?:\/\//i.test(value)
  )
    return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      authority.includes('@') ||
      url.href.length > MAX_EXTERNAL_URL_LENGTH
    )
      return null;
    return { href: url.href, origin: url.origin };
  } catch (_) {
    return null;
  }
}

/** Identify the four fixed setup guides that AEGIS opens without a second prompt.
 * @param {string} href Canonical URL returned by parseExternalUrl.
 * @returns {boolean} Whether it exactly matches a fixed guide.
 * @since v0.16.0-alpha
 */
function isTrustedSetupGuide(href) {
  return SETUP_GUIDES.has(href);
}

/** Compare parsed document identity, including the full file path in packaged builds.
 * Query strings and fragments do not select another document.
 * @param {unknown} candidate Navigation or sender document URL.
 * @param {string} expected URL used to load the AEGIS renderer.
 * @returns {boolean} Whether the origin and document path match.
 * @since v0.16.0-alpha
 */
function isAppDocumentUrl(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  try {
    const current = new URL(candidate);
    const app = new URL(expected);
    return (
      current.protocol === app.protocol &&
      current.origin === app.origin &&
      current.hostname === app.hostname &&
      current.pathname === app.pathname
    );
  } catch (_) {
    return false;
  }
}

/** Confirm an IPC call still belongs to the loaded top-level AEGIS document.
 * @param {object} event Electron IPC event.
 * @param {object} window Owned BrowserWindow.
 * @param {string} appDocumentUrl URL used to load that window.
 * @returns {boolean} Whether the sender, frame and document remain owned.
 * @since v0.16.0-alpha
 */
function ownsTopLevelRenderer(event, window, appDocumentUrl) {
  const contents = window?.webContents;
  const frame = event?.senderFrame;
  return Boolean(
    window &&
    typeof window.isDestroyed === 'function' &&
    !window.isDestroyed() &&
    contents &&
    typeof contents.isDestroyed === 'function' &&
    !contents.isDestroyed() &&
    event.sender === contents &&
    frame &&
    frame === contents.mainFrame &&
    typeof frame.isDestroyed === 'function' &&
    !frame.isDestroyed() &&
    isAppDocumentUrl(frame.url, appDocumentUrl) &&
    isAppDocumentUrl(contents.getURL(), appDocumentUrl),
  );
}

/** Keep renderer navigation on its loaded document and deny renderer popups.
 * @param {object} contents BrowserWindow webContents.
 * @param {string} appDocumentUrl URL used to load the AEGIS renderer.
 * @returns {void}
 * @since v0.16.0-alpha
 */
function guardRendererNavigation(contents, appDocumentUrl) {
  const blockForeign = (event) => {
    if (event.isMainFrame !== true || !isAppDocumentUrl(event.url, appDocumentUrl))
      event.preventDefault();
  };
  contents.on('will-frame-navigate', blockForeign);
  contents.on('will-redirect', blockForeign);
  contents.on('will-navigate', (event) => {
    if (!isAppDocumentUrl(event.url, appDocumentUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = {
  parseExternalUrl,
  isTrustedSetupGuide,
  isAppDocumentUrl,
  ownsTopLevelRenderer,
  guardRendererNavigation,
};
