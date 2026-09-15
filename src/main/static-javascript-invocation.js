'use strict';

const { analyzeCommand, analyzeInvocation } = require('./static-command-analysis');
const { UNKNOWN } = require('./static-javascript-values');
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'cmd', 'powershell', 'pwsh']);
const failure = (reason) => ({ rules: [], issues: [reason] });
const callback = (value) => value?.kind === 'local-function';

function shellOption(options, defaultShell) {
  if (options === null) return { enabled: defaultShell, issues: [] };
  if (!(options instanceof Map)) return { issue: 'javascript-options-not-resolved' };
  const issues = [...options.keys()].some((key) => key !== 'shell')
    ? ['javascript-process-options-not-analyzed']
    : [];
  if (!options.has('shell')) return { enabled: defaultShell, issues };
  const shell = options.get('shell');
  if (!defaultShell && typeof shell === 'boolean') return { enabled: shell, issues };
  if (
    typeof shell !== 'string' ||
    !SHELLS.has(
      shell
        .split(/[/\\]/)
        .at(-1)
        .toLowerCase()
        .replace(/\.exe$/, ''),
    )
  )
    return { issue: 'javascript-shell-not-resolved' };
  return { enabled: true, issues };
}

/** Preserve Node process-call argv/shell boundaries for known literal inputs. @param {string} method @param {object} node @param {function} read Bounded static value reader. @returns {object} Fixed rule and issue codes. @since v0.15.1 */
function inspectJavaScriptInvocation(method, node, read) {
  if (node.optional || node.arguments.some((arg) => arg.type === 'SpreadElement'))
    return failure('javascript-call-not-analyzed');
  if (method === 'fork') return failure('referenced-code-not-analyzed');
  const args = node.arguments;
  const command = read(args[0]);
  if (typeof command !== 'string') return failure('javascript-command-not-resolved');
  const exec = method === 'exec' || method === 'execSync';
  const asyncCallback = method === 'exec' || method === 'execFile';
  let tail = args.slice(1).map((argument) => read(argument));
  if (asyncCallback && tail.length && callback(tail.at(-1))) tail = tail.slice(0, -1);
  let argv = [];
  if (!exec && args[1]?.type === 'ArrayExpression' && tail[0] === UNKNOWN)
    return failure('javascript-argv-not-resolved');
  if (!exec && Array.isArray(tail[0])) argv = tail.shift();
  if (tail.length > 1) return failure('javascript-call-not-analyzed');
  if (argv.some((arg) => typeof arg !== 'string')) return failure('javascript-argv-not-resolved');
  if (command.includes('\0') || argv.some((arg) => arg.includes('\0')))
    return failure('invalid-command-shape');
  const options = tail.length ? tail[0] : null;
  if (options === UNKNOWN) return failure('javascript-options-not-resolved');
  const shell = shellOption(options, exec);
  if (shell.issue) return failure(shell.issue);
  const result = shell.enabled
    ? analyzeCommand([command, ...argv].join(' '))
    : analyzeInvocation(command, argv);
  return { rules: result.rules, issues: [...result.issues, ...shell.issues] };
}

module.exports = { inspectJavaScriptInvocation };
