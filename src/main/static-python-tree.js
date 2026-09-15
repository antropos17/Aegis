'use strict';

const { parser } = require('@lezer/python');
const strictParser = parser.configure({ strict: true });
const PYTHON_LIMITS = Object.freeze({
  pythonChars: 65536,
  pythonParseSteps: 8192,
  pythonNodes: 8192,
  pythonDepth: 64,
});

/** Parse a bounded Python syntax tree without a Python interpreter. @param {string} text @returns {object} Tree and source accessors or a fixed issue. @since v0.15.1 */
function parsePython(text) {
  if (text.length > PYTHON_LIMITS.pythonChars) return { issue: 'python-size-limit' };
  for (const line of text.split(/\r\n|\n|\r/, 2)) {
    if (!/^\s*(?:#|$)/.test(line)) break;
    const encoding = /^\s*#.*?coding[=:]\s*([-\w.]+)/.exec(line)?.[1];
    if (encoding && !/^(?:utf-8|utf8)$/i.test(encoding.replaceAll('_', '-')))
      return { issue: 'python-source-encoding-not-supported' };
  }
  const nodes = [];
  let issue = 'python-parse-failed';
  try {
    const parsing = strictParser.startParse(text);
    let tree;
    for (let step = 0; step < PYTHON_LIMITS.pythonParseSteps; step++) {
      tree = parsing.advance();
      if (tree) break;
    }
    if (!tree) return { issue: 'python-parser-limit' };
    function copy(node, depth) {
      if (depth > PYTHON_LIMITS.pythonDepth || nodes.length >= PYTHON_LIMITS.pythonNodes) {
        issue = 'python-tree-limit';
        throw new Error(issue);
      }
      if (node.type.isError) throw new Error('python-parse-failed');
      const result = { type: node.name, from: node.from, to: node.to, children: [] };
      nodes.push(result);
      for (let child = node.firstChild; child; child = child.nextSibling)
        result.children.push(copy(child, depth + 1));
      return result;
    }
    const root = copy(tree.topNode, 0);
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\r' && text[i + 1] === '\n') i++;
      if (text[i] === '\n' || text[i] === '\r') starts.push(i + 1);
    }
    const lineAt = (position) => {
      let low = 0,
        high = starts.length;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (starts[mid] <= position) low = mid;
        else high = mid;
      }
      return low + 1;
    };
    const source = (node) => text.slice(node.from, node.to);
    return { root, nodes, source, identifier: (node) => source(node).normalize('NFKC'), lineAt };
  } catch (_) {
    return { issue };
  }
}

/** Split direct syntax children at commas, preserving nested expressions. @param {object[]} children @returns {object[][]} Argument groups. @since v0.15.1 */
function commaGroups(children) {
  const groups = [[]];
  for (const child of children) {
    if (child.type === 'Comment') continue;
    if (child.type === ',') groups.push([]);
    else groups.at(-1).push(child);
  }
  if (!groups.at(-1).length) groups.pop();
  return groups;
}

module.exports = { parsePython, PYTHON_LIMITS, commaGroups };
