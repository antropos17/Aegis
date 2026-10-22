# Observatory Windows installer

The English-only assisted NSIS installer uses Observatory's neutral light surfaces,
graphite sidebar and Segoe UI. App language preferences are independent of installer
language. The wizard provides welcome, user scope, location, progress and finish
pages; the uninstaller uses the same artwork and explains profile retention.

`observatory.nsh` customizes the supported electron-builder hooks. The builder still
owns install-mode detection, elevation, directory validation, file replacement,
registry entries, shortcuts and uninstall behavior. The app ID, executable name,
profile location and `deleteAppDataOnUninstall: false` are unchanged. The finish
action preserves the builder's unelevated launch and `--updated` argument.

The sidebar/header bitmaps are rendered at three times their reference dimensions.
The installer ICO contains 16, 24, 32, 48, 64, 128 and 256 px PNG frames. These assets
are committed so packaging does not depend on font availability or an extra image
generation step. To regenerate them on Windows with Segoe UI installed:

```powershell
node scripts/build-installer-artwork.cjs
```

Welcome and finish artwork uses `FitControl` for both installation and removal.
The sidebar stays inside the native MUI image control as dialog units scale with
the font and DPI. `AspectFitHeight` can widen that control into the adjacent title,
body and launch checkbox. The cloud wizard qualification checks their actual
window rectangles and retains foreground screenshots for visual review.

Build the real installer from the repository root:

```powershell
npm run build:renderer
npx electron-builder --win --x64 --publish never
```

For visual review without installing or removing the application, compile
`preview.nsi` from this directory with the makensis executable downloaded by
electron-builder:

```powershell
makensis /V2 preview.nsi
makensis /V2 /DPREVIEW_UNINSTALL preview.nsi
```

These produce `dist/installer-preview.exe` and `dist/uninstaller-preview.exe`.
The harness reuses the production artwork, page copy and typography, with a timed
empty section and a no-op launch callback. It never changes installation files or
registry keys. Its progress is illustrative and it does not exercise the builder's
user-scope page, installation, upgrade, elevation or profile retention.

Before shipping a release, run the real installer qualification on a disposable
Windows host, including silent `/S /currentuser /D=...` installation, upgrade and
uninstall/reinstall profile retention. The existing
`scripts/qualify-windows-installer.ps1` covers that lifecycle. Visual preview or
successful compilation alone does not establish those results.

The manually dispatched `windows-installer-lifecycle.yml` workflow defaults to
`candidate=published`: it downloads the pinned 0.20.1-beta release and verifies
its signed manifest, source commit and installer SHA-256 before execution. With
`target=windows11-wizard`, it exercises the interactive installer and uninstaller
in disposable Windows 11 ARM64 guests. The upgrade baseline is the published
0.20.0-beta release, installed silently before the current-version wizard runs.

The workflow can also build the
checked-out revision with `candidate=build` and test it with
`target=windows11-wizard`. The x64 installer is built on Windows Server, transferred
within the same workflow run, and checked against its source/run/hash receipt in
disposable Windows 11 ARM64 guests. This path uses no release signing key and
publishes no release. It covers current-user install, upgrade from the pinned
0.20.0 release, launch, uninstall, reinstall and profile retention. Native x64
Windows 11, all-users elevation, automatic update delivery and Finish auto-launch
remain outside that qualification. Artifacts expire after seven days.

`target=windows11-x64` with `candidate=published` provisions a separate Windows 11
Enterprise Evaluation x64 Hyper-V guest for each scenario on a disposable hosted
Windows Server runner. It reuses the existing pinned Microsoft ISO, supported
Secure Boot/vTPM configuration and exact-VM lifecycle helpers. The guest has no
network adapter. Signed release assets and the locked Playwright driver are
verified and transferred through PowerShell Direct; the test runs in a temporary
local account's interactive console. Native CPU/OS/driver/app architecture is
recorded, and the VM must be observed off and removed before PASS. No local host,
personal profile, cloud subscription or external desktop port is used. This lane
covers current-user wizard installation, upgrade, launch/restart, removal and
synthetic profile retention; it does not qualify automatic-update delivery,
all-users elevation or full sensor/protection behavior.

`target=windows11-x64-updater` exercises the published 0.20.0-beta app's automatic
update path to 0.20.1-beta in one fresh native x64 Windows 11 guest. Only the old
installer is transferred to the guest. The test enables the normal preference,
waits for the real background schedule and download, verifies the downloaded
installer hash, chooses Later once, then confirms Install and restart. It records
the automatically relaunched process/window and checks the new version and
retained synthetic settings in subsequent controlled launches.

This case adds an owned internal switch and outbound WinNAT network after offline
Windows setup, following [Microsoft's NAT setup](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/setup-nat-network).
An existing NAT or conflicting subnet refuses execution. No inbound mapping,
proxy, TLS interception, feed replacement or credential is supplied to the app.
The temporary network must be removed after the VM. Other installer cases retain
their offline scope. The update requires the app's normal restart confirmation;
automatic discovery/download does not imply installation without consent.
