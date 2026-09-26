# Desktop icon and tray menu

The application window, packaged executable and shortcuts use the neutral
Observatory shield. The tray uses the same shield with a green/yellow/red status
marker. `assets/icon.svg` is the editable source, matching the installer identity.
Run `node scripts/make-icon.js` to regenerate the PNG, tray variants and real ICO
containing 16, 24, 32, 48, 64, 128 and 256 px frames.

Right-click the tray icon beside the clock for Open AEGIS, Pause/Resume Monitoring,
Settings and Quit. Open and double-click restore and focus the existing window.
Settings opens its retained workspace, including when the window was hidden or
minimized. Navigation waits for the renderer when necessary. Pause/Resume uses
the existing sensor/scan callbacks and updates the label and tooltip. Quit uses
the normal shutdown lifecycle.

The installed Windows app uses the same `com.aegis.oversight` identity as its
installer shortcuts. Development uses a separate identity. No persistent Windows
Jump List is registered. Installed executables must be updated to receive these
changes; old pinned shortcuts may need unpinning and pinning again. AEGIS does
not clear the system icon cache.

The runtime identity lives in the desktop platform adapter. It must not read
`package.json.build`: electron-builder removes that configuration when packaging.
The identity test checks that the runtime value still matches the installer.

Native verification: build the renderer and run
`node frontend/observatory/tests/tray-smoke.mjs` on Windows. This uses a disposable
profile, invokes the actual native menu callbacks (including pause/resume and
Quit), and writes fixed-name screenshots and a receipt under `dist/tray-qa`.
Keep receipts; review disposable profiles/screenshots after 14 days or when this
directory exceeds 64 MiB. This does not test an existing installed shortcut upgrade.

To exercise the packaged EXE, set `AEGIS_SMOKE_EXECUTABLE` to its absolute path
and run the same script. It asserts packaged mode and the absence of build
metadata, loads the actual tray module from the application archive, and writes
to `dist/packaged-tray-qa` with the same retention guidance. A source-mode run
alone cannot establish that the packaged application starts.
