'use strict';

const { createSessionContextReader } = require('./session-context-reader');
const { createWindowsSessionContextIO } = require('./session-context-windows-io');
const { failure, privateMode } = require('./session-context-windows-assets');
const { exact } = require('./claude-hook-windows-io-wire');

/** Wrap the existing reader with a synchronous owner parser closure barrier.
 * Each instance allows one complete or JSONL-tail read. No discovery/startup caller exists.
 * @param {object} options Actual owner adapter, fixed assets and bounded limits.
 * @returns {{read:Function,readTail:Function}} Single-use metadata read preserving exact owner result.
 * @since v0.19.3 */
function createWindowsSessionContextReader(options) {
  privateMode();
  if (
    !exact(options, ['adapter', 'assets', 'requestMs', 'sessionMs', 'cleanupMs']) ||
    typeof options.adapter?.parse !== 'function'
  )
    throw failure();
  const owner = options.adapter;
  const parse = owner.parse;
  const io = createWindowsSessionContextIO({
    assets: options.assets,
    requestMs: options.requestMs,
    sessionMs: options.sessionMs,
    cleanupMs: options.cleanupMs,
  });
  let used = false;
  const adapter = {
    parse(source, bytes, selection) {
      privateMode();
      if (!io.status().closed) throw failure();
      const result = parse.call(owner, source, bytes, selection);
      if (!result || typeof result !== 'object' || typeof result.then === 'function')
        throw failure();
      return result;
    },
  };
  const reader = createSessionContextReader({ files: io.files, adapter });
  const tailReader = createSessionContextReader({ files: io.tailFiles, adapter });
  async function readSelected(source, file, selection, tail) {
    let result;
    try {
      privateMode();
      if (used) throw failure();
      used = true;
      result = await (tail
        ? tailReader.readTail(source, file, selection)
        : reader.read(source, file, selection));
    } catch {
      throw failure();
    } finally {
      await io.close();
    }
    if (!io.status().closed) throw failure();
    return result;
  }
  return Object.freeze({
    read: (source, file, selection) => readSelected(source, file, selection, false),
    readTail: (source, file, selection) => readSelected(source, file, selection, true),
  });
}

module.exports = { createWindowsSessionContextReader };
