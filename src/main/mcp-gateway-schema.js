'use strict';
const { isIPv4 } = require('node:net');
const { equalActionValue: equal } = require('./action-policy');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const name = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const count = (value, limit) => Number.isSafeInteger(value) && value >= 0 && value <= limit;
const route = (value) => {
  if (!object(value) || typeof value.url !== 'string' || !value.url || value.url.length > 512)
    return false;
  if (value.transport === 'http')
    return Object.keys(value).length === 2 && keys(value, ['transport', 'url']);
  return (
    value.transport === 'https' &&
    Object.keys(value).length === 4 &&
    keys(value, ['transport', 'url', 'connectAddress', 'certificateSha256']) &&
    typeof value.connectAddress === 'string' &&
    isIPv4(value.connectAddress) &&
    typeof value.certificateSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.certificateSha256)
  );
};

/** Validate a closed, bounded JSON Schema subset; unsupported keywords never disappear.
 * @param {object} schema Selected schema. @returns {boolean} Supported schema. @since v0.15.1 */
function supportedSchema(schema) {
  let nodes = 0;
  function visit(s, depth) {
    if (++nodes > 128 || depth > 4 || !object(s)) return false;
    const common = ['type', 'description', 'enum'];
    if (
      s.description !== undefined &&
      (typeof s.description !== 'string' || s.description.length > 1024)
    )
      return false;
    const extras = {
      object: ['properties', 'required', 'additionalProperties'],
      array: ['items', 'maxItems'],
      string: ['maxLength'],
      number: ['minimum', 'maximum'],
      integer: ['minimum', 'maximum'],
      boolean: [],
      null: [],
    };
    if (
      typeof s.type !== 'string' ||
      !Object.hasOwn(extras, s.type) ||
      !keys(s, [...common, ...extras[s.type]])
    )
      return false;
    if (
      s.enum !== undefined &&
      (!Array.isArray(s.enum) ||
        !s.enum.length ||
        s.enum.length > 32 ||
        s.enum.some((v) => !['string', 'number', 'boolean'].includes(typeof v) && v !== null))
    )
      return false;
    if (s.type === 'object') {
      if (
        s.additionalProperties !== false ||
        !object(s.properties) ||
        Object.keys(s.properties).length > 32 ||
        !Array.isArray(s.required) ||
        new Set(s.required).size !== s.required.length ||
        !s.required.every((key) => Object.hasOwn(s.properties, key))
      )
        return false;
      return Object.entries(s.properties).every(
        ([key, child]) => name(key) && visit(child, depth + 1),
      );
    }
    if (s.type === 'array') return count(s.maxItems, 64) && visit(s.items, depth + 1);
    if (s.type === 'string') return count(s.maxLength, 4096);
    if (['number', 'integer'].includes(s.type))
      return (
        ['minimum', 'maximum'].every(
          (k) => s[k] === undefined || (typeof s[k] === 'number' && Number.isFinite(s[k])),
        ) && !(s.minimum !== undefined && s.maximum !== undefined && s.minimum > s.maximum)
      );
    return true;
  }
  return visit(schema, 0);
}

/** Validate JSON without coercion, defaults, regex execution or external references.
 * @param {object} schema Previously validated schema. @param {unknown} value Private data.
 * @returns {boolean} Whether every value is admitted. @since v0.15.1 */
function matchesSchema(schema, value) {
  if (schema.enum && !schema.enum.some((item) => equal(item, value))) return false;
  switch (schema.type) {
    case 'object':
      return (
        object(value) &&
        schema.required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every(
          (key) =>
            Object.hasOwn(schema.properties, key) &&
            matchesSchema(schema.properties[key], value[key]),
        )
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length <= schema.maxItems &&
        value.every((item) => matchesSchema(schema.items, item))
      );
    case 'string':
      return typeof value === 'string' && Array.from(value).length <= schema.maxLength;
    case 'integer':
      if (!Number.isSafeInteger(value)) return false; // fall through
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

/** Check the operator's complete accepted tools and exact one-use grants.
 * @param {object} value Private manifest. @returns {boolean} Supported manifest. @since v0.15.1 */
function validManifest(value) {
  if (
    !object(value) ||
    ![1, 2, 3, 4, 5].includes(value.schemaVersion) ||
    !keys(
      value,
      value.schemaVersion === 5
        ? ['schemaVersion', 'stdioRouteTag', 'tools', 'grants']
        : value.schemaVersion === 4
          ? ['schemaVersion', 'route', 'credentialTag', 'tools', 'grants']
          : value.schemaVersion === 3
            ? ['schemaVersion', 'route', 'tools', 'grants']
            : ['schemaVersion', 'tools', 'grants'],
    ) ||
    ([3, 4].includes(value.schemaVersion) &&
      (!Object.hasOwn(value, 'route') || !route(value.route))) ||
    (value.schemaVersion === 4 &&
      (typeof value.credentialTag !== 'string' || !/^[a-f0-9]{64}$/.test(value.credentialTag))) ||
    (value.schemaVersion === 5 &&
      (typeof value.stdioRouteTag !== 'string' || !/^[a-f0-9]{64}$/.test(value.stdioRouteTag))) ||
    !Array.isArray(value.tools) ||
    !value.tools.length ||
    value.tools.length > 8 ||
    !Array.isArray(value.grants) ||
    !value.grants.length ||
    value.grants.length > 16
  )
    return false;
  const names = new Set();
  for (const tool of value.tools) {
    if (
      !keys(tool, ['name', 'title', 'description', 'inputSchema', 'outputSchema']) ||
      !name(tool.name) ||
      names.has(tool.name) ||
      (tool.description !== undefined &&
        (typeof tool.description !== 'string' || tool.description.length > 1024)) ||
      (tool.title !== undefined && (typeof tool.title !== 'string' || tool.title.length > 128)) ||
      tool.inputSchema?.type !== 'object' ||
      tool.outputSchema?.type !== 'object' ||
      !supportedSchema(tool.inputSchema) ||
      !supportedSchema(tool.outputSchema)
    )
      return false;
    names.add(tool.name);
  }
  return value.grants.every((grant, index) => {
    const durable = value.schemaVersion >= 2;
    const fields = durable
      ? ['id', 'taskId', 'notBefore', 'expiresAt', 'tool', 'arguments']
      : ['tool', 'arguments'];
    if (!keys(grant, fields) || !names.has(grant.tool)) return false;
    if (
      durable &&
      (!['id', 'taskId'].every(
        (key) =>
          typeof grant[key] === 'string' &&
          grant[key].length >= 32 &&
          grant[key].length <= 64 &&
          !/[^A-Za-z0-9_-]/.test(grant[key]),
      ) ||
        !['notBefore', 'expiresAt'].every(
          (key) => Number.isSafeInteger(grant[key]) && grant[key] >= 0,
        ) ||
        grant.expiresAt <= grant.notBefore ||
        grant.expiresAt - grant.notBefore > 86400000 ||
        value.grants.slice(0, index).some((prior) => prior.id === grant.id))
    )
      return false;
    const tool = value.tools.find((item) => item.name === grant.tool);
    return (
      matchesSchema(tool.inputSchema, grant.arguments) &&
      !value.grants
        .slice(0, index)
        .some((prior) => prior.tool === grant.tool && equal(prior.arguments, grant.arguments))
    );
  });
}

/** Admit structured results only; auxiliary text cannot smuggle a second unvalidated payload.
 * @param {object} tool Accepted definition. @param {object} result Private upstream result.
 * @returns {boolean} Complete supported result. @since v0.15.1 */
function validResult(tool, result) {
  return (
    keys(result, ['content', 'structuredContent', 'isError']) &&
    (result.isError === undefined || result.isError === false) &&
    matchesSchema(tool.outputSchema, result.structuredContent) &&
    Array.isArray(result.content) &&
    result.content.length === 1 &&
    keys(result.content[0], ['type', 'text']) &&
    result.content[0].type === 'text' &&
    result.content[0].text === JSON.stringify(result.structuredContent)
  );
}
module.exports = { supportedSchema, matchesSchema, validManifest, validResult };
