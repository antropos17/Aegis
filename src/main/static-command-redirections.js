'use strict';

const { posix } = require('path');
const EMPTY = Object.freeze({ download: false, secret: false });
const unknown = () => ({ kind: 'unknown', direction: null, payload: EMPTY, file: false });

function fileEndpoint(target, direction, secretReference, issues) {
  if (target === '/dev/null') return { kind: 'discard', direction, payload: EMPTY, file: false };
  if (!target || /^\/(?:dev|proc)(?:\/|$)/.test(posix.normalize(target))) {
    issues.add('shell-redirection-target-not-resolved');
    return { ...unknown(), file: direction === 'input' };
  }
  return {
    kind: 'file',
    direction,
    payload: { download: false, secret: direction === 'input' && secretReference(target) },
    file: direction === 'input',
  };
}

/**
 * Associate FD 0/1/2 with bounded literal pipeline endpoints without reading files.
 * Pipe endpoints exist before redirects; descriptor copies retain their current endpoint.
 * @param {object} segment Parsed argv and ordered redirections.
 * @param {object} incoming Known tags from the preceding pipeline stage.
 * @param {function} secretReference Existing sensitive-path classifier.
 * @returns {object} Input tags, stdout destination and fixed coverage issues.
 * @since v0.15.1
 */
function redirectStreams(segment, incoming, secretReference) {
  const issues = new Set();
  const descriptors = [
    { kind: 'input', direction: 'input', payload: incoming, file: false },
    { kind: segment.separator === '|' ? 'pipe' : 'output', direction: 'output', payload: EMPTY },
    { kind: 'stderr', direction: 'output', payload: EMPTY },
  ];
  for (const redirection of segment.redirections || []) {
    issues.add('shell-redirection-dialect-not-verified');
    const { fd, operator, target, expanded } = redirection;
    if (!Number.isInteger(fd) || fd < 0 || fd > 2) {
      issues.add('shell-redirection-descriptor-not-resolved');
      descriptors.fill(unknown());
      continue;
    }
    const direction = operator.startsWith('<') ? 'input' : 'output';
    const duplicate = operator === '<&' || operator === '>&';
    if ((direction === 'input') !== (fd === 0)) {
      issues.add('shell-redirection-direction-not-resolved');
      if (duplicate) descriptors.fill(unknown());
      else descriptors[fd] = unknown();
      continue;
    }
    if (expanded) {
      issues.add('shell-redirection-target-not-resolved');
      if (duplicate) descriptors.fill(unknown());
      else descriptors[fd] = unknown();
      continue;
    }
    if (duplicate) {
      if (target === '-') {
        descriptors[fd] = { kind: 'closed', direction, payload: EMPTY, file: false };
      } else if (/^[012]$/.test(target) && descriptors[Number(target)].direction === direction) {
        descriptors[fd] = descriptors[Number(target)];
      } else {
        issues.add('shell-redirection-descriptor-not-resolved');
        // Unknown duplication syntax can move and close a different descriptor.
        descriptors.fill(unknown());
      }
    } else if (['<', '>', '>>'].includes(operator)) {
      descriptors[fd] = fileEndpoint(target, direction, secretReference, issues);
    } else {
      issues.add('shell-redirection-operator-not-resolved');
      descriptors[fd] = unknown();
    }
  }
  return {
    input: descriptors[0].payload,
    inputFile: descriptors[0].file,
    outputPipe: descriptors[1].kind === 'pipe',
    issues: [...issues],
  };
}

module.exports = { redirectStreams };
