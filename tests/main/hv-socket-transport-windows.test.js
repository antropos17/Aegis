import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../../', import.meta.url));
let root, executable, production;

function invoke(file, mode) {
  return JSON.parse(
    execFileSync(file, [mode], {
      timeout: 10000,
      maxBuffer: 32768,
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    }).toString(),
  );
}

function compile(file, sources, defines) {
  try {
    execFileSync(
      path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/warnaserror+',
        '/optimize+',
        ...defines,
        `/out:${file}`,
        ...sources,
      ],
      {
        timeout: 30000,
        maxBuffer: 32768,
        windowsHide: true,
        env: { ...process.env, TEMP: root, TMP: root },
      },
    );
  } catch (failure) {
    throw new Error(
      `Native fixture compilation failed:\n${failure.stdout?.toString() || ''}\n${failure.stderr?.toString() || ''}`,
      { cause: failure },
    );
  }
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'finite Hyper-V socket transport (modeled native responses)',
  () => {
    beforeAll(() => {
      const parent = path.join(project, 'out/development');
      fs.mkdirSync(parent, { recursive: true });
      root = fs.mkdtempSync(path.join(parent, 'b05-fixture-'));
      executable = path.join(root, 'fixture.exe');
      production = path.join(root, 'production.exe');
      const sources = ['HvSocketEndpoint', 'HvSocketNative', 'HvSocketTransport'].map((name) =>
        path.join(project, 'sidecar/session', `${name}.cs`),
      );
      sources.push(
        ...fs
          .readdirSync(path.join(project, 'tests/fixtures/hv-socket-transport'))
          .filter((name) => name.endsWith('.cs'))
          .sort()
          .map((name) => path.join(project, 'tests/fixtures/hv-socket-transport', name)),
      );
      compile(executable, sources, ['/define:HV_SOCKET_TEST']);
      compile(production, sources, []);
    }, 65000);

    afterAll(() => {
      if (!root) return;
      expect(path.dirname(fs.realpathSync(root))).toBe(
        fs.realpathSync(path.join(project, 'out/development')),
      );
      expect(path.basename(root)).toMatch(/^b05-fixture-/);
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      for (const leaf of fs.readdirSync(root)) {
        const stat = fs.lstatSync(path.join(root, leaf));
        expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(false);
      }
      fs.rmSync(root, { recursive: true });
    });

    it('refuses a foreign OS-observed peer rather than substituting the requested destination', () => {
      expect(invoke(executable, 'foreign-peer')).toEqual({ passed: true, nativeEffects: 0 });
    });

    it('compiles real native declarations without injected factories or fixture types', () => {
      expect(invoke(production, 'production')).toEqual({
        passed: true,
        nativeEffects: 0,
        injectedFactory: false,
      });
    });

    it('binds the canonical native endpoint to the fixed service', () => {
      expect(invoke(executable, 'endpoint').passed).toBe(true);
    });

    it.each([
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '90db8b89-0d35-4f79-8ce9-49ea0ac8b7cd',
      'e0e16197-dd56-4a10-9195-5ee7a155a838',
      'a42e7cda-d03f-480c-9cc2-a4de20abb878',
    ])('refuses reserved route %s before socket creation', (route) => {
      expect(invoke(executable, `target:${route}`).passed).toBe(true);
    });

    it.each([
      'service',
      'reserved',
      'family',
      'short',
      'long',
      'unsupported',
      'before-frame',
      'after-frame',
    ])('permanently refuses changed or unavailable peer: %s', (mode) => {
      expect(invoke(executable, `peer:${mode}`).passed).toBe(true);
    });

    it.each([
      'pending-success',
      'error-ready',
      'so-error',
      'refused',
      'never-ready',
      'open-failure',
      'error-query-failure',
      'wait-failure',
      'cancel-before',
      'cancel-open',
      'cancel-connect',
      'cancel-wait',
      'cancel-peer',
      'expires-peer',
    ])('handles bounded nonblocking connect: %s', (mode) => {
      expect(invoke(executable, `connect:${mode}`).passed).toBe(true);
    });

    it.each(Array.from({ length: 8 }, (_, offset) => offset))(
      'preserves terminal refusal after read failure at frame offset %s',
      (offset) => {
        expect(invoke(executable, `read-failure:${offset}`).passed).toBe(true);
      },
    );

    it.each(Array.from({ length: 8 }, (_, offset) => offset))(
      'never resends a partial write after failure at frame offset %s',
      (offset) => {
        expect(invoke(executable, `write-failure:${offset}`).passed).toBe(true);
      },
    );

    it.each([0, 4097, 4294967295])(
      'refuses oversized or empty frame length %s before body read',
      (length) => {
        expect(invoke(executable, `length:${length}`).passed).toBe(true);
      },
    );

    it.each([
      'roundtrip',
      'max',
      'copy',
      'would-block',
      'zero-send',
      'eof',
      'empty-write',
      'large-write',
      'null-write',
    ])('transfers bounded opaque frame bytes: %s', (mode) => {
      expect(invoke(executable, `frames:${mode}`).passed).toBe(true);
    });

    it.each([
      'budget-write',
      'budget-read',
      'budget-mixed',
      'dispose',
      'close-unknown',
      'connect-cleanup-unknown',
      'frame-cleanup-unknown',
      'reentry',
      'dispose-reentry',
      'overlap',
      'dispose-overlap',
      'cancel-before-frame',
      'cancel-wait',
      'cancel-header',
      'cancel-body',
      'cancel-after-frame',
      'cancel-read-header',
      'cancel-read-body',
      'drip-read',
      'drip-write',
      'lifetime',
      'clock-backward',
      'expires-peer',
      'wait-error',
      'wait-no-ready',
      'wait-invalid',
      'restore-peer',
    ])('retains bounded lifetime, budget and cancellation: %s', (mode) => {
      expect(invoke(executable, `lifecycle:${mode}`).passed).toBe(true);
    });

    it.each([
      'cancel',
      'expire',
      'connect-gap',
      'frame-gap',
      'native-reentry',
      'close-unknown',
      'dispose-race',
      'register-cancelled',
    ])('cleans up idle ownership without another frame call: %s', (mode) => {
      expect(invoke(executable, `idle:${mode}`).passed).toBe(true);
    });
  },
);
