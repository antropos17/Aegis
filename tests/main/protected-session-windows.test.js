import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  encodeProtectedSessionRequest,
  decodeProtectedSessionResponse,
} = require('../../src/main/protected-session-protocol');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const request = (operation = 'prepare') => ({
  operation,
  requestId: 'a'.repeat(32),
  sessionId: 'b'.repeat(32),
});
const payload = (changes = {}) =>
  JSON.stringify({
    protocol: 'aegis-protected-session',
    version: 1,
    ...request(),
    ...changes,
  });
function frame(text) {
  const bytes = Buffer.from(text);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
}
let root, helper;
function invoke(input) {
  return spawnSync(helper, [], { input, timeout: 5000, maxBuffer: 4096, windowsHide: true });
}

describe.skipIf(process.platform !== 'win32')('native inactive Protected Session helper', () => {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-session-protocol-'));
    helper = path.join(root, 'session.exe');
    const sources = fs
      .readdirSync(path.join(project, 'sidecar/session'))
      .filter((name) => name.endsWith('.cs'))
      .sort()
      .map((name) => path.join(project, 'sidecar/session', name));
    const csc = path.join(
      process.env.WINDIR || 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    execFileSync(
      csc,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/reference:System.Management.dll',
        '/reference:System.Security.dll',
        `/out:${helper}`,
        ...sources,
        path.join(project, 'sidecar/mcpjob/AppContainerExecutable.cs'),
      ],
      { timeout: 30000, stdio: 'pipe', windowsHide: true },
    );
  });

  afterAll(() => {
    if (!root) return;
    expect(path.dirname(root)).toBe(fs.realpathSync(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it.each(['probe', 'prepare'])('interoperates with the JS contract for %s', (operation) => {
    const expected = request(operation);
    const result = invoke(encodeProtectedSessionRequest(expected));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(operation === 'probe' ? 0 : 3);
    expect(result.stderr.length).toBe(0);
    expect(decodeProtectedSessionResponse(result.stdout, expected)).toMatchObject({
      state: 'unavailable',
      launchAllowed: false,
      reason: 'containment-unavailable',
    });
  });

  it.each([
    Buffer.alloc(0),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([1, 8, 0, 0]),
    Buffer.from([255, 255, 255, 255]),
    frame('{}'),
    frame('null'),
    frame('[]'),
    frame('{'),
    frame(payload({ version: 2 })),
    frame(payload({ operation: 'launch' })),
    frame(payload({ ownerSid: 'S-1-5-18' })),
    frame(payload({ ownerPid: 1 })),
    frame(payload({ sessionId: 'b'.repeat(31) })),
    frame(payload({ sessionId: 'b'.repeat(32) + '\n' })),
    frame(payload({ requestId: 'a'.repeat(32) + '\n' })),
    frame(payload({ requestId: 'A'.repeat(32) })),
    frame(payload().replace('"version":1', '"version":2,"version":1')),
    frame(' ' + payload()),
    frame(payload() + '\n'),
    Buffer.concat([frame(payload()), frame(payload())]),
    frame(payload()).subarray(0, -1),
    Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from([0xc0, 0xaf])]),
  ])('rejects hostile/unsupported input without echoing it %#', (input) => {
    const result = invoke(input);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout.length + result.stderr.length).toBe(0);
  });

  it('never starts a supplied executable or changes the outside sentinel', () => {
    const sentinel = path.join(root, 'outside-sentinel');
    const code = 'require("node:fs").writeFileSync(process.argv[1], "control")';
    execFileSync(process.execPath, ['-e', code, sentinel]);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('control');
    fs.unlinkSync(sentinel);
    const result = invoke(
      frame(payload({ executable: process.execPath, args: ['-e', code, sentinel] })),
    );
    expect(result.status).toBe(2);
    expect(result.stdout.length + result.stderr.length).toBe(0);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('ends a partial or unclosed input within its own deadline', async () => {
    const child = spawn(helper, [], { stdio: 'pipe', windowsHide: true });
    let timer;
    try {
      child.stdin.on('error', () => {});
      const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code));
        timer = setTimeout(() => reject(Error('native-input-deadline-missed')), 4000);
      });
      child.stdin.write(Buffer.from([1]));
      expect(await done).toBe(2);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) {
        const closed = new Promise((resolve) => child.once('close', resolve));
        child.kill();
        await closed;
      }
    }
  }, 6000);
});
