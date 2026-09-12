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
