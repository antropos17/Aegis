import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  supportedSchema,
  matchesSchema,
  validManifest,
  validResult,
} = require('../../src/main/mcp-gateway-schema');
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
describe('bounded gateway schemas', () => {
  it.each([
    { type: 'string' },
    { type: 'string', maxLength: 5, pattern: '.*' },
    { type: ['string', 'null'], maxLength: 5 },
    { $ref: 'file:///private' },
    { type: 'array', items: { type: 'boolean' } },
    { ...object({}), additionalProperties: true },
    { ...object({}), required: ['missing'] },
    { type: 'number', minimum: 2, maximum: 1 },
    { type: 'integer', default: 0 },
    object(JSON.parse('{"__proto__":{"type":"boolean"}}')),
  ])('rejects unsupported schema %j', (schema) => expect(supportedSchema(schema)).toBe(false));
  it('validates closed nested objects, bounded arrays, enum and numeric ranges without coercion', () => {
    const schema = object({
      items: {
        type: 'array',
        maxItems: 2,
        items: object({
          n: { type: 'integer', minimum: 1, maximum: 3 },
          label: { type: 'string', maxLength: 2, enum: ['ok'] },
        }),
      },
      absent: { type: 'null' },
    });
    expect(supportedSchema(schema)).toBe(true);
    const good = { items: [{ n: 2, label: 'ok' }], absent: null };
    expect(matchesSchema(schema, good)).toBe(true);
    for (const n of ['2', 0, 4, 1.5, NaN, Infinity])
      expect(matchesSchema(schema, { ...good, items: [{ n, label: 'ok' }] })).toBe(false);
    for (const label of ['no', 'long', 2])
      expect(matchesSchema(schema, { ...good, items: [{ n: 2, label }] })).toBe(false);
    expect(
      matchesSchema(schema, { ...good, items: [...good.items, ...good.items, ...good.items] }),
    ).toBe(false);
    expect(matchesSchema(schema, { ...good, extra: true })).toBe(false);
    expect(matchesSchema(schema, { items: [] })).toBe(false);
  });
  it('rejects duplicate tools, duplicate grants and grants outside the input schema', () => {
    const tool = { name: 'chosen', inputSchema: object({}), outputSchema: object({}) };
    const grant = { tool: 'chosen', arguments: {} };
    const good = { schemaVersion: 1, tools: [tool], grants: [grant] };
    expect(validManifest(good)).toBe(true);
    expect(validManifest({ ...good, tools: [tool, tool] })).toBe(false);
    expect(validManifest({ ...good, grants: [grant, grant] })).toBe(false);
    expect(validManifest({ ...good, grants: [{ ...grant, arguments: { extra: true } }] })).toBe(
      false,
    );
    expect(validManifest({ ...good, grants: [{ ...grant, tool: 'other' }] })).toBe(false);
  });
  it('requires the only text block to exactly serialize validated structured output', () => {
    const tool = { outputSchema: object({ ok: { type: 'boolean' } }) };
    const good = {
      structuredContent: { ok: true },
      content: [{ type: 'text', text: '{"ok":true}' }],
    };
    expect(validResult(tool, good)).toBe(true);
    for (const delta of [
      { isError: true },
      { extra: 'hidden' },
      { content: [{ type: 'text', text: 'hidden' }] },
      { structuredContent: { ok: true, hidden: 'value' } },
      { content: [{ type: 'resource', text: '{"ok":true}' }] },
    ])
      expect(validResult(tool, { ...good, ...delta })).toBe(false);
  });
});
