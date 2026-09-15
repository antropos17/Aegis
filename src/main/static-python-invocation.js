'use strict';

const { analyzeCommand, analyzeInvocation } = require('./static-command-analysis');
const { UNKNOWN } = require('./static-python-values');
const { commaGroups } = require('./static-python-tree');
const failure = (reason) => ({ rules: [], issues: [reason] });

/** Keep Python sequence and shell semantics distinct. @param {string} method @param {object} node @param {function} read @param {function} source @returns {object} Fixed rules and coverage issues. @since v0.15.1 */
function inspectPythonInvocation(method, node, read, source) {
  const argList = node.children[1];
  if (argList?.type !== 'ArgList') return failure('python-call-not-analyzed');
  const positional = [];
  const keywords = new Map();
  for (const group of commaGroups(argList.children.slice(1, -1))) {
    if (group.length === 1 && !keywords.size) positional.push(read(group[0]));
    else if (
      group.length === 3 &&
      group[0].type === 'VariableName' &&
      source(group[1]) === '=' &&
      !keywords.has(source(group[0]).normalize('NFKC'))
    )
      keywords.set(source(group[0]).normalize('NFKC'), read(group[2]));
    else return failure('python-call-arguments-not-resolved');
  }
  const implicitShell = [
    'os.system',
    'os.popen',
    'subprocess.getoutput',
    'subprocess.getstatusoutput',
  ].includes(method);
  const commandKey = implicitShell ? 'cmd' : 'args';
  if (positional.length > 1 || (positional.length && keywords.has(commandKey)))
    return failure('python-call-arguments-not-resolved');
  if (implicitShell && keywords.has('shell')) return failure('python-call-arguments-not-resolved');
  if (method === 'os.system' && keywords.size) return failure('python-call-arguments-not-resolved');
  if (keywords.has('executable')) return failure('python-executable-override-not-resolved');
  const command = positional.length ? positional[0] : keywords.get(commandKey);
  const shell = implicitShell || (keywords.has('shell') ? keywords.get('shell') : false);
  if (typeof shell !== 'boolean') return failure('python-shell-not-resolved');
  if (command === UNKNOWN || (!Array.isArray(command) && typeof command !== 'string'))
    return failure('python-command-not-resolved');
  if (Array.isArray(command) && shell) return failure('python-shell-sequence-not-resolved');
  if (Array.isArray(command) && (!command.length || command.some((arg) => typeof arg !== 'string')))
    return failure('python-argv-not-resolved');
  if ((Array.isArray(command) ? command : [command]).some((arg) => arg.includes('\0')))
    return failure('invalid-command-shape');
  if (!shell && typeof command === 'string' && /\s/.test(command))
    return failure('python-command-string-not-resolved');
  const result = shell
    ? analyzeCommand(command)
    : Array.isArray(command)
      ? analyzeInvocation(command[0], command.slice(1))
      : analyzeInvocation(command, []);
  const extra = [...keywords.keys()].some((key) => ![commandKey, 'shell'].includes(key));
  return {
    rules: result.rules,
    issues: [...result.issues, ...(extra ? ['python-process-options-not-analyzed'] : [])],
  };
}

module.exports = { inspectPythonInvocation };
