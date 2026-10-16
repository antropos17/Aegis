import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, invoke } from '../fixtures/session-fixed-operation/harness.mjs';
import {
  GUI_EXECUTABLE,
  produceGuiManifest,
} from '../../scripts/produce-protected-gui-manifest.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(JSON.stringify(value));
const edit = (bytes, key, value) => encode({ ...JSON.parse(bytes), [key]: value });
const remove = (bytes, key) => {
  const object = JSON.parse(bytes);
  delete object[key];
  return encode(object);
};
const invalidUtf8 = (bytes) => Buffer.concat([Buffer.from([0xff]), bytes.subarray(1)]);
const reverse = (bytes) => encode(Object.fromEntries(Object.entries(JSON.parse(bytes)).reverse()));
let harness, stages;
function compileGuiFixture(directory) {
  const library = path.join(directory, 'gui-helper.dll');
  try {
    execFileSync(
      path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:library',
        '/platform:x64',
        '/define:PROTECTED_GUI_TEST',
        '/warnaserror+',
        '/reference:System.Security.dll',
        '/out:' + library,
        ...[
          'ProtectedInstallFiles.cs',
          'ProtectedGuiManifest.cs',
          'ProtectedGuiBundleNative.cs',
          'ProtectedGuiBundleFiles.cs',
          'ProtectedGuiIdentity.cs',
        ].map((name) => path.join(project, 'scripts/installation', name)),
      ],
      { timeout: 30000, maxBuffer: 32768, windowsHide: true },
    );
  } catch (error) {
    throw new Error(String(error.stdout) + String(error.stderr), { cause: error });
  }
  return library;
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'fixed installed inspection registration (actual producer and native reader)',
  () => {
    beforeAll(() => {
      harness = createHarness(project);
      const scratch = fs.mkdtempSync(path.join(harness.root, 'producer-'));
      const { sid } = invoke(harness.parser, ['--operator-sid']);
      const result = invoke('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(project, 'tests/fixtures/protected-installation/vm-record-producer-fixture.ps1'),
        scratch,
        '11111111-2222-4333-8444-555555555555',
        'a'.repeat(64),
        'b'.repeat(64),
        '-MainImage',
        harness.native,
        '-SupervisorImage',
        harness.native,
        '-OperatorSid',
        sid,
      ]);
      stages = result.stages;
      expect(stages).toHaveLength(4);
    }, 65000);

    afterAll(() => harness?.cleanup());

    function parseVariant(operationChange, fixtureChange) {
      const original = stages[0];
      const directory = fs.mkdtempSync(path.join(harness.root, 'parse-'));
      const policy = fs.readFileSync(original.policyPath);
      let operation = fs.readFileSync(original.operationPath);
      let fixture = fs.readFileSync(original.fixturePath);
      if (fixtureChange) {
        fixture = fixtureChange(fixture);
        operation = edit(operation, 'fixtureManifestBytes', fixture.length);
        operation = edit(operation, 'fixtureManifestSha256', digest(fixture));
      }
      if (operationChange) operation = operationChange(operation);
      fs.writeFileSync(path.join(directory, 'owner-policy.json'), policy);
      fs.writeFileSync(path.join(directory, 'registered-operation.json'), operation);
      fs.writeFileSync(path.join(directory, 'fixed-fixture.json'), fixture);
      return invoke(harness.parser, [directory]);
    }

    function native(mode) {
      const directory = fs.mkdtempSync(path.join(harness.root, mode + '-'));
      const observed = invoke(harness.native, [mode, directory]);
      expect(observed).toMatchObject({
        effects: 0,
        mainJobEmpty: true,
        borrowedUsable: true,
        recordsUnchanged: true,
        protectedDescriptorsModeled: true,
        installedAuthorityModeled: true,
      });
      expect(fs.readFileSync(path.join(directory, 'control/effect-counter.txt'), 'utf8')).toBe('0');
      expect(fs.existsSync(path.join(directory, 'control/inspection.json'))).toBe(false);
      expect(
        fs.readFileSync(path.join(directory, 'control/supervisor-job-empty.txt'), 'utf8'),
      ).toBe('true');
      return observed;
    }

    it('parses exact PowerShell producer bytes for all four administrative stage variants', () => {
      const image = fs.readFileSync(harness.native);
      for (const stage of stages) {
        for (const name of ['policy', 'inventory', 'operation', 'fixture']) {
          const actual = fs.readFileSync(stage[name + 'Path']);
          expect(actual).toEqual(Buffer.from(stage[name + 'Base64'], 'base64'));
          expect(actual.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        }
        expect(invoke(harness.parser, [stage.path])).toEqual({
          parserAttempted: true,
          accepted: true,
        });
        const fixture = JSON.parse(fs.readFileSync(stage.fixturePath));
        const registration = JSON.parse(fs.readFileSync(stage.operationPath));
        const inventory = fs.readFileSync(stage.inventoryPath);
        expect(fixture.inventoryBytes).toBe(inventory.length);
        expect(fixture.inventorySha256).toBe(digest(inventory));
        expect(fixture.mainImageBytes).toBe(image.length);
        expect(fixture.mainImageSha256).toBe(digest(image));
        expect(fixture.supervisorImageBytes).toBe(image.length);
        expect(fixture.supervisorImageSha256).toBe(digest(image));
        expect(registration.operations).toEqual(['inspect-owned']);
        expect(registration.policySha256).toBe(digest(fs.readFileSync(stage.policyPath)));
        expect(registration.fixtureManifestBytes).toBe(fs.statSync(stage.fixturePath).size);
        expect(registration.fixtureManifestSha256).toBe(digest(fs.readFileSync(stage.fixturePath)));
      }
    });
    it('completes native inspection with an actual installer-produced GUI candidate present (modeled principal and protection)', () => {
      const directory = fs.mkdtempSync(path.join(harness.root, 'gui-inspection-'));
      const source = path.join(directory, 'source');
      fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(source, GUI_EXECUTABLE), 'fixture GUI payload; never executed');
      fs.writeFileSync(path.join(source, 'resources/app.asar'), 'fixture resource');
      const manifest = path.join(directory, 'gui-manifest.json');
      fs.writeFileSync(manifest, produceGuiManifest(source));
      const library = compileGuiFixture(directory);
      const observed = invoke(harness.native, [
        'gui-present',
        directory,
        project,
        library,
        source,
        manifest,
      ]);
      expect(observed).toMatchObject({
        admitted: true,
        completed: true,
        refused: false,
        effects: 1,
        mainJobEmpty: true,
        borrowedUsable: true,
        recordsUnchanged: true,
        guiCandidateProduced: true,
        guiBytesPreserved: true,
        inspectionBytesPreserved: true,
        guiPrincipalAndProtectionModeled: true,
        protectedDescriptorsModeled: true,
        installedAuthorityModeled: true,
        guiEnrollment: false,
      });
      const record = JSON.parse(
        fs.readFileSync(path.join(directory, 'installed/registered-gui-candidate.json')),
      );
      expect(record).toMatchObject({
        scope: 'protected-gui-bundle-candidate',
        status: 'candidate',
        guiEnrollment: false,
      });
      expect(record.policySha256).toBe(
        digest(fs.readFileSync(path.join(directory, 'installed/owner-policy.json'))),
      );
      expect(
        fs.readFileSync(path.join(directory, 'installed/GuiBundle', GUI_EXECUTABLE), 'utf8'),
      ).toBe('fixture GUI payload; never executed');
      // The existing positive fixture counts its inspection JSON publication.
      expect(fs.readFileSync(path.join(directory, 'control/effect-counter.txt'), 'utf8')).toBe('1');
      expect(fs.existsSync(path.join(directory, 'control/inspection.json'))).toBe(true);
      expect(
        fs.readFileSync(path.join(directory, 'control/supervisor-job-empty.txt'), 'utf8'),
      ).toBe('true');
    }, 40000);
    it('runs the full actual installer stage and GUI native clone through bounded publication and rollback', () => {
      const directory = fs.mkdtempSync(path.join(harness.root, 'full-gui-stage-'));
      const source = path.join(directory, 'source'),
        scratch = path.join(directory, 'stages');
      fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
      fs.mkdirSync(scratch);
      fs.writeFileSync(path.join(source, GUI_EXECUTABLE), 'fixture full stage GUI; never executed');
      fs.writeFileSync(path.join(source, 'resources/app.asar'), 'fixture full stage resource');
      const manifest = path.join(directory, 'gui-manifest.json');
      fs.writeFileSync(manifest, produceGuiManifest(source));
      const result = invoke('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(project, 'tests/fixtures/protected-installation/gui-stage-composition.ps1'),
        '-Project',
        project,
        '-Assembly',
        compileGuiFixture(directory),
        '-Source',
        source,
        '-Manifest',
        manifest,
        '-Scratch',
        scratch,
      ]);
      expect(result).toEqual({
        passed: true,
        actualFullStage: true,
        ordinaryRows: 12,
        externalSourceClosed: true,
        cloneFromOriginal: true,
        rollbackOriginalsPreserved: true,
        unknownRetirementRefused: true,
        modeledVerifiedClosure: true,
        modeledPrincipalProtectionAndJournalMetadata: true,
        guiEnrollment: false,
      });
      expect(fs.readdirSync(scratch)).toEqual([]);
    }, 40000);
    it('retains the actual issued GUI stage and original pins through uncertain upgrade publication', () => {
      const directory = fs.mkdtempSync(path.join(harness.root, 'retained-gui-stage-'));
      const source = path.join(directory, 'source');
      const scratch = path.join(directory, 'stages');
      fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
      fs.mkdirSync(scratch);
      fs.writeFileSync(path.join(source, GUI_EXECUTABLE), 'fixture retained GUI; never executed');
      fs.writeFileSync(path.join(source, 'resources/app.asar'), 'fixture retained resource');
      const manifest = path.join(directory, 'gui-manifest.json');
      fs.writeFileSync(manifest, produceGuiManifest(source));
      const result = invoke('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(project, 'tests/fixtures/protected-installation/gui-stage-composition.ps1'),
        '-Project',
        project,
        '-Assembly',
        compileGuiFixture(directory),
        '-Source',
        source,
        '-Manifest',
        manifest,
        '-Scratch',
        scratch,
        '-Mode',
        'retention-publish-unknown',
      ]);
      expect(result).toEqual({
        passed: true,
        actualFullStage: true,
        retainedStageExact: true,
        retainedRootExact: true,
        retainedBundleExact: true,
        retainedPinsCurrent: true,
        originalFileIdsPreserved: true,
        candidateBytesPreserved: true,
        oldAndRollbackExact: true,
        retryGuarded: true,
        uninstallGuarded: true,
        noFollowupEffects: true,
        staged: 1,
        nativeMoves: 2,
        modeledServiceStops: 1,
        modeledAdministrativeHandoffUncertainty: true,
        modeledPrincipalProtectionAndJournalMetadata: true,
        guiEnrollment: false,
      });
      const current = path.join(scratch, 'published');
      const rollback = fs.readdirSync(scratch).filter((name) => name.startsWith('Rollback-'));
      expect(rollback).toHaveLength(1);
      expect(fs.readdirSync(scratch).sort()).toEqual([rollback[0], 'published'].sort());
      for (const stage of [current, path.join(scratch, rollback[0])]) {
        expect(fs.readFileSync(path.join(stage, 'GuiBundle', GUI_EXECUTABLE), 'utf8')).toBe(
          'fixture retained GUI; never executed',
        );
        expect(
          JSON.parse(fs.readFileSync(path.join(stage, 'registered-gui-candidate.json'))),
        ).toMatchObject({
          scope: 'protected-gui-bundle-candidate',
          status: 'candidate',
          guiEnrollment: false,
        });
      }
    }, 40000);

    it.each([
      ['extra property', (b) => edit(b, 'extra', true)],
      ['missing status', (b) => remove(b, 'status')],
      ['duplicate property', (b) => Buffer.from(b.toString().replace('{', '{"schemaVersion":1,'))],
      ['reordered properties', reverse],
      ['leading whitespace', (b) => Buffer.concat([Buffer.from(' '), b])],
      ['trailing bytes', (b) => Buffer.concat([b, Buffer.from('\n')])],
      ['BOM', (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b])],
      ['invalid UTF-8', invalidUtf8],
      ['oversized registration', () => Buffer.alloc(4097, 0x61)],
      ['schema version', (b) => edit(b, 'schemaVersion', 2)],
      ['foreign installation', (b) => edit(b, 'installId', 'f'.repeat(32))],
      ['foreign revision', (b) => edit(b, 'revision', 2)],
      ['foreign epoch', (b) => edit(b, 'epoch', 'f'.repeat(32))],
      ['foreign policy', (b) => edit(b, 'policySha256', 'f'.repeat(64))],
      ['foreign operator', (b) => edit(b, 'operatorSid', 'S-1-5-19')],
      ['foreign selection', (b) => edit(b, 'selectionId', 'f'.repeat(32))],
      ['foreign selection epoch', (b) => edit(b, 'selectionEpoch', 'f'.repeat(32))],
      ['foreign fixture ID', (b) => edit(b, 'fixtureId', 'foreign-fixture')],
      ['zero manifest size', (b) => edit(b, 'fixtureManifestBytes', 0)],
      ['oversized manifest declaration', (b) => edit(b, 'fixtureManifestBytes', 4097)],
      ['wrong manifest size', (b) => edit(b, 'fixtureManifestBytes', 1)],
      ['wrong manifest digest', (b) => edit(b, 'fixtureManifestSha256', 'f'.repeat(64))],
      ['prepare registration', (b) => edit(b, 'operations', ['prepare-owned'])],
      ['release registration', (b) => edit(b, 'operations', ['release-owned'])],
      ['multiple operations', (b) => edit(b, 'operations', ['inspect-owned', 'prepare-owned'])],
      ['inactive registration', (b) => edit(b, 'status', 'inactive')],
    ])('refuses %s in actual producer registration bytes', (_label, change) => {
      expect(parseVariant(change)).toEqual({ parserAttempted: true, accepted: false });
    });

    it.each([
      ['extra fixture property', (b) => edit(b, 'extra', true)],
      ['missing fixture scope', (b) => remove(b, 'scope')],
      ['reordered fixture', reverse],
      ['fixture BOM', (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b])],
      ['fixture invalid UTF-8', invalidUtf8],
      ['oversized fixture', () => Buffer.alloc(4097, 0x61)],
      ['foreign fixture', (b) => edit(b, 'fixtureId', 'foreign-fixture')],
      ['foreign scope', (b) => edit(b, 'scope', 'launch-owned')],
      ['fixture selection', (b) => edit(b, 'selectionId', 'f'.repeat(32))],
      ['fixture selection epoch', (b) => edit(b, 'selectionEpoch', 'f'.repeat(32))],
      ['empty inventory', (b) => edit(b, 'inventoryBytes', 0)],
      ['oversized inventory declaration', (b) => edit(b, 'inventoryBytes', 4097)],
      ['invalid inventory hash', (b) => edit(b, 'inventorySha256', 'X'.repeat(64))],
      ['main image size', (b) => edit(b, 'mainImageBytes', JSON.parse(b).mainImageBytes + 1)],
      ['main image digest', (b) => edit(b, 'mainImageSha256', 'f'.repeat(64))],
      ['supervisor image size', (b) => edit(b, 'supervisorImageBytes', 1)],
      ['supervisor image digest', (b) => edit(b, 'supervisorImageSha256', 'f'.repeat(64))],
    ])('refuses %s even with its correctly rebound manifest digest', (_label, change) => {
      expect(parseVariant(undefined, change)).toEqual({ parserAttempted: true, accepted: false });
    });

    it.each([
      'fixed-missing-operation',
      'fixed-missing-fixture',
      'fixed-inventory-mismatch',
      'fixed-main-mismatch',
      'fixed-supervisor-mismatch',
      'fixed-writable-operation',
    ])('refuses %s before endpoint publication with zero fixture effects', (mode) => {
      expect(native(mode)).toMatchObject({ admitted: false, refused: true });
    });

    it.each(['fixed-prepare', 'fixed-release', 'fixed-changed-replay'])(
      'terminally refuses %s through the native installed dispatcher after genuine inspection admission',
      (mode) => {
        expect(native(mode)).toMatchObject({
          admitted: true,
          authorizationIssued: true,
          policyGuardAttempted: mode !== 'fixed-changed-replay',
          refused: true,
          retryRefused: true,
          completed: mode === 'fixed-changed-replay',
        });
      },
    );

    it.each([
      'fixed-operation-metadata',
      'fixed-fixture-metadata',
      'fixed-operation-bytes',
      'fixed-fixture-bytes',
    ])('latches observed original %s change after exact restoration', (mode) => {
      const observed = native(mode);
      expect(observed, JSON.stringify(observed)).toMatchObject({
        admitted: true,
        completed: true,
        mutationApplied: true,
        byteSharingAndMetadataModeled: mode.endsWith('-bytes'),
        refused: true,
        retryRefused: true,
      });
    });
  },
);
