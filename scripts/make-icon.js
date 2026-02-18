const sharp = require('sharp');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');
const pngPath = path.join(assetsDir, 'icon.png');
const icoPath = path.join(assetsDir, 'icon.ico');

async function main() {
  // SVG → 256x256 PNG
  await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(pngPath);
  console.log('Created icon.png (256x256)');

  // Copy PNG as .ico (electron-builder accepts PNG-formatted .ico on Windows)
  const fs = require('fs');
  fs.copyFileSync(pngPath, icoPath);
  console.log('Created icon.ico (copy of PNG)');

  const stats = fs.statSync(icoPath);
  console.log(`icon.ico size: ${stats.size} bytes`);
}

main().catch(err => { console.error(err); process.exit(1); });
