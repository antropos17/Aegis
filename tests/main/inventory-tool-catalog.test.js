import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { parseInventoryConfig } = require('../../src/main/inventory-config');
const { summarizeToolCatalog } = require('../../src/main/inventory-tool-catalog');
const {
  createSnapshot,
  acceptSnapshot,
  hashSnapshotValue: hash,
} = require('../../src/main/inventory-snapshot');
const { compareSnapshots } = require('../../src/main/inventory-snapshot-diff');
const tool = () => ({
  name: 'read_CANARY',
  description: 'PRIVATE_CANARY',
  inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
});
function catalog(value, source = 'source') {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const parsed = parseInventoryConfig(Buffer.from(raw), 'json');
  expect(parsed.parseStatus).toBe('parsed');
  return summarizeToolCatalog({
    value: parsed.value,
    sha256: createHash('sha256').update(raw).digest('hex'),
    sourceSha256: hash(source),
  });
}
function snapshot(tools) {
  return createSnapshot(
    {
      schemaVersion: 3,
      mode: 'project-inventory',
      adapter: { id: 'project', version: 1 },
      scope: {},
      limits: {},
      complete: true,
      issues: [],
      components: [],
      packages: [],
    },
    hash('root'),
    tools,
  );
}

describe('explicit offline MCP catalog evidence', () => {
  it.each([false, true])(
    'reads a successful tools/list export (JSON-RPC wrapper: %s)',
    (wrapped) => {
      const result = { resultType: 'complete', tools: [tool()] };
      const summary = catalog(wrapped ? { jsonrpc: '2.0', id: 1, result } : result);
      expect(summary.complete).toBe(true);
      expect(summary.tools).toHaveLength(1);
      expect(JSON.stringify(summary)).not.toContain('CANARY');
      expect(JSON.stringify(snapshot(summary))).not.toContain('PRIVATE');
    },
  );

  it.each(['description', 'inputSchema', 'outputSchema', 'annotations', 'icons', '_meta'])(
    'requires review when %s changes after acceptance',
    (field) => {
      const original = snapshot(catalog({ tools: [tool()] }));
      const baseline = acceptSnapshot(original, original.digest, original);
      const updated = tool();
      const changes = {
        description: 'poisoned CANARY',
        inputSchema: {
          type: 'object',
          properties: { password: { type: 'string', 'x-mcp-header': 'CANARY' } },
        },
        outputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
        icons: [{ src: 'https://CANARY.invalid' }],
        _meta: { private: 'CANARY' },
      };
      updated[field] = changes[field];
      const diff = compareSnapshots(baseline, snapshot(catalog({ tools: [updated] })));
      expect(diff.reviewRequired).toBe(true);
      expect(diff.changes.tools.changed).toHaveLength(1);
      expect(diff.changes.catalogBytesChanged).toBe(true);
      expect(JSON.stringify(diff)).not.toContain('CANARY');
    },
  );

  it('does not reuse acceptance when a catalog is omitted or another file replaces its source', () => {
    const original = snapshot(catalog({ tools: [tool()] }));
    const baseline = acceptSnapshot(original, original.digest, original);
    for (const current of [snapshot(null), snapshot(catalog({ tools: [tool()] }, 'other file'))]) {
      expect(compareSnapshots(baseline, current)).toMatchObject({
        status: 'incompatible',
        reviewRequired: true,
      });
    }
  });

  it('never treats a paginated first page as a complete accepted catalog', () => {
    const original = snapshot(catalog({ tools: [tool()] }));
    const baseline = acceptSnapshot(original, original.digest, original);
    const partial = snapshot(catalog({ tools: [], nextCursor: 'CANARY_NEXT_PAGE' }));
    expect(compareSnapshots(baseline, partial)).toMatchObject({
      status: 'incomplete',
      reviewRequired: true,
    });
    expect(compareSnapshots(baseline, partial).changes.tools.removed).toEqual([]);
    expect(() => acceptSnapshot(partial, partial.digest, partial)).toThrow('snapshot-incomplete');
  });

  it('retains byte-level changes even when JSON number parsing or formatting is equivalent', () => {
    const raw = '{"tools":[{"name":"number","inputSchema":{"type":"object","const":1e0}}]}';
    const before = snapshot(catalog(raw));
    const after = snapshot(catalog(raw.replace('1e0', '1.0')));
    const diff = compareSnapshots(acceptSnapshot(before, before.digest, before), after);
    expect(diff.changes.tools.changed).toEqual([]);
    expect(diff.changes.catalogBytesChanged).toBe(true);
    expect(diff.reviewRequired).toBe(true);
  });

  it.each([
    { tools: [tool(), tool()] },
    { tools: Array.from({ length: 257 }, (_, i) => ({ ...tool(), name: String(i) })) },
    { tools: [null] },
    { tools: [{ ...tool(), name: '' }] },
    { tools: [{ ...tool(), inputSchema: null }] },
    { tools: [{ ...tool(), outputSchema: [] }] },
    { tools: [{ ...tool(), description: {} }] },
    { tools: [], nextCursor: 4 },
    { tools: [], resultType: 'input_required' },
    { tools: [], resultType: 'not_modified' },
    { jsonrpc: '2.0', id: 1, error: { message: 'CANARY' }, result: { tools: [] } },
    { jsonrpc: '2.0', id: {}, result: { tools: [] } },
    { jsonrpc: '2.0', id: 1, result: { tools: [] }, tools: [] },
  ])('rejects malformed, duplicate, unsupported or oversized catalogs', (value) => {
    expect(() => catalog(value)).toThrow('tool-catalog-invalid');
  });

  it('rejects non-finite parsed schema numbers instead of canonicalizing them as null', () => {
    expect(() =>
      catalog('{"tools":[{"name":"test","inputSchema":{"type":"object","const":1e999}}]}'),
    ).toThrow('tool-catalog-invalid');
  });
});
