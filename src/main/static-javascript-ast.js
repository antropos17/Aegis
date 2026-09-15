'use strict';

const acorn = require('acorn');
const JAVASCRIPT_LIMITS = Object.freeze({
  javascriptChars: 65536,
  javascriptTokens: 8192,
  javascriptNodes: 8192,
  javascriptDepth: 64,
});

/** Parse bounded JavaScript without evaluating it. @param {string} text Source bytes decoded as UTF-8. @param {string} name Relative filename. @returns {object} Syntax tree or fixed issue. @since v0.15.1 */
function parseJavaScript(text, name) {
  if (text.length > JAVASCRIPT_LIMITS.javascriptChars) return { issue: 'javascript-size-limit' };
  const modes = /\.mjs$/i.test(name)
    ? ['module']
    : /\.cjs$/i.test(name)
      ? ['commonjs']
      : ['commonjs', 'module'];
  for (const mode of modes) {
    let tokens = 0;
    let depth = 0;
    let limit = false;
    try {
      const ast = acorn.parse(text, {
        ecmaVersion: 2024,
        sourceType: mode,
        locations: true,
        allowHashBang: true,
        onToken(token) {
          tokens++;
          if (['(', '[', '{', '${'].includes(token.type.label)) depth++;
          if ([')', ']', '}'].includes(token.type.label)) depth--;
          if (
            tokens > JAVASCRIPT_LIMITS.javascriptTokens ||
            depth > JAVASCRIPT_LIMITS.javascriptDepth
          ) {
            limit = true;
            throw new Error('javascript-parser-limit');
          }
        },
      });
      const stack = [[ast, 0]];
      let nodes = 0;
      while (stack.length) {
        const [node, level] = stack.pop();
        if (
          ++nodes > JAVASCRIPT_LIMITS.javascriptNodes ||
          level > JAVASCRIPT_LIMITS.javascriptDepth
        )
          return { issue: 'javascript-ast-limit' };
        for (const value of Object.values(node)) {
          for (const child of Array.isArray(value) ? value : [value])
            if (child && typeof child.type === 'string') stack.push([child, level + 1]);
        }
      }
      return { ast, mode };
    } catch (error) {
      if (limit || error instanceof RangeError) return { issue: 'javascript-parser-limit' };
    }
  }
  return { issue: 'javascript-parse-failed' };
}

module.exports = { parseJavaScript, JAVASCRIPT_LIMITS };
