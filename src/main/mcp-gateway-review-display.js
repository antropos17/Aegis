/** @file Bounded owner-only display for an explicitly disclosed MCP call. */
'use strict';

const { types } = require('node:util');
const { isDeepStrictEqual } = require('node:util');

const MAX_TOOLS = 8;
const MAX_PATHS = 256;
const MAX_NODES = 2048;
const MAX_DEPTH = 8;
const MAX_STRING = 4096;
const MAX_PREVIEW = 12 * 1024;
const hasControls = (text) =>
  Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
const SENSITIVE =
  /(?:password|passphrase|passwd|pwd|secret|token|credential|api[-_]?key|access[-_]?key|private[-_]?key|auth|bearer|cookie)/i;
const INVALID_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const fail = () => ({ ok: false, reason: 'review-display-unavailable' });
const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !types.isProxy(value) &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const only = (value, keys) =>
  record(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
const pointer = (segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

function safeArray(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === value.length + 1 &&
    keys.at(-1) === 'length' &&
    keys.slice(0, -1).every((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return key === String(index) && descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    })
  );
}

function validPath(path) {
  if (typeof path !== 'string' || path.length > 512 || hasControls(path)) return false;
  if (path === '') return true;
  if (!path.startsWith('/') || /~(?![01])/.test(path)) return false;
  return path
    .slice(1)
    .split('/')
    .every((segment) => {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      return !INVALID_KEYS.has(key) && !SENSITIVE.test(key);
    });
}

function policyMap(policy) {
  if (
    !only(policy, ['schemaVersion', 'tools']) ||
    policy.schemaVersion !== 1 ||
    !safeArray(policy.tools) ||
    !policy.tools.length ||
    policy.tools.length > MAX_TOOLS
  )
    throw Error('invalid');
  const tools = new Map();
  for (const tool of policy.tools) {
    if (
      !only(tool, ['name', 'paths']) ||
      typeof tool.name !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name) ||
      tools.has(tool.name) ||
      !safeArray(tool.paths) ||
      tool.paths.length > MAX_PATHS ||
      !tool.paths.every(validPath) ||
      new Set(tool.paths).size !== tool.paths.length
    )
      throw Error('invalid');
    tools.set(tool.name, new Set(tool.paths));
  }
  return tools;
}

/** Validate an owner-selected disclosure policy without emitting its content.
 * @param {unknown} policy Parsed disclosure policy.
 * @returns {boolean} Whether the complete policy is supported.
 * @since 0.21.0-beta
 */
function validReviewPolicy(policy) {
  try {
    policyMap(policy);
    return true;
  } catch {
    return false;
  }
}

function leaves(value, paths) {
  const result = new Map();
  let nodes = 0;
  const walk = (item, location, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw Error('invalid');
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      if (
        (typeof item === 'number' && !Number.isFinite(item)) ||
        (typeof item === 'string' && (item.length > MAX_STRING || hasControls(item))) ||
        !paths.has(location)
      )
        throw Error('invalid');
      result.set(location, item);
      return;
    }
    if (!item || typeof item !== 'object' || types.isProxy(item)) throw Error('invalid');
    const array = Array.isArray(item);
    if (array && Object.getPrototypeOf(item) !== Array.prototype) throw Error('invalid');
    if (!array && !record(item)) throw Error('invalid');
    const keys = Reflect.ownKeys(item);
    if (array) {
      if (
        keys.length !== item.length + 1 ||
        keys.at(-1) !== 'length' ||
        keys.slice(0, -1).some((key, index) => key !== String(index))
      )
        throw Error('invalid');
    } else if (keys.some((key) => typeof key !== 'string')) throw Error('invalid');
    const properties = array ? keys.slice(0, -1) : keys;
    if (!properties.length) {
      if (!paths.has(location)) throw Error('invalid');
      result.set(location, array ? [] : {});
      return;
    }
    for (const key of properties) {
      if (hasControls(key) || SENSITIVE.test(key) || INVALID_KEYS.has(key)) throw Error('invalid');
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw Error('invalid');
      walk(property.value, location + '/' + pointer(key), depth + 1);
    }
  };
  if (!record(value)) throw Error('invalid');
  walk(value, '', 0);
  return result;
}

/** Render a private preview only if the owner's exact disclosure permits every leaf.
 * @param {object} input Policy, tool, captured current arguments and optional prior approval.
 * @returns {{ok: boolean, preview?: string, reason?: string}} Owner-only preview or fixed refusal.
 * @since 0.21.0-beta
 */
function renderReview(input) {
  try {
    if (!record(input)) throw Error('invalid');
    const required = ['policy', 'tool', 'current'];
    const names = Reflect.ownKeys(input);
    if (
      names.some((name) => ![...required, 'previous'].includes(name)) ||
      !required.every((name) => Object.hasOwn(input, name))
    )
      throw Error('invalid');
    const values = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('invalid');
      values[name] = descriptor.value;
    }
    const { policy, tool, current, previous } = values;
    const allowed = policyMap(policy).get(tool);
    if (!allowed) throw Error('invalid');
    const now = leaves(current, allowed);
    const before = previous === undefined ? null : leaves(previous, allowed);
    const changes = [];
    if (before) {
      for (const [path, oldValue] of before) {
        if (!now.has(path)) changes.push({ path, type: 'removed', before: oldValue });
        else if (!isDeepStrictEqual(oldValue, now.get(path)))
          changes.push({ path, type: 'changed', before: oldValue, after: now.get(path) });
      }
      for (const [path, value] of now)
        if (!before.has(path)) changes.push({ path, type: 'added', after: value });
    }
    const preview = JSON.stringify(
      { tool, baseline: before ? 'previous-owner-approved-call' : 'none', current, changes },
      null,
      2,
    ).replace(
      /[\u007f-\uffff]/g,
      (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    if (Buffer.byteLength(preview, 'utf8') > MAX_PREVIEW) throw Error('invalid');
    return { ok: true, preview };
  } catch {
    return fail();
  }
}

module.exports = { renderReview, validReviewPolicy };
