import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validManifest } = require('../../src/main/mcp-gateway-schema');
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const tool = {
  name: 'record',
  inputSchema: object({ recipient: { type: 'string', maxLength: 32 } }),
  outputSchema: object({ accepted: { type: 'boolean' } }),
};
const grant = () => ({
  id: 'g'.repeat(32),
  taskId: 't'.repeat(32),
  notBefore: 1000,
  expiresAt: 2000,
  tool: 'record',
  arguments: { recipient: 'chosen' },
});
const manifest = (grants = [grant()]) => ({ schemaVersion: 2, tools: [tool], grants });
describe('durable gateway manifest v2 contract', () => {
  it('admits exact grants structurally without deciding current expiry', () => {
    expect(validManifest(manifest())).toBe(true);
    expect(validManifest(manifest([{ ...grant(), notBefore: 0, expiresAt: 86400000 }]))).toBe(true);
    expect(
      validManifest(
        manifest([
          {
            ...grant(),
            notBefore: Number.MAX_SAFE_INTEGER - 1,
            expiresAt: Number.MAX_SAFE_INTEGER,
          },
        ]),
      ),
    ).toBe(true);
    expect(
      validManifest(manifest([{ ...grant(), id: 'A_-0'.repeat(16), taskId: 'z_-9'.repeat(16) }])),
    ).toBe(true);
  });
  it.each(['id', 'taskId'])('requires bounded opaque ASCII %s', (field) => {
    for (const value of [
      undefined,
      null,
      32,
      '',
      'a'.repeat(31),
      'a'.repeat(65),
      'a'.repeat(31) + '.',
      'a'.repeat(31) + '/',
      'a'.repeat(31) + 'é',
      'a'.repeat(31) + ' ',
      'a'.repeat(32) + '\n',
      'a'.repeat(32) + '\r',
    ]) {
      expect(validManifest(manifest([{ ...grant(), [field]: value }]))).toBe(false);
    }
  });
  it.each(['notBefore', 'expiresAt'])('requires safe nonnegative integer %s', (field) => {
    for (const value of [
      undefined,
      null,
      '1000',
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(validManifest(manifest([{ ...grant(), [field]: value }]))).toBe(false);
    }
  });
  it.each([
    [1000, 1000],
    [1000, 999],
    [0, 86400001],
  ])('rejects an empty, inverted or overlong validity window %j', (notBefore, expiresAt) => {
    expect(validManifest(manifest([{ ...grant(), notBefore, expiresAt }]))).toBe(false);
  });
  it('rejects a reused grant ID even for another task and different arguments', () => {
    expect(
      validManifest(
        manifest([
          grant(),
          { ...grant(), taskId: 'x'.repeat(32), arguments: { recipient: 'other' } },
        ]),
      ),
    ).toBe(false);
  });
  it('rejects ambiguous tool and argument matches despite distinct IDs, tasks and windows', () => {
    expect(
      validManifest(
        manifest([
          grant(),
          {
            ...grant(),
            id: 'x'.repeat(32),
            taskId: 'y'.repeat(32),
            notBefore: 3000,
            expiresAt: 4000,
          },
        ]),
      ),
    ).toBe(false);
  });
  it('admits distinct argument grants sharing a task', () => {
    expect(
      validManifest(
        manifest([grant(), { ...grant(), id: 'x'.repeat(32), arguments: { recipient: 'other' } }]),
      ),
    ).toBe(true);
  });
  it('rejects missing or extra grant fields and unknown manifest fields', () => {
    for (const key of Object.keys(grant())) {
      const missing = grant();
      delete missing[key];
      expect(validManifest(manifest([missing]))).toBe(false);
    }
    expect(validManifest(manifest([{ ...grant(), renew: true }]))).toBe(false);
    expect(validManifest({ ...manifest(), storePath: '/untrusted' })).toBe(false);
    expect(validManifest({ ...manifest(), schemaVersion: 3 })).toBe(false);
  });
  it('retains tool existence and exact input-schema validation', () => {
    expect(validManifest(manifest([{ ...grant(), tool: 'unknown' }]))).toBe(false);
    expect(
      validManifest(manifest([{ ...grant(), arguments: { recipient: 'chosen', extra: true } }])),
    ).toBe(false);
    expect(validManifest(manifest([{ ...grant(), arguments: { recipient: 7 } }]))).toBe(false);
  });
  it('preserves version 1 grants and rejects mixed version shapes', () => {
    const oldGrant = { tool: 'record', arguments: { recipient: 'chosen' } };
    const old = { schemaVersion: 1, tools: [tool], grants: [oldGrant] };
    expect(validManifest(old)).toBe(true);
    expect(validManifest({ ...old, grants: [oldGrant, oldGrant] })).toBe(false);
    expect(validManifest({ ...old, grants: [grant()] })).toBe(false);
    expect(validManifest(manifest([oldGrant]))).toBe(false);
  });
});
