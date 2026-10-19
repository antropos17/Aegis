// @ts-check
'use strict';

const { TextDecoder } = require('node:util');
const { createHash } = require('node:crypto');
/** @typedef {{ start: number, end: number, text: string }} Edit */
/** @param {string|Buffer} value */
const hash = (value) => createHash('sha256').update(value).digest('hex');

/** @typedef {{ kind: 'object'|'array'|'scalar', start: number, end: number, value?: unknown, members: Map<string, JsonNode>, items: JsonNode[], commas: number[] }} JsonNode */
const LIMITS = Object.freeze({ bytes: 256 * 1024, depth: 32, nodes: 20000 });
const byteLength = /** @type {() => number} */ (
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')?.get
);

/**
 * Scan strict UTF-8 JSON without rewriting it. Reject duplicate decoded keys.
 * All failures contain only fixed codes, never source text or exception details.
 * @param {Buffer} supplied Explicitly supplied configuration bytes.
 * @returns {{ bytes: Buffer, text: string, root: JsonNode }} Private source tree.
 * @since v0.19.3
 */
function scanJson(supplied) {
  if (!Buffer.isBuffer(supplied) || Object.getPrototypeOf(supplied) !== Buffer.prototype)
    throw Error('INVALID_BYTES');
  const length = byteLength.call(supplied);
  if (length > LIMITS.bytes) throw Error('CONFIG_TOO_LARGE');
  const bytes = Buffer.alloc(length);
  // Intrinsic typed-array copy does not invoke caller-supplied Buffer accessors.
  Uint8Array.prototype.set.call(bytes, supplied);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw Error('INVALID_ENCODING');
  }
  let position = 0;
  let nodes = 0;
  const fail = () => {
    throw Error('INVALID_JSON');
  };
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(text[position] || '\0')) position++;
  };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '\\') position++;
      else if (character === '"') {
        try {
          return /** @type {string} */ (JSON.parse(text.slice(start, position)));
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  /** @param {number} depth @returns {JsonNode} */
  const parse = (depth) => {
    if (depth > LIMITS.depth || ++nodes > LIMITS.nodes) throw Error('CONFIG_COMPLEXITY');
    whitespace();
    const start = position;
    const first = text[position];
    /** @type {JsonNode} */
    const node = { kind: 'scalar', start, end: start, members: new Map(), items: [], commas: [] };
    if (first === '{' || first === '[') {
      node.kind = first === '{' ? 'object' : 'array';
      const close = first === '{' ? '}' : ']';
      position++;
      whitespace();
      if (text[position] !== close) {
        for (;;) {
          if (node.kind === 'object') {
            if (text[position] !== '"') fail();
            const key = string();
            if (node.members.has(key)) throw Error('DUPLICATE_KEY');
            whitespace();
            if (text[position++] !== ':') fail();
            node.members.set(key, parse(depth + 1));
          } else node.items.push(parse(depth + 1));
          whitespace();
          if (text[position] === close) break;
          if (text[position] !== ',') fail();
          node.commas.push(position++);
          whitespace();
        }
      }
      position++;
    } else if (first === '"') node.value = string();
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(position),
      );
      if (!token) return fail();
      node.value = JSON.parse(token[0]);
      position += token[0].length;
    }
    node.end = position;
    return node;
  };
  const root = parse(0);
  whitespace();
  if (position !== text.length) fail();
  return { bytes, text, root };
}

/** @param {string} text @param {number} offset */
function location(text, offset) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\r' || text[i] === '\n') {
      if (text[i] === '\r' && text[i + 1] === '\n' && i + 1 < offset) i++;
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}
/**
 * Describe private source-preserving edits with UTF-8 offsets and UTF-16 columns.
 * @param {{bytes: Buffer, text: string}} source Previously scanned private source.
 * @param {string} path Selected path label.
 * @param {Edit[]} edits Trusted planner edits in source string coordinates.
 * @returns Private changed fragments, exact edits and before/after hashes.
 * @since v0.19.3
 */
function previewEdits(source, path, edits) {
  edits.sort((a, b) => a.start - b.start);
  let after = source.text;
  for (const edit of [...edits].reverse())
    after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
  // Validate generated output too; preview and hashes must describe parseable JSON.
  scanJson(Buffer.from(after));
  let delta = 0;
  const changedFragments = edits.map((edit) => {
    const start = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    return {
      file: path,
      startByte: Buffer.byteLength(source.text.slice(0, edit.start)),
      endByte: Buffer.byteLength(source.text.slice(0, edit.end)),
      before: { start: location(source.text, edit.start), end: location(source.text, edit.end) },
      after: { start: location(after, start), end: location(after, start + edit.text.length) },
      removed: source.text.slice(edit.start, edit.end),
      inserted: edit.text,
      contextOmitted: true,
    };
  });
  if (Buffer.byteLength(JSON.stringify(changedFragments)) > 32 * 1024)
    throw Error('PREVIEW_TOO_LARGE');
  return {
    beforeSha256: hash(source.bytes),
    afterSha256: hash(Buffer.from(after)),
    edits: changedFragments.map((fragment) => ({
      startByte: fragment.startByte,
      endByte: fragment.endByte,
      replacementUtf8: fragment.inserted,
    })),
    changedFragments,
  };
}
module.exports = { scanJson, previewEdits, LIMITS };
