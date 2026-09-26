# External links and renderer navigation

The `open-external-url` IPC handler accepts only primitive, bounded HTTP or HTTPS URLs from the
owned top-level AEGIS document. It parses the URL before opening it through Electron's shell and
passes the canonical URL to the operating system. Credentials, empty hosts, raw control characters,
backslashes, malformed URLs and strings above 2048 characters are rejected. Neither failures nor
navigation guards log complete URLs or query strings.

The four fixed GitHub setup-guide URLs in `src/main/external-url-boundary.js` open directly. Other
sites, including agent catalog websites, require a native dialog parented to the AEGIS window. The
dialog uses English/Portuguese labels and displays the canonical origin and full canonical URL;
Cancel is the default and Escape choice. After an affirmative choice, the handler checks that the same window, top-level frame and
document still own the request before calling `shell.openExternal`.

The main window permits navigation only to the parsed origin and document path it loaded. This
closes development origin-prefix matches and packaged `file://` sibling-file navigation. Main and
subframe navigation, redirects and renderer popups are guarded; renderer popups are denied. AEGIS
does not control browser redirects after an approved URL leaves the app.

Focused coverage runs with
`npx vitest run tests/main/external-url-boundary.test.js tests/main/ipc-handlers.test.js`.
After `npm run build:renderer`, run
`node frontend/observatory/tests/external-url-electron.mjs` for the real Electron navigation and
popup smoke with a disposable profile. The smoke does not open an external browser.

Electron API references: [navigation events](https://www.electronjs.org/docs/latest/api/web-contents#navigation-events),
[window-open handler](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler),
and [parented message box](https://www.electronjs.org/docs/latest/api/dialog#dialogshowmessageboxwindow-options).
