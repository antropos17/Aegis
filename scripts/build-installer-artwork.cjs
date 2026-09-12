/**
 * Render the installer SVG sources as high-DPI, uncompressed 24-bit NSIS bitmaps.
 * Run after changing artwork: node scripts/build-installer-artwork.cjs
 * Uses the existing sharp dependency; does not download fonts or images.
 */
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

/**
 * Encode top-down RGB pixels in the bottom-up BGR layout expected by Windows.
 * @param {Buffer} rgb Raw three-channel pixels.
 * @param {number} width Width in pixels.
 * @param {number} height Height in pixels.
 * @returns {Buffer} A BITMAPINFOHEADER file with rows padded to four bytes.
 * @since unreleased
 */
function bitmap(rgb, width, height) {
  const stride = (width * 3 + 3) & ~3;
  const pixels = stride * height;
  const output = Buffer.alloc(54 + pixels);
  output.write('BM');
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixels, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dest = 54 + (height - 1 - y) * stride + x * 3;
      output[dest] = rgb[src + 2];
      output[dest + 1] = rgb[src + 1];
      output[dest + 2] = rgb[src];
    }
  }
  return output;
}

async function main() {
  const root = path.resolve(__dirname, '../build/installer');
  for (const name of ['sidebar', 'header']) {
    const { data, info } = await sharp(path.join(root, `${name}.svg`))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`${name}: expected RGB artwork`);
    await fs.writeFile(path.join(root, `${name}.bmp`), bitmap(data, info.width, info.height));
    process.stdout.write(`${name}: ${info.width} × ${info.height}\n`);
  }
  // PNG-backed ICO frames avoid upscaling a single small icon in Explorer/UAC.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(
    sizes.map((size) =>
      sharp(path.join(root, 'installer.svg')).resize(size, size).png().toBuffer(),
    ),
  );
  const directory = Buffer.alloc(6 + 16 * frames.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach((frame, index) => {
    const entry = 6 + 16 * index;
    directory[entry] = sizes[index] % 256;
    directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await fs.writeFile(path.join(root, 'installer.ico'), Buffer.concat([directory, ...frames]));
  process.stdout.write(`installer.ico: ${sizes.join(', ')} px\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
