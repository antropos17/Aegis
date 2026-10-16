import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { produceGuiManifest } from '../../../scripts/produce-protected-gui-manifest.mjs';

export function processCoreSources(project) {
  return [
    'ProtectedInstallFiles.cs', 'ProtectedGuiManifest.cs', 'ProtectedGuiBundleNative.cs',
    'ProtectedGuiBundleFiles.cs', 'ProtectedGuiIdentity.cs', 'ProtectedGuiExecutionPins.cs',
    'ProtectedGuiProcessNative.cs', 'ProtectedGuiProcessLease.cs', 'ProtectedGuiProcessProfile.cs',
  ].map((name) => path.join(project, 'scripts/installation', name));
}

export function compileProcessLibrary(project, root) {
  const library = path.join(root, 'gui-process-helper.dll');
  const sources = processCoreSources(project);
  sources.push(path.join(project, 'tests/fixtures/protected-gui-process/ProcessTestControls.cs'));
  try {
    execFileSync(
      path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      ['/nologo', '/target:library', '/platform:x64', '/warnaserror+',
        '/define:PROTECTED_GUI_TEST;PROTECTED_GUI_PROCESS_TEST', `/out:${library}`, ...sources],
      { timeout: 30000, maxBuffer: 32768, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
    );
  } catch (failure) {
    throw new Error(`GUI process library compilation failed:\n${failure.stdout?.toString() || ''}\n${failure.stderr?.toString() || ''}`);
  }
  return library;
}

export function runProcessStage(project, root, fixture, library, mode) {
  const work = path.join(root, `stage-${mode}`), source = path.join(work, 'candidate');
  const scratch = path.join(work, 'scratch'), manifest = path.join(work, 'manifest.json');
  fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
  fs.mkdirSync(scratch);
  fs.copyFileSync(fixture, path.join(source, 'AEGIS - AI Monitoring & Threat Detection.exe'));
  fs.copyFileSync(fixture, path.join(source, 'fixture-grandchild.exe'));
  fs.writeFileSync(path.join(source, 'resources/app.asar'), 'inert fixture package payload; never Electron');
  fs.writeFileSync(manifest, produceGuiManifest(source));
  const result = spawnSync(
    path.join(process.env.WINDIR || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(project, 'tests/fixtures/protected-gui-process/stage.ps1'),
      '-Project', project, '-Assembly', library, '-Source', source, '-Manifest', manifest, '-Scratch', scratch, '-Mode', mode],
    { timeout: 25000, maxBuffer: 16384, windowsHide: true, env: { ...process.env, TEMP: root, TMP: root } },
  );
  // Callers retain scratch on any missing original-closure acknowledgment.
  return { scratch, result };
}
