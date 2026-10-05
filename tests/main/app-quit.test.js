import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createQuitAppHandler } = require('../../src/main/app-quit');

function fixture() {
  const rendererUrl = 'file:///aegis/dist/renderer/index.html';
  const frame = { url: rendererUrl, isDestroyed: () => false };
  const contents = { mainFrame: frame, getURL: () => rendererUrl, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const deps = {
    app: { quit: vi.fn() },
    getWindow: () => window,
    rendererUrl,
  };
  return { deps, frame, contents, window, event: { sender: contents, senderFrame: frame } };
}

describe('confirmed application exit', () => {
  it.each(['sender', 'frame', 'document', 'destroyed'])(
    'rejects an unowned %s even with explicit confirmation',
    async (kind) => {
      const { deps, event, frame, window } = fixture();
      if (kind === 'sender') event.sender = {};
      if (kind === 'frame') event.senderFrame = {};
      if (kind === 'document') frame.url = 'https://example.org';
      if (kind === 'destroyed') window.isDestroyed = () => true;
      const handler = createQuitAppHandler(deps);
      expect(await handler(event, true)).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
      expect(deps.app.quit).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, false, null, 1, 'true', { confirmed: true }])(
    'rejects missing or malformed confirmation %j without scheduling exit',
    async (confirmed) => {
      const { deps, event } = fixture();
      expect(await createQuitAppHandler(deps)(event, confirmed)).toEqual({
        success: false,
        error: 'App exit confirmation required',
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(deps.app.quit).not.toHaveBeenCalled();
    },
  );

  it('coalesces confirmed requests and schedules normal exit only after replying', async () => {
    const { deps, event } = fixture();
    const handler = createQuitAppHandler(deps);
    expect(await handler(event, true)).toEqual({ success: true });
    expect(await handler(event, true)).toMatchObject({ success: false });
    expect(deps.app.quit).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).toHaveBeenCalledOnce();
  });

  it('revalidates the window again before deferred shutdown and releases the pending state if revoked', async () => {
    const { deps, event, window } = fixture();
    const handler = createQuitAppHandler(deps);
    expect(await handler(event, true)).toEqual({ success: true });
    expect(await handler(event, true)).toMatchObject({ success: false });
    deps.getWindow = () => window;
    window.isDestroyed = () => true;
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).not.toHaveBeenCalled();
    window.isDestroyed = () => false;
    expect(await handler(event, true)).toEqual({ success: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).toHaveBeenCalledOnce();
  });

  it('revalidates frame ownership immediately before deferred shutdown', async () => {
    const { deps, event, contents } = fixture();
    expect(await createQuitAppHandler(deps)(event, true)).toEqual({ success: true });
    contents.mainFrame = { ...contents.mainFrame };
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).not.toHaveBeenCalled();
  });
});
