// Run with node scripts/make-icon.js; uses the existing sharp dev dependency.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs/promises');
const assetsDir = path.join(__dirname, '..', 'assets');

async function main() {
  const svg = await fs.readFile(path.join(assetsDir, 'icon.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(
    sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
  );
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    directory[entry] = sizes[index] % 256;
    directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await fs.writeFile(path.join(assetsDir, 'icon.ico'), Buffer.concat([directory, ...frames]));
  await fs.writeFile(path.join(assetsDir, 'icon.png'), frames.at(-1));
  for (const [color, fill] of Object.entries({
    green: '#00e676',
    yellow: '#ffc107',
    red: '#ff1744',
  })) {
    const marker = Buffer.from(
      `<svg width="32" height="32"><circle cx="26" cy="26" r="5" fill="${fill}" stroke="#202224" stroke-width="2"/></svg>`,
    );
    await sharp(svg)
      .resize(32, 32)
      .composite([{ input: marker }])
      .png()
      .toFile(path.join(assetsDir, `tray-${color}.png`));
  }
  console.log('Created icon.png and seven-resolution icon.ico');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
