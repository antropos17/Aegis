/**
 * @file scripts/build-sidecar.js
 * @description Compile the process-snapshot sidecar with the C# compiler that ships
 *   inside Windows.
 *
 *   `csc.exe` under `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319` is present on
 *   every Windows 10 1903+ and Windows 11 machine, and .NET Framework 4.8 is inbox
 *   there too. That is the whole reason for the language choice: no SDK to install
 *   for whoever builds, no runtime to install for whoever runs. The cost is a C# 5
 *   era compiler — no string interpolation, no `out var`, no tuples — and no
 *   System.Text.Json, which is why the sidecar serialises by hand.
 *
 *   Failing loudly matters more than succeeding quietly here: a silent skip would
 *   ship an installer with no sidecar in it, and the app would fall back to the CIM
 *   observation forever while every test stayed green.
 *
 *   Usage: npm run build:sidecar
 */
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'sidecar', 'procsnap');
const OUT_DIR = path.join(ROOT, 'build', 'sidecar');
const OUT_EXE = path.join(OUT_DIR, 'aegis-procsnap.exe');
const SOURCES = ['Program.cs', 'NtSnapshot.cs', 'Json.cs'];

/**
 * @returns {string} path to csc.exe
 * @throws {Error} when this is not a Windows machine with the inbox compiler.
 */
function findCsc() {
  if (process.platform !== 'win32') {
    throw new Error(
      'The snapshot sidecar is a Windows binary and builds on Windows only. ' +
        'This is not an error on Linux CI — nothing there needs it.',
    );
  }
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No inbox C# compiler found. Looked in:\n  ' +
      candidates.join('\n  ') +
      '\nInstall the .NET Framework 4.x developer files, or build the sources in ' +
      'sidecar/procsnap with `dotnet build` targeting net48 — the wire contract does ' +
      'not care which compiler produced the binary.',
  );
}

function main() {
  const csc = findCsc();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sources = SOURCES.map((name) => {
    const file = path.join(SOURCE_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`missing sidecar source: ${file}`);
    return file;
  });

  // /platform:x64 is not cosmetic: the struct offsets the sidecar reads are the
  // 64-bit layout of SYSTEM_PROCESS_INFORMATION, and a 32-bit process would read
  // them wrong. The startup probe would catch it, but failing at build time is
  // cheaper than failing at run time.
  const args = [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    '/warnaserror+',
    `/out:${OUT_EXE}`,
    ...sources,
  ];
  execFileSync(csc, args, { stdio: 'inherit' });

  const bytes = fs.readFileSync(OUT_EXE);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log(`built  ${OUT_EXE}`);
  console.log(`bytes  ${bytes.length}`);
  console.log(`sha256 ${sha256}`);
  console.log(`csc    ${csc}`);
}

try {
  main();
} catch (err) {
  console.error(`build-sidecar: ${err.message}`);
  process.exit(1);
}
