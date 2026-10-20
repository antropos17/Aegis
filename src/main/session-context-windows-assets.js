'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { debuglog } = require('node:util');
const inspector = require('node:inspector');
const { exact } = require('./claude-hook-windows-io-wire');

/** Fixed disclosure-free error. @returns {Error} Private failure. @since v0.19.3 */
const failure = () => Error('session-windows-io-failed');

/** Refuse effective diagnostics before private input or each operation.
 * @returns {void} Throws a fixed error. @since v0.19.3 */
function privateMode() {
  if (
    process.execArgv.length ||
    process._preload_modules?.length ||
    inspector.url() ||
    ['child_process', 'stream', 'net', 'worker'].some((name) => debuglog(name).enabled) ||
    Object.entries(process.env).some(
      ([key, value]) =>
        value &&
        /^(NODE_OPTIONS|NODE_DEBUG|NODE_DEBUG_NATIVE|DOTNET_STARTUP_HOOKS|COREHOST_TRACE|DOTNET_HOST_TRACE)$/i.test(
          key,
        ),
    ) ||
    process.report?.reportOnFatalError ||
    process.report?.reportOnSignal ||
    process.report?.reportOnUncaughtException
  )
    throw failure();
}

function ordinary(selected, directory) {
  if (
    typeof selected !== 'string' ||
    !/^[A-Z]:\\/.test(selected) ||
    selected.length > 240 ||
    [...selected].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.win32.normalize(selected) !== selected
  )
    throw failure();
  let cursor = selected;
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (
      stat.isSymbolicLink() ||
      (cursor === selected && !directory ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())
    )
      throw failure();
    const parent = path.win32.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function bindFolder(root, pins, maxFiles, maxBytes) {
  ordinary(root, true);
  if (!Array.isArray(pins) || !pins.length || pins.length > maxFiles) throw failure();
  const expected = new Map();
  for (const pin of pins) {
    if (
      !exact(pin, ['name', 'sha256']) ||
      typeof pin.name !== 'string' ||
      !/^[A-Za-z0-9_.-]+$/.test(pin.name) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      expected.has(pin.name)
    )
      throw failure();
    expected.set(pin.name, pin.sha256);
  }
  const names = fs.readdirSync(root);
  if (names.length !== expected.size) throw failure();
  let total = 0;
  for (const name of names) {
    if (!expected.has(name)) throw failure();
    const selected = path.win32.join(root, name);
    ordinary(selected, false);
    const size = fs.statSync(selected).size;
    total += size;
    if (size > 64 * 1024 * 1024 || total > maxBytes) throw failure();
    const bytes = fs.readFileSync(selected);
    try {
      if (createHash('sha256').update(bytes).digest('hex') !== expected.get(name)) throw failure();
    } finally {
      bytes.fill(0);
    }
  }
  return names;
}

/** Qualify the fixed reader apphost and installed framework, with owner pins.
 * Stable trusted loader directories and kernel are embedding prerequisites.
 * @param {object} assets Explicit fixed host/framework roots and SHA256 pins.
 * @returns {object} Sanitized fixed executable/cwd/environment. @since v0.19.3 */
function qualifyAssets(assets) {
  try {
    privateMode();
    if (
      process.platform !== 'win32' ||
      !exact(assets, [
        'hostRoot',
        'hostFiles',
        'runtimeRoot',
        'runtimeVersion',
        'runtimeFiles',
        'hostFxrSha256',
      ]) ||
      assets.runtimeVersion !== '10.0.10'
    )
      throw failure();
    const names = bindFolder(assets.hostRoot, assets.hostFiles, 4, 4 * 1024 * 1024);
    const required = [
      'SessionContextReader.exe',
      'SessionContextReader.dll',
      'SessionContextReader.deps.json',
      'SessionContextReader.runtimeconfig.json',
    ];
    if (names.length !== required.length || required.some((name) => !names.includes(name)))
      throw failure();
    ordinary(assets.runtimeRoot, true);
    bindFolder(
      path.win32.join(assets.runtimeRoot, 'shared', 'Microsoft.NETCore.App', assets.runtimeVersion),
      assets.runtimeFiles,
      256,
      128 * 1024 * 1024,
    );
    const fxrRoot = path.win32.join(assets.runtimeRoot, 'host', 'fxr');
    ordinary(fxrRoot, true);
    if (
      fs
        .readdirSync(fxrRoot)
        .some(
          (version) =>
            !/^\d+\.\d+\.\d+$/.test(version) ||
            version.localeCompare(assets.runtimeVersion, undefined, { numeric: true }) > 0,
        )
    )
      throw failure();
    bindFolder(
      path.win32.join(fxrRoot, assets.runtimeVersion),
      [{ name: 'hostfxr.dll', sha256: assets.hostFxrSha256 }],
      1,
      8 * 1024 * 1024,
    );
    const config = JSON.parse(
      fs.readFileSync(
        path.win32.join(assets.hostRoot, 'SessionContextReader.runtimeconfig.json'),
        'utf8',
      ),
    );
    if (
      !exact(config, ['runtimeOptions']) ||
      !exact(config.runtimeOptions, ['tfm', 'rollForward', 'framework', 'configProperties']) ||
      !exact(config.runtimeOptions.framework, ['name', 'version']) ||
      !exact(config.runtimeOptions.configProperties, [
        'System.Reflection.Metadata.MetadataUpdater.IsSupported',
        'System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization',
        'CSWINRT_USE_WINDOWS_UI_XAML_PROJECTIONS',
      ]) ||
      Object.values(config.runtimeOptions.configProperties).some((value) => value !== false) ||
      config.runtimeOptions.tfm !== 'net10.0' ||
      config.runtimeOptions.rollForward !== 'Disable' ||
      config.runtimeOptions.framework.name !== 'Microsoft.NETCore.App' ||
      config.runtimeOptions.framework.version !== assets.runtimeVersion
    )
      throw failure();
    return {
      executable: path.win32.join(assets.hostRoot, 'SessionContextReader.exe'),
      cwd: assets.hostRoot,
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.SystemRoot,
        DOTNET_ROOT: assets.runtimeRoot,
        DOTNET_MULTILEVEL_LOOKUP: '0',
        DOTNET_ROLL_FORWARD: 'Disable',
        DOTNET_EnableDiagnostics: '0',
        COMPlus_EnableDiagnostics: '0',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
      },
    };
  } catch {
    throw failure();
  }
}

module.exports = { failure, privateMode, qualifyAssets };
