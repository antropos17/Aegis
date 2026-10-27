/** @file Build the pinned Linux procfs sensor for an ordinary Linux package. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const TARGETS = Object.freeze({
  x64: { triple: 'x86_64-unknown-linux-gnu', machine: 62 },
  arm64: { triple: 'aarch64-unknown-linux-gnu', machine: 183 },
});

/** Check that the compiler produced an executable of the requested Linux architecture.
 * @param {string} filename Build output path.
 * @param {string} arch Electron target architecture.
 * @returns {void}
 * @since 0.21.0-beta
 */
function verifyElf(filename, arch) {
  const expected = TARGETS[arch];
  if (!expected) throw new Error('Linux sensor architecture is unsupported');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || (stat.mode & 0o111) === 0 || stat.size < 64)
    throw new Error('Linux sensor output is not an executable file');
  const fd = fs.openSync(filename, 'r');
  const header = Buffer.alloc(64);
  let count;
  try {
    count = fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (
    count !== header.length ||
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header[6] !== 1 ||
    ![2, 3].includes(header.readUInt16LE(16)) ||
    header.readUInt16LE(18) !== expected.machine ||
    header.readUInt32LE(20) !== 1
  )
    throw new Error('Linux sensor output has an invalid ELF architecture or header');
}

/** Build and stage a sensor for a matching, native GNU/Linux target.
 * @param {object} options Target and private test seams.
 * @returns {string} Staged binary path.
 * @since 0.21.0-beta
 */
function buildLinuxSensor({
  arch,
  platform = process.platform,
  hostArch = process.arch,
  root,
  run = execFileSync,
}) {
  const target = TARGETS[arch];
  if (platform !== 'linux' || !target || arch !== hostArch)
    throw new Error('Linux sensor packaging requires a matching Linux x64 or arm64 host');
  const projectRoot = root ?? path.resolve(__dirname, '..');
  const sensors = path.join(projectRoot, 'sensors');
  const toolchain = fs.readFileSync(path.join(sensors, 'rust-toolchain.toml'), 'utf8');
  const channel = /^channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m.exec(toolchain)?.[1];
  if (!channel) throw new Error('Linux sensor requires a pinned Rust toolchain');
  const info = String(
    run('rustup', ['run', channel, 'rustc', '-vV'], { cwd: sensors, encoding: 'utf8' }),
  );
  if (
    !info.split(/\r?\n/).includes(`release: ${channel}`) ||
    !info.split(/\r?\n/).includes(`host: ${target.triple}`)
  )
    throw new Error('Linux sensor Rust host or toolchain does not match the requested target');
  const cargoTarget = path.join(projectRoot, 'build', 'linux-sensor-target', arch);
  run(
    'rustup',
    [
      'run',
      channel,
      'cargo',
      'build',
      '--release',
      '--locked',
      '-p',
      'aegis-sensor-linux',
      '--target',
      target.triple,
    ],
    {
      cwd: sensors,
      env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
      stdio: 'inherit',
    },
  );
  const binary = path.join(cargoTarget, target.triple, 'release', 'aegis-sensor-linux');
  verifyElf(binary, arch);
  const outputDir = path.join(projectRoot, 'build', 'linux-sensor', arch);
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, 'aegis-sensor-linux');
  const temporary = path.join(outputDir, `.aegis-sensor-${randomBytes(12).toString('hex')}`);
  let owned = false;
  try {
    fs.copyFileSync(binary, temporary, fs.constants.COPYFILE_EXCL);
    owned = true;
    fs.chmodSync(temporary, 0o755);
    verifyElf(temporary, arch);
    fs.renameSync(temporary, output);
    owned = false;
  } finally {
    if (owned) fs.unlinkSync(temporary);
  }
  return output;
}

if (require.main === module) {
  try {
    console.log(`[linux-sensor] staged ${buildLinuxSensor({ arch: process.argv[2] })}`);
  } catch (error) {
    console.error(`[linux-sensor] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildLinuxSensor, verifyElf };
