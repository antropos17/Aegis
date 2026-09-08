/**
 * @file skill-path.js
 * @description Skill identity from an observed file path, without reading contents.
 * @since 0.15.0
 */
'use strict';

/**
 * Recognize a SKILL.md entry point, a skills/<name> root or a file under it (including
 * skills/.system/<name>/). The folder is a path-derived name, not a parsed manifest
 * title. This never identifies the process that accessed it or proves execution.
 * @param {unknown} filePath
 * @returns {{name: string, rootPath: string, relativePath: string}|null}
 * @since 0.15.0
 */
function skillFromPath(filePath) {
  // eslint-disable-next-line no-control-regex -- Reject control characters in observed path labels.
  if (typeof filePath !== 'string' || !filePath || /[\x00-\x1f]/.test(filePath)) return null;
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  if (parts.some((p) => p === '..' || p === '.')) return null;
  let rootIndex = -1;
  if (parts.at(-1)?.toLowerCase() === 'skill.md') {
    rootIndex = parts.length - 2;
  } else {
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i].toLowerCase() !== 'skills') continue;
      const candidate = parts[i + 1] === '.system' ? i + 2 : i + 1;
      if (candidate < parts.length) {
        rootIndex = candidate;
        break;
      }
    }
  }
  const name = parts[rootIndex];
  if (!name || name.startsWith('.') || /^(?:skills|[a-z]:)$/i.test(name)) return null;
  const relativePath = parts.slice(rootIndex + 1).join('/');
  if (!parts.at(-1)) return null;
  return { name, rootPath: parts.slice(0, rootIndex + 1).join('/'), relativePath };
}

module.exports = { skillFromPath };
