'use strict';

const { hashSnapshotValue } = require('./inventory-snapshot');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Fingerprint one explicitly exported MCP tools/list result without returning names or text.
 * This validates a bounded structural subset, not the JSON Schemas or server identity.
 * @param {object} file Strictly parsed file with raw-byte hash and path binding.
 * @returns {object} Hashed tool entries and pagination completeness.
 * @since v0.15.1
 */
function summarizeToolCatalog(file) {
  const fail = () => {
    throw new Error('tool-catalog-invalid');
  };
  const { value } = file;
  if (!record(value)) fail();
  // Accept a bare ListToolsResult or one successful JSON-RPC response, never both.
  let result = value;
  if (
    Object.hasOwn(value, 'result') ||
    Object.hasOwn(value, 'jsonrpc') ||
    Object.hasOwn(value, 'error')
  ) {
    if (
      value.jsonrpc !== '2.0' ||
      !(typeof value.id === 'string' || Number.isSafeInteger(value.id)) ||
      Object.hasOwn(value, 'error') ||
      Object.hasOwn(value, 'tools') ||
      !record(value.result)
    )
      fail();
    result = value.result;
  }
  if (
    !Array.isArray(result.tools) ||
    result.tools.length > 256 ||
    (Object.hasOwn(result, 'resultType') && result.resultType !== 'complete') ||
    (Object.hasOwn(result, 'nextCursor') && typeof result.nextCursor !== 'string')
  )
    fail();
  const names = new Set();
  const tools = result.tools.map((tool) => {
    if (
      !record(tool) ||
      typeof tool.name !== 'string' ||
      !tool.name.length ||
      tool.name.length > 256 ||
      names.has(tool.name) ||
      !record(tool.inputSchema) ||
      tool.inputSchema.type !== 'object' ||
      (Object.hasOwn(tool, 'description') && typeof tool.description !== 'string') ||
      (Object.hasOwn(tool, 'outputSchema') &&
        (!record(tool.outputSchema) || tool.outputSchema.type !== 'object'))
    )
      fail();
    names.add(tool.name);
    try {
      return { id: hashSnapshotValue(tool.name), sha256: hashSnapshotValue(tool) };
    } catch (_) {
      return fail();
    }
  });
  return {
    sourceSha256: file.sourceSha256,
    sha256: file.sha256,
    complete: !Object.hasOwn(result, 'nextCursor'),
    tools,
  };
}

module.exports = { summarizeToolCatalog };
