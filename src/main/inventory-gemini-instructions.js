'use strict';

/** @file Bounded selected-settings Gemini instruction candidates. */
const { parseInventoryConfig } = require('./inventory-config');

const CANDIDATE_LIMIT = 8;
const BASENAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\.(?:md|txt)$/i;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Gather bounded basename candidates from the selected settings file only.
 * Names remain internal until a candidate is actually observed as an inventory file.
 * @param {object} profile Built-in layout.
 * @param {object} reader Shared bounded filesystem reader.
 * @returns {object} Config observer and candidate visitor.
 * @since v0.15.1
 */
function createGeminiInstructionSelection(profile, reader) {
  const selection = profile.geminiInstructions;
  const candidates = [];
  const issue = (reason) => reader.issues.push({ path: selection.settings, reason });

  function observeConfig(name, file) {
    if (!selection || name !== selection.settings) return;
    const parsed = parseInventoryConfig(file.data, 'json-comments');
    if (parsed.parseStatus !== 'parsed') return; // The regular config consumer reports this.
    const config = parsed.value;
    if (!Object.hasOwn(config, 'context')) return;
    if (!record(config.context)) return issue('gemini-instruction-invalid-shape');
    if (!Object.hasOwn(config.context, 'fileName')) return;
    const value = config.context.fileName;
    const names = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(names) || !names.every((item) => typeof item === 'string')) {
      return issue('gemini-instruction-invalid-shape');
    }
    if (names.length > CANDIDATE_LIMIT) issue('gemini-instruction-count-limit');
    const used = new Set();
    for (const name of names.slice(0, CANDIDATE_LIMIT)) {
      if (!BASENAME.test(name) || WINDOWS_DEVICE.test(name)) {
        issue('gemini-instruction-unsupported-name');
        continue;
      }
      const relative = selection.directory ? `${selection.directory}/${name}` : name;
      const folded = relative.toLowerCase();
      if (used.has(folded)) {
        issue('gemini-instruction-duplicate-name');
        continue;
      }
      used.add(folded);
      const existing = profile.instructions.find((entry) => entry.path.toLowerCase() === folded);
      if (existing && (existing.path !== relative || existing.agent !== 'gemini-cli')) {
        issue('gemini-instruction-collision');
        continue;
      }
      candidates.push(relative);
    }
  }

  async function visit(hasSeen, onFile) {
    if (!selection) return;
    for (const name of candidates) {
      if (hasSeen(name) || reader.isStopped()) continue;
      const before = reader.issues.length;
      let observed = false;
      await reader.visit(name, (path, file) => {
        observed = true;
        onFile(path, file, {
          kind: 'instruction',
          agent: 'gemini-cli',
          scope: selection.scope,
          configuredInstruction: true,
        });
      });
      if (!observed && reader.issues.length === before && !reader.isStopped()) {
        issue('gemini-instruction-unavailable');
      }
    }
  }
  return { observeConfig, visit };
}

module.exports = { createGeminiInstructionSelection, CANDIDATE_LIMIT };
