'use strict';

const { randomUUID } = require('node:crypto');
const { getInventoryProfile } = require('./inventory-profiles');
const { FORMATS } = require('./static-import-values');
let deps = {};
let sessions = new WeakMap();

const ERRORS = new Set([
  'snapshot-invalid',
  'snapshot-size-limit',
  'snapshot-unavailable',
  'snapshot-inside-subject',
  'snapshot-exists',
  'snapshot-digest-mismatch',
  'snapshot-already-accepted',
  'snapshot-incomplete',
  'snapshot-changed-since-review',
  'tool-catalog-invalid',
  'tool-catalog-unavailable',
  'external-report-unsupported-shape',
  'external-baseline-invalid',
  'report-size-limit',
]);

function valid(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const keys = Object.keys(request);
  if (['check-route', 'check-catalog'].includes(request.action))
    return (
      keys.length === 2 &&
      keys.every((key) => ['action', 'route'].includes(key)) &&
      (request.action === 'check-catalog'
        ? ['mcp-stdio', 'mcp-review']
        : ['direct', 'terminal', 'mcp-stdio', 'mcp-review']
      ).includes(request.route)
    );
  if (request.action === 'run') {
    if (
      !keys.every((key) =>
        ['action', 'mode', 'adapter', 'tools', 'baseline', 'format'].includes(key),
      ) ||
      !['scan', 'inventory', 'compare', 'import'].includes(request.mode) ||
      typeof request.tools !== 'boolean' ||
      typeof request.baseline !== 'boolean'
    )
      return false;
    if (request.mode === 'import') {
      if (
        request.tools ||
        typeof request.format !== 'string' ||
        !Object.hasOwn(FORMATS, request.format)
      )
        return false;
    } else if (request.baseline || request.format !== undefined) return false;
    if (request.adapter === 'package') return ['scan', 'import'].includes(request.mode);
    try {
      getInventoryProfile(request.adapter);
      return true;
    } catch (_) {
      return false;
    }
  }
  const accepting = request.action === 'accept';
  return (
    ['export', 'save-snapshot', 'accept'].includes(request.action) &&
    keys.every((key) => ['action', 'id', ...(accepting ? ['digest'] : [])].includes(key)) &&
    typeof request.id === 'string' &&
    /^[a-f0-9-]{36}$/.test(request.id) &&
    (!accepting || (typeof request.digest === 'string' && /^[a-f0-9]{64}$/.test(request.digest)))
  );
}

/** Initialize the native dialog boundary. @param {object} injected getWindow and dialog.
 * @returns {void} @since v0.15.1
 */
function init(injected) {
  deps = injected;
  sessions = new WeakMap();
}

/** Handle one serialized operation from the owned top-level frame.
 * No path, command, URL or report body supplied by the renderer is accepted.
 * @param {object} event Electron IPC event. @param {object} request Bounded options.
 * @returns {Promise<object>} Fixed failure/cancellation or a redacted report.
 * @since v0.15.1
 */
async function handle(event, request) {
  const window = deps.getWindow?.();
  const documentUrl = (value) => {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.href;
    } catch (_) {
      return null;
    }
  };
  const owned = () =>
    window &&
    !window.isDestroyed() &&
    deps.getWindow() === window &&
    event?.sender === window.webContents &&
    event?.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.detached !== true &&
    documentUrl(deps.rendererUrl) !== null &&
    documentUrl(event.senderFrame?.url) === documentUrl(deps.rendererUrl);
  if (!owned()) return { success: false, error: 'request-denied' };
  if (!valid(request)) return { success: false, error: 'invalid-review-request' };
  let session = sessions.get(event.sender);
  if (!session) {
    session = { frame: event.senderFrame, busy: false, retained: null, revision: 0 };
    sessions.set(event.sender, session);
    event.sender.on?.('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        session.revision++;
        session.controller?.abort();
        session.retained = null;
      }
    });
    event.sender.on?.('destroyed', () => {
      session.revision++;
      session.controller?.abort();
    });
  }
  if (session.busy) {
    if (session.frame !== event.senderFrame) session.controller?.abort();
    return { success: false, error: 'review-busy' };
  }
  if (session.frame !== event.senderFrame) {
    session.frame = event.senderFrame;
    session.revision++;
    session.retained = null;
  }
  const revision = session.revision;
  session.busy = true;
  const assertOwned = () => {
    if (!owned() || session.revision !== revision) {
      session.controller?.abort();
      throw new Error('request-denied');
    }
  };
  const pick = async (title, folder = false) => {
    assertOwned();
    const result = await deps.dialog.showOpenDialog(window, {
      title,
      properties: [folder ? 'openDirectory' : 'openFile'],
      ...(folder ? {} : { filters: [{ name: 'JSON / SARIF', extensions: ['json', 'sarif'] }] }),
    });
    assertOwned();
    if (result.canceled || result.filePaths?.length !== 1) throw new Error('cancelled');
    return result.filePaths[0];
  };
  try {
    if (request.action === 'check-route' || request.action === 'check-catalog') {
      const kind = request.action === 'check-route' ? 'single' : 'catalog';
      const route = request.route;
      const controller = new AbortController();
      session.controller = controller;
      let report;
      if (kind === 'single') {
        const policyPath = await pick('Select the schema 2 execution policy');
        const requestPath = await pick('Select the schema 1 action request');
        assertOwned();
        report = await (deps.checkActionRoute || require('./action-route-check').checkActionRoute)(
          route,
          policyPath,
          requestPath,
          { signal: controller.signal },
        );
      } else {
        const catalogPath = await pick('Select the action catalog manifest');
        assertOwned();
        report = await (
          deps.checkActionCatalogRoute || require('./action-catalog-check').checkActionCatalogRoute
        )(route, catalogPath, { signal: controller.signal });
      }
      assertOwned();
      return {
        success: true,
        check: { id: randomUUID(), kind, route, createdAt: new Date().toISOString(), report },
      };
    }
    if (request.action === 'run') {
      const directory = await pick('Select the directory to review', true);
      const toolsFile = request.tools
        ? await pick('Select an offline MCP tools/list export')
        : undefined;
      const reportFile =
        request.mode === 'import' ? await pick('Select the external scanner report') : undefined;
      const baselineFile =
        request.mode === 'compare' || request.baseline
          ? await pick(
              request.mode === 'compare'
                ? 'Select the inventory snapshot to compare'
                : 'Select the previous AEGIS static report',
            )
          : undefined;
      const retained = await (deps.backend ?? require('./local-security-review')).review({
        ...request,
        directory,
        toolsFile,
        reportFile,
        baselineFile,
      });
      assertOwned();
      retained.id = randomUUID();
      session.retained = retained;
      const candidate = retained.baseline ?? retained.snapshot;
      const canAccept =
        candidate?.state === 'observed' &&
        candidate.body.complete === true &&
        (request.mode === 'inventory' || retained.report.contentUnchanged === true);
      return {
        success: true,
        review: {
          id: retained.id,
          mode: request.mode,
          adapter: request.adapter,
          directory: retained.subject.root,
          createdAt: new Date().toISOString(),
          report: retained.report,
          snapshot: candidate
            ? {
                digest: candidate.digest,
                state: candidate.state,
                complete: candidate.body.complete,
                canAccept,
              }
            : null,
          canSaveSnapshot: Boolean(retained.snapshot),
        },
      };
    }
    const retained = session.retained;
    if (!retained || retained.id !== request.id) return { success: false, error: 'review-expired' };
    if (request.action === 'save-snapshot' && !retained.snapshot)
      return { success: false, error: 'snapshot-unavailable' };
    if (request.action === 'accept') {
      const candidate = retained.baseline ?? retained.snapshot;
      if (
        !candidate ||
        candidate.state !== 'observed' ||
        retained.accepted ||
        candidate.digest !== request.digest
      )
        return { success: false, error: 'snapshot-digest-mismatch' };
    }
    const result = await deps.dialog.showSaveDialog(window, {
      title:
        request.action === 'export'
          ? 'Export local review (new file)'
          : 'Save snapshot outside the reviewed directory (new file)',
      defaultPath:
        request.action === 'export'
          ? 'aegis-local-review.json'
          : request.action === 'accept'
            ? 'aegis-accepted-snapshot.json'
            : 'aegis-inventory-snapshot.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    assertOwned();
    if (result.canceled || !result.filePath) return { success: false, cancelled: true };
    const service = deps.backend ?? require('./local-security-review');
    if (request.action === 'accept') {
      await service.accept(retained, request.digest, result.filePath, assertOwned);
      retained.accepted = true;
    } else if (request.action === 'save-snapshot')
      await service.saveSnapshot(retained, result.filePath, assertOwned);
    else await service.exportReport(retained, result.filePath, assertOwned);
    assertOwned();
    return { success: true, saved: true, accepted: request.action === 'accept' };
  } catch (error) {
    if (error.message === 'cancelled') return { success: false, cancelled: true };
    return {
      success: false,
      error: ERRORS.has(error.message) ? error.message : 'local-review-unavailable',
    };
  } finally {
    session.controller?.abort();
    session.controller = null;
    session.busy = false;
  }
}

module.exports = { init, handle };
