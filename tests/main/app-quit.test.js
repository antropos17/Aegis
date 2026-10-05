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
    dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
    getWindow: () => window,
    rendererUrl,
  };
  return { deps, frame, contents, window, event: { sender: contents, senderFrame: frame } };
}

describe('confirmed application exit', () => {
  it.each(['sender', 'frame', 'document', 'destroyed'])(
    'rejects an unowned %s before native confirmation',
    async (kind) => {
      const { deps, event, frame, window } = fixture();
      if (kind === 'sender') event.sender = {};
      if (kind === 'frame') event.senderFrame = {};
      if (kind === 'document') frame.url = 'https://example.org';
      if (kind === 'destroyed') window.isDestroyed = () => true;
      const handler = createQuitAppHandler(deps);
      expect(await handler(event)).toEqual({ success: false, error: 'Renderer request denied' });
      expect(deps.dialog.showMessageBox).not.toHaveBeenCalled();
      expect(deps.app.quit).not.toHaveBeenCalled();
    },
  );

  it('coalesces concurrent prompts and accepts a new request after cancellation', async () => {
    const { deps, event } = fixture();
    let answer;
    deps.dialog.showMessageBox.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const handler = createQuitAppHandler(deps);
    const first = handler(event);
    expect(await handler(event)).toMatchObject({ success: false });
    expect(deps.dialog.showMessageBox).toHaveBeenCalledOnce();
    answer({ response: 0 });
    expect(await first).toEqual({ success: false, cancelled: true });
    expect(await handler(event)).toEqual({ success: false, cancelled: true });
    expect(deps.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(deps.app.quit).not.toHaveBeenCalled();
  });

  it('revalidates frame ownership after native confirmation', async () => {
    const { deps, event, contents } = fixture();
    let answer;
    deps.dialog.showMessageBox.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const pending = createQuitAppHandler(deps)(event);
    contents.mainFrame = { ...contents.mainFrame };
    answer({ response: 1 });
    expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).not.toHaveBeenCalled();
  });

  it('revalidates the window again before deferred shutdown and releases the pending state if revoked', async () => {
    const { deps, event, window } = fixture();
    deps.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const handler = createQuitAppHandler(deps);
    expect(await handler(event)).toEqual({ success: true });
    expect(await handler(event)).toMatchObject({ success: false });
    deps.getWindow = () => window;
    window.isDestroyed = () => true;
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.app.quit).not.toHaveBeenCalled();
    window.isDestroyed = () => false;
    expect(await handler(event)).toEqual({ success: false, cancelled: true });
  });

  it('reports a fixed prompt failure and allows retry without exposing native details', async () => {
    const { deps, event } = fixture();
    deps.dialog.showMessageBox.mockRejectedValueOnce(new Error('PRIVATE native error'));
    const handler = createQuitAppHandler(deps);
    expect(await handler(event)).toEqual({
      success: false,
      error: 'App exit confirmation unavailable',
    });
    expect(await handler(event)).toEqual({ success: false, cancelled: true });
    expect(deps.app.quit).not.toHaveBeenCalled();
  });
});
