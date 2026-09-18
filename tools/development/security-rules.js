// Semgrep regression fixture, never imported by the application.
// ruleid: aegis-electron-unsafe-preferences
const unsafe = { webPreferences: { nodeIntegration: true } };
// ok: aegis-electron-unsafe-preferences
const safe = { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } };
// ruleid: aegis-raw-ipc-bridge
contextBridge.exposeInMainWorld('bridge', ipcRenderer);
// ok: aegis-raw-ipc-bridge
contextBridge.exposeInMainWorld('bridge', { getVersion: () => ipcRenderer.invoke('version') });
// ruleid: aegis-dynamic-code-execution
eval(untrustedText);
// ok: aegis-dynamic-code-execution
JSON.parse(untrustedText);
