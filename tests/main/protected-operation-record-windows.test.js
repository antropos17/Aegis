import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encoded = (value) => Buffer.from(JSON.stringify(value) + '\n').toString('base64');
const value = (frame) => JSON.parse(Buffer.from(frame, 'base64'));
const edit = (frame, change) => encoded(change(value(frame)));
let root, executable, production, frames;

function invoke(file, args) {
  return JSON.parse(
    execFileSync(file, args, {
      timeout: 45000,
      maxBuffer: 32768,
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    }).toString(),
  );
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native operation record and settlement core (simulated store; no protected backend)',
  () => {
    beforeAll(() => {
      const parent = path.join(project, 'out/development');
      fs.mkdirSync(parent, { recursive: true });
      root = fs.mkdtempSync(path.join(parent, 'b04-fixture-'));
      const sources = ['session', 'owner'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, 'sidecar', directory))
          .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
          .sort()
          .map((name) => path.join(project, 'sidecar', directory, name)),
      );
      sources.push(
        path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
        ...fs
          .readdirSync(path.join(project, 'tests/fixtures/protected-operation-record'))
          .filter((name) => name.endsWith('.cs'))
          .sort()
          .map((name) => path.join(project, 'tests/fixtures/protected-operation-record', name)),
      );
      executable = path.join(root, 'fixture.exe');
      production = path.join(root, 'production.exe');
      for (const [output, defines] of [
        [executable, ['/define:PROTECTED_OPERATION_TEST']],
        [production, []],
      ]) {
        execFileSync(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          ),
          [
            '/nologo',
            '/target:exe',
            '/platform:x64',
            '/main:ProtectedOperationFixture',
            '/optimize+',
            '/warnaserror+',
            '/reference:System.Management.dll',
            '/reference:System.Security.dll',
            ...defines,
            `/out:${output}`,
            ...sources,
          ],
          {
            timeout: 30000,
            maxBuffer: 32768,
            windowsHide: true,
            env: { ...process.env, TEMP: root, TMP: root },
          },
        );
      }
      frames = invoke(executable, ['frames']);
    }, 65000);

    afterAll(() => {
      if (!root) return;
      const parent = fs.realpathSync(path.join(project, 'out/development'));
      expect(path.dirname(fs.realpathSync(root))).toBe(parent);
      expect(path.basename(root)).toMatch(/^b04-fixture-/);
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      for (const leaf of fs.readdirSync(root)) {
        const stat = fs.lstatSync(path.join(root, leaf));
        expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(false);
      }
      fs.rmSync(root, { recursive: true });
    });

    it('compiles without test defines and exposes only inert production operations', () => {
      expect(invoke(production, ['production'])).toEqual({
        passed: true,
        productionInert: true,
        effects: 0,
      });
    });

    it('round trips actual native bytes and binds the exact domain-separated intent digest', () => {
      for (const frame of frames)
        expect(invoke(executable, ['parse', frame])).toMatchObject({
          accepted: true,
          encoded: frame,
          effects: 0,
        });
      const record = value(frames[0]);
      const {
        operationSha256,
        sequence: _sequence,
        previousSha256: _previous,
        phase: _phase,
        ...intent
      } = record;
      expect(operationSha256).toBe(
        hash(Buffer.from('aegis-protected-operation-intent-v1\n' + JSON.stringify(intent))),
      );
    });

    it.each([
      ['unknown field', (x) => ({ ...x, approved: true })],
      ['missing field', ({ policySha256: _removed, ...x }) => x],
      ['reordered fields', (x) => Object.fromEntries(Object.entries(x).reverse())],
      ['zero revision', (x) => ({ ...x, revision: 0 })],
      ['revision overflow', (x) => ({ ...x, revision: 4294967296 })],
      ['zero sequence', (x) => ({ ...x, sequence: 0 })],
      ['sequence beyond bounded log', (x) => ({ ...x, sequence: 1026 })],
      ['sequence overflow', (x) => ({ ...x, sequence: 4294967296 })],
      ['nonintegral sequence', (x) => ({ ...x, sequence: 1.5 })],
      ['uppercase ID', (x) => ({ ...x, operationId: x.operationId.toUpperCase() })],
      ['empty operation GUID', (x) => ({ ...x, operationId: '0'.repeat(32) })],
      ['empty VM GUID', (x) => ({ ...x, vmId: '00000000-0000-0000-0000-000000000000' })],
      ['wrong profile', (x) => ({ ...x, configurationProfile: 'self-approved' })],
      ['nonfinite intent kind', (x) => ({ ...x, requestedState: 4 })],
      ['changed intent digest', (x) => ({ ...x, operationSha256: 'b'.repeat(64) })],
      ['changed intent descriptor', (x) => ({ ...x, requestedState: 3 })],
      ['unknown phase', (x) => ({ ...x, phase: 'recovered-authority' })],
      ['uppercase digest', (x) => ({ ...x, previousSha256: 'A'.repeat(64) })],
    ])('refuses %s', (_label, change) => {
      expect(invoke(executable, ['parse', edit(frames[0], change)])).toEqual({
        accepted: false,
        effects: 0,
      });
    });

    it.each([
      'utf8',
      'bom',
      'trailing',
      'crlf',
      'duplicate',
      'leading-zero',
      'escaped',
      'oversized',
      'truncated',
    ])('refuses noncanonical bytes: %s', (mode) => {
      let bytes = Buffer.from(frames[0], 'base64');
      if (mode === 'utf8') bytes[0] = 0xff;
      if (mode === 'bom') bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
      if (mode === 'trailing') bytes = Buffer.concat([bytes, Buffer.from(' ')]);
      if (mode === 'crlf') bytes = Buffer.from(bytes.toString().replace(/\n$/, '\r\n'));
      if (mode === 'duplicate')
        bytes = Buffer.from(
          bytes.toString().replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'),
        );
      if (mode === 'leading-zero')
        bytes = Buffer.from(bytes.toString().replace('"sequence":1', '"sequence":01'));
      if (mode === 'escaped')
        bytes = Buffer.from(bytes.toString().replace('"installId"', '"\\u0069nstallId"'));
      if (mode === 'oversized') bytes = Buffer.alloc(2049, 32);
      if (mode === 'truncated') bytes = bytes.subarray(0, bytes.length - 1);
      expect(invoke(executable, ['parse', bytes.toString('base64')]).accepted).toBe(false);
    });

    it.each([
      'install',
      'revision',
      'epoch',
      'policy',
      'selection',
      'selectionEpoch',
      'vm',
      'identity',
      'configuration',
      'session',
      'sessionEpoch',
    ])('refuses a canonical record chain from a different %s binding', (field) => {
      const changed = invoke(executable, ['frames', field]);
      expect(invoke(executable, ['parse', changed[0]]).accepted).toBe(true);
      expect(invoke(executable, ['replay', ...changed]).accepted).toBe(false);
    });

    it.each([0, 1, 2, 3, 4, 5])(
      'observes a valid prefix of length %i without restart authority',
      (length) => {
        expect(invoke(executable, ['replay', ...frames.slice(0, length)])).toEqual({
          accepted: true,
          status: 'PrefixOnly',
          sequence: length,
          revoked: length === 5,
          unknown: length === 2 || length === 3,
          effects: 0,
        });
      },
    );

    it.each([
      'duplicate',
      'reordered',
      'gap',
      'bad-head',
      'skip-intent',
      'skip-dispatch',
      'truncated',
      'repeated-revoke',
      'changed-id',
    ])('refuses invalid chain transition: %s', (mode) => {
      let chain = [...frames];
      if (mode === 'duplicate') chain.splice(1, 0, chain[0]);
      if (mode === 'reordered') [chain[0], chain[1]] = [chain[1], chain[0]];
      if (mode === 'gap') chain.splice(1, 1);
      if (mode === 'bad-head')
        chain[1] = edit(chain[1], (x) => ({ ...x, previousSha256: 'b'.repeat(64) }));
      if (mode === 'skip-intent')
        chain = [edit(frames[1], (x) => ({ ...x, sequence: 1, previousSha256: '0'.repeat(64) }))];
      if (mode === 'skip-dispatch')
        chain = [
          frames[0],
          frames[1],
          edit(frames[3], (x) => ({
            ...x,
            sequence: 3,
            previousSha256: hash(Buffer.from(frames[1], 'base64')),
          })),
        ];
      if (mode === 'truncated')
        chain[4] = Buffer.from(chain[4], 'base64').subarray(0, -1).toString('base64');
      if (mode === 'repeated-revoke')
        chain.push(
          edit(frames[4], (x) => ({
            ...x,
            sequence: 6,
            previousSha256: hash(Buffer.from(frames[4], 'base64')),
          })),
        );
      if (mode === 'changed-id')
        chain[1] = edit(chain[1], (x) => ({ ...x, operationId: 'b'.repeat(32) }));
      expect(invoke(executable, ['replay', ...chain]).accepted).toBe(false);
    });

    it.each([
      'codec-owned',
      'duplicates',
      'changed-replay',
      'dispatch-before-consume',
      'unresolved',
      'settled-failure',
      'revoke-intent',
      'revoke-consumed',
      'revoke-dispatched',
      'revoke-failure',
      'restored-store',
      'revoked-restored',
      'reentry-store',
      'reentry-effect',
      'forged-effect',
      'effect-no-settlement',
      'capacity',
      'race-revoke-first',
      'race-dispatch-first',
    ])('enforces the native behavioral contract: %s', (mode) =>
      expect(invoke(executable, [mode])).toMatchObject({
        passed: true,
        simulatedStore: true,
        protectedBackendQualified: false,
      }),
    );

    it.each(
      ['consume', 'dispatch', 'settle'].flatMap((stage) =>
        [
          'zero',
          'short',
          'sync',
          'replace',
          'throw-before',
          'throw-after',
          'readback',
          'torn',
          'wrong-attempt',
          'wrong-store',
        ].map((fault) => `${stage}:${fault}`),
      ),
    )('refuses failed or mismatched acknowledgment: %s', (mode) =>
      expect(invoke(executable, ['fault-' + mode])).toMatchObject({
        passed: true,
        effects: mode.startsWith('settle:') ? 1 : 0,
      }),
    );
    it('accepts a complete simulated-store acknowledgment', () => {
      expect(invoke(executable, ['fault-consume:short-progress'])).toMatchObject({
        passed: true,
        effects: 1,
      });
    });
    it.each([
      ...[1, 2, 3, 4].flatMap((stage) => [`${stage}-before`, `${stage}-after`]),
      'intent-ack',
      'consume-ack',
      'marker-before-effect',
      'during-effect',
      'effect-ack',
      'terminal-ack',
    ])('retains an inert crash-boundary observation: %s', (mode) => {
      expect(invoke(executable, ['crash-' + mode])).toMatchObject({
        passed: true,
        protectedBackendQualified: false,
      });
    });
  },
);
