# Application icon

Packaging and the application use `assets/icon.png`. The source artwork is `assets/icon.svg`; `node scripts/make-icon.js` regenerates the PNG.

The existing `icon.ico` is a duplicate PNG under an ICO filename and is not referenced by the packaging configuration. Do not use it as an ICO asset.
