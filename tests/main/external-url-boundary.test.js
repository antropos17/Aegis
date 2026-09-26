import { describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import boundary from '../../src/main/external-url-boundary.js';

const {
  parseExternalUrl,
  isTrustedSetupGuide,
  isAppDocumentUrl,
  ownsTopLevelRenderer,
  guardRendererNavigation,
} = boundary;

const guideFiles = [
  'ACTION-MCP-CONFIG.md',
  'ACTION-MCP-REVIEW.md',
  'ACTION-DELETE-FILE.md',
  'ACTION-MCP-STATUS.md',
];

describe('external URL boundary', () => {
  it.each([
    null,
    12,
    {},
    new String('https://example.com'),
    '',
    ' https://example.com',
    'https://example.com\n.evil',
    'https://example.com\\@evil.test',
    'https://',
    'javascript:alert(1)',
    'file:///tmp/page.html',
    'https://user:pass@example.com',
    'https://@example.com',
    'https://github.com@evil.test/docs',
    `https://example.com/${'a'.repeat(2048)}`,
  ])('rejects malformed, coercible, credentialed or oversized input', (value) => {
    expect(parseExternalUrl(value)).toBeNull();
  });

  it('passes a canonical bounded HTTP URL to the shell', () => {
    expect(parseExternalUrl('HTTPS://Example.COM:443/docs')).toEqual({
      href: 'https://example.com/docs',
      origin: 'https://example.com',
    });
    expect(parseExternalUrl(`https://example.com/${'ü'.repeat(500)}`)).toBeNull();
  });

  it('recognizes only the four exact canonical AEGIS setup guides', () => {
    for (const file of guideFiles) {
      const href = `https://github.com/antropos17/Aegis/blob/master/docs/${file}`;
      expect(isTrustedSetupGuide(parseExternalUrl(href).href)).toBe(true);
      expect(isTrustedSetupGuide(parseExternalUrl(href + '?next=evil').href)).toBe(false);
    }
    expect(
      isTrustedSetupGuide(
        parseExternalUrl(
          'https://github.com.evil.test/antropos17/Aegis/blob/master/docs/ACTION-MCP-CONFIG.md',
        ).href,
      ),
    ).toBe(false);
  });
});

describe('renderer document and navigation', () => {
  const appFile = pathToFileURL(path.resolve('fixture-app', 'dist', 'renderer', 'index.html')).href;

  it('compares parsed origin and exact document path in preview and packaged modes', () => {
    const preview = 'http://localhost:5173/app/index.html';
    expect(isAppDocumentUrl(preview + '?view=guide#section', preview)).toBe(true);
    expect(isAppDocumentUrl('http://localhost:5173.evil.test/app/index.html', preview)).toBe(false);
    expect(isAppDocumentUrl('http://localhost:5173/app/index.html.evil', preview)).toBe(false);
    expect(isAppDocumentUrl('http://localhost:5173/other/index.html', preview)).toBe(false);
    expect(isAppDocumentUrl(appFile + '#section', appFile)).toBe(true);
    expect(isAppDocumentUrl(appFile.replace('index.html', 'other.html'), appFile)).toBe(false);
    expect(isAppDocumentUrl('file://evil.test/AEGIS/dist/renderer/index.html', appFile)).toBe(
      false,
    );
    expect(isAppDocumentUrl('not a URL', appFile)).toBe(false);
  });

  it('rejects stale and foreign IPC frame ownership', () => {
    const frame = { url: appFile, isDestroyed: vi.fn(() => false) };
    const contents = {
      mainFrame: frame,
      getURL: () => appFile,
      isDestroyed: vi.fn(() => false),
    };
    const window = { webContents: contents, isDestroyed: vi.fn(() => false) };
    const event = { sender: contents, senderFrame: frame };
    expect(ownsTopLevelRenderer(event, window, appFile)).toBe(true);
    expect(ownsTopLevelRenderer({ ...event, sender: {} }, window, appFile)).toBe(false);
    contents.mainFrame = { ...frame };
    expect(ownsTopLevelRenderer(event, window, appFile)).toBe(false);
    contents.mainFrame = frame;
    frame.url = 'https://evil.test/';
    expect(ownsTopLevelRenderer(event, window, appFile)).toBe(false);
  });

  it('blocks frame navigations, redirects and all popups outside the loaded document', () => {
    const handlers = new Map();
    const contents = {
      on: vi.fn((name, listener) => handlers.set(name, listener)),
      setWindowOpenHandler: vi.fn(),
    };
    guardRendererNavigation(contents, appFile);
    const attempt = (name, url, isMainFrame = true) => {
      const event = { url, isMainFrame, preventDefault: vi.fn() };
      handlers.get(name)(event);
      return event.preventDefault.mock.calls.length;
    };
    expect(attempt('will-navigate', appFile + '#focus')).toBe(0);
    expect(attempt('will-navigate', appFile.replace('index.html', 'malicious.html'))).toBe(1);
    expect(attempt('will-frame-navigate', 'https://evil.test/')).toBe(1);
    expect(attempt('will-frame-navigate', appFile, false)).toBe(1);
    expect(attempt('will-redirect', 'https://evil.test/')).toBe(1);
    expect(attempt('will-redirect', appFile)).toBe(0);
    const popupHandler = contents.setWindowOpenHandler.mock.calls[0][0];
    expect(popupHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    expect(popupHandler({ url: 'file:///tmp/untrusted.html' })).toEqual({ action: 'deny' });
  });
});
