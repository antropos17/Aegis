'use strict';

const semver = require('semver');
const { parseLiteralCommands, COMMAND_CHARS, COMMAND_TOKENS } = require('./static-command-parser');
const { redirectStreams } = require('./static-command-redirections');
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh']);
const POWERSHELL = new Set(['powershell', 'pwsh']);
const nameOf = (name) =>
  name
    .split(/[/\\]/)
    .at(-1)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '');
const urlArgument = (arg) => /^(?:--url=)?https?:\/\//i.test(arg);

function secretVariable(value, expanded) {
  return (
    expanded &&
    /(?:\$\{?(?:env:)?[\w]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[\w]*\}?|%[\w]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[\w]*%)/i.test(
      value,
    )
  );
}

function secretReference(value, expanded = false) {
  if (secretVariable(value, expanded)) return true;
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  const base = normalized.split('/').at(-1).replace(/^@/, '');
  if (/^\.env(?:\.[\w.-]+)?$/.test(base) && !/^\.env\.(example|sample|template|dist)$/.test(base))
    return true;
  return (
    base === '.npmrc' ||
    /(^|\/)\.aws\/credentials$/.test(normalized) ||
    /(^|\/)\.kube\/config$/.test(normalized) ||
    /(^|\/)\.ssh\/id_(rsa|ed25519|ecdsa|dsa)$/.test(normalized)
  );
}

function broadTarget(arg, expanded) {
  if (/^[$%~]/.test(arg) && !expanded) return false;
  return /^(?:\/(?:\*)?|~(?:\/\*)?|\$\{?HOME\}?(?:\/\*)?|\$env:USERPROFILE(?:[\\/]\*)?|%USERPROFILE%(?:[\\/]\*)?|[a-z]:[\\/](?:\*)?)$/i.test(
    arg,
  );
}

function curlInputs(args, expanded) {
  const inputs = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const long =
      /^--(data|data-ascii|data-raw|data-binary|data-urlencode|upload-file|form)(?:=(.*))?$/.exec(
        arg,
      );
    const short = /^-[fFsSLvVk46]*([dTF])(.*)$/.exec(arg);
    if (!long && !short) continue;
    const kind = long?.[1] ?? short[1];
    const value = (long ? long[2] : short[2]) || args[++index] || '';
    const dynamic = expanded[index];
    // --data-raw deliberately does not interpret @ as a file reference.
    if (kind === 'data-raw') {
      if (secretVariable(value, dynamic)) inputs.push({ value, dynamic });
      continue;
    }
    let file = null;
    if (kind === 'upload-file' || kind === 'T') file = value;
    else if (kind === 'form' || kind === 'F') {
      const field = value.slice(value.indexOf('=') + 1);
      if (/^[@<]/.test(field)) file = field.slice(1).split(';')[0];
    } else if (value.startsWith('@')) file = value.slice(1);
    else if (kind === 'data-urlencode' && !value.includes('=') && value.includes('@'))
      file = value.slice(value.indexOf('@') + 1);
    if (file !== null) inputs.push({ value: file, dynamic });
    else if (secretVariable(value, dynamic)) inputs.push({ value, dynamic });
  }
  return inputs;
}

function npxSelectors(args) {
  const selectors = [];
  let explicit = false;
  let localOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--no-install', '--offline'].includes(arg)) localOnly = true;
    else if (arg === '-p' || arg === '--package') {
      explicit = true;
      selectors.push(args[++index] || '');
    } else if (arg.startsWith('--package=')) {
      explicit = true;
      selectors.push(arg.slice(10));
    } else if (!arg.startsWith('-')) {
      if (!explicit) selectors.push(arg);
      break;
    } else if (!['-y', '--yes', '--quiet', '-q', '--'].includes(arg)) return null;
  }
  return localOnly ? [] : selectors;
}

const npmSelectorShape = (selector) => /^(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$/.test(selector);

function bunxSelectors(args) {
  const selectors = [];
  let explicit = false;
  let localOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--no-install') localOnly = true;
    else if (arg === '-p' || arg === '--package') {
      if (explicit || !args[index + 1] || args[index + 1].startsWith('-')) return null;
      selectors.push(args[++index]);
      explicit = true;
    } else if (arg.startsWith('--package=')) {
      if (explicit || !arg.slice(10)) return null;
      selectors.push(arg.slice(10));
      explicit = true;
    } else if (['--bun', '--verbose', '--silent'].includes(arg)) continue;
    else if (arg.startsWith('-')) return null;
    else {
      if (explicit && !/^[\w.-]+$/.test(arg)) return null;
      if (!explicit) selectors.push(arg);
      return localOnly && selectors.every(npmSelectorShape) ? [] : selectors;
    }
  }
  return explicit ? null : [];
}

function uvxSelectors(args) {
  const selectors = [];
  let from = null;
  let executable = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--from' || arg.startsWith('--from=')) {
      if (from !== null) return null;
      from = arg === '--from' ? args[++index] : arg.slice(7);
      if (!from || from.startsWith('-')) return null;
    } else if (arg === '--with' || arg.startsWith('--with=')) {
      const value = arg === '--with' ? args[++index] : arg.slice(7);
      if (!value || value.startsWith('-')) return null;
      selectors.push({ value, explicit: true });
    } else if (arg === '--python' || arg.startsWith('--python=')) {
      const value = arg === '--python' ? args[++index] : arg.slice(9);
      if (!value || value.startsWith('-')) return null;
    } else if (arg === '--lfs') continue;
    else if (arg.startsWith('-')) return null;
    else {
      executable = arg;
      break;
    }
  }
  if (!executable) return from === null && !selectors.length ? [] : null;
  if (from !== null && !/^[\w.-]+$/.test(executable)) return null;
  selectors.unshift({ value: from ?? executable, explicit: from !== null });
  return selectors;
}

const EXACT_PYTHON_VERSION =
  /^(?:\d+!)?\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?(?:\+[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/i;

function uvSelectorStatus(selector, explicit) {
  if (!explicit) {
    const match = /^([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?:@([^\s]+))?$/i.exec(selector);
    if (!match) return null;
    if (!match[2] || match[2] === 'latest') return 'non-exact';
    return EXACT_PYTHON_VERSION.test(match[2]) ? 'exact' : null;
  }
  const match =
    /^([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?:\[[a-z0-9._-]+(?:\s*,\s*[a-z0-9._-]+)*\])?\s*(.*)$/i.exec(
      selector,
    );
  if (!match) return null;
  const specifier = match[2].trim();
  if (!specifier) return 'non-exact';
  if (specifier.startsWith('==')) {
    const version = specifier.slice(2).trim();
    if (EXACT_PYTHON_VERSION.test(version)) return 'exact';
    return /^\d+(?:\.\d+)*\.\*$/.test(version) ? 'non-exact' : null;
  }
  const constraints = specifier.split(',').map((part) => part.trim());
  return constraints.every((part) => /^(?:!=|>=|<=|~=|>|<)\s*\d+(?:\.\d+)*(?:\.\*)?$/.test(part))
    ? 'non-exact'
    : null;
}

function curlOutputFile(args) {
  return args.some((arg, index) => {
    if (/^-[fFsSLvVk46]*O/.test(arg) || arg === '--remote-name') return true;
    const short = /^-[fFsSLvVk46]*o(.*)$/.exec(arg);
    if (short) return (short[1] || args[index + 1]) !== '-';
    if (arg === '--output') return args[index + 1] !== '-';
    return arg.startsWith('--output=') && arg !== '--output=-';
  });
}

function inspect(argv, depth, expanded = argv.map(() => false)) {
  const rules = new Set();
  const issues = new Set();
  argv = [...argv];
  expanded = [...expanded];
  const shift = () => {
    argv.shift();
    expanded.shift();
  };
  while (argv.length && /^[A-Za-z_][\w]*=/.test(argv[0])) shift();
  if (argv[0] === 'env' && argv.slice(1).some((arg) => /^[A-Za-z_][\w]*=/.test(arg))) {
    shift();
    while (argv.length && /^[A-Za-z_][\w]*=/.test(argv[0])) shift();
  }
  const command = nameOf(argv[0] || '');
  const args = argv.slice(1);
  const dynamic = expanded.slice(1);
  const lower = args.map((arg) => arg.toLowerCase());
  const isCurl = command === 'curl';
  const isPowerShell = POWERSHELL.has(command);
  const help = lower.some((arg) => arg === '--help' || arg === '--version');
  const outputFile = curlOutputFile(args);
  const download =
    !help &&
    args.some(urlArgument) &&
    ((isCurl && !outputFile && !args.includes('-I') && !lower.includes('--head')) ||
      (command === 'wget' &&
        args.some(
          (arg, i) =>
            /^-[a-zA-Z]*O-$/.test(arg) ||
            arg === '--output-document=-' ||
            ((/^-[a-zA-Z]*O$/.test(arg) || arg === '--output-document') && args[i + 1] === '-'),
        )) ||
      (['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'].includes(command) &&
        !lower.includes('-outfile')));
  const source =
    (['cat', 'get-content', 'gc', 'base64'].includes(command) &&
      args.some((arg, i) => secretReference(arg, dynamic[i]))) ||
    (['env', 'printenv'].includes(command) &&
      (!args.length || args.some((arg) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(arg))));
  const inputs = isCurl && args.some(urlArgument) ? curlInputs(args, dynamic) : [];
  if (inputs.some((input) => secretReference(input.value, input.dynamic))) rules.add('STA002');
  const broad = args.some((arg, i) => broadTarget(arg, dynamic[i]));
  if (
    !help &&
    ((command === 'rm' &&
      args.some((arg) => /^-[^-]*[rR]/.test(arg) || arg === '--recursive') &&
      broad) ||
      (command === 'remove-item' && lower.includes('-recurse') && broad) ||
      ((command === 'rd' || command === 'rmdir') && lower.includes('/s') && broad))
  )
    rules.add('STA003');
  if (isPowerShell && lower.some((arg) => /^-(?:e|ec|enc|encodedcommand)$/.test(arg)))
    rules.add('STA004');
  if (
    command === 'claude' &&
    (lower.includes('--dangerously-skip-permissions') ||
      lower.includes('--permission-mode=bypasspermissions') ||
      lower.some(
        (arg, index) => arg === '--permission-mode' && lower[index + 1] === 'bypasspermissions',
      ))
  )
    rules.add('STA005');
  const npmSelectors =
    command === 'npx'
      ? npxSelectors(args)
      : command === 'bunx'
        ? bunxSelectors(args)
        : command === 'bun' && args[0] === 'x'
          ? bunxSelectors(args.slice(1))
          : undefined;
  if (npmSelectors !== undefined) {
    const selectors = npmSelectors;
    if (selectors === null) issues.add('package-launch-syntax-not-resolved');
    for (const selector of selectors || []) {
      if (!npmSelectorShape(selector)) {
        issues.add('package-selector-not-resolved');
        continue;
      }
      const at = selector.lastIndexOf('@');
      if (at <= 0 || !semver.valid(selector.slice(at + 1))) rules.add('STA006');
    }
  }
  const uvSelectors =
    command === 'uvx'
      ? uvxSelectors(args)
      : command === 'uv' && args[0] === 'tool' && args[1] === 'run'
        ? uvxSelectors(args.slice(2))
        : undefined;
  if (uvSelectors !== undefined) {
    if (uvSelectors === null) issues.add('package-launch-syntax-not-resolved');
    for (const selector of uvSelectors || []) {
      // uvx reserves this direct form for a Python interpreter, not a PyPI package.
      if (!selector.explicit && /^python(?:@|$)/i.test(selector.value)) {
        issues.add('package-launch-syntax-not-resolved');
        continue;
      }
      const status = uvSelectorStatus(selector.value, selector.explicit);
      if (status === null) issues.add('package-selector-not-resolved');
      else if (status === 'non-exact') rules.add('STA006');
    }
  } else if (
    command === 'uv' &&
    args[0]?.startsWith('-') &&
    args.some((arg, index) => arg === 'tool' && args[index + 1] === 'run')
  )
    issues.add('package-launch-syntax-not-resolved');
  if (command === 'bun' && args[0]?.startsWith('-') && args.includes('x'))
    issues.add('package-launch-syntax-not-resolved');
  if (SHELLS.has(command) || isPowerShell || command === 'cmd') {
    const flag = lower.findIndex((arg) => ['-c', '-command', '/c'].includes(arg));
    if (flag !== -1 && args[flag + 1] !== '-') {
      if (depth >= 3) issues.add('command-depth-limit');
      else if (args.length !== flag + 2) issues.add('shell-wrapper-not-resolved');
      else {
        const nested = analyzeCommand(args[flag + 1], depth + 1);
        nested.rules.forEach((rule) => rules.add(rule));
        nested.issues.forEach((issue) => issues.add(issue));
      }
    } else if (
      args.some((arg) => !arg.startsWith('-') && /\.(?:sh|bash|zsh|ps1|cmd|bat)$/i.test(arg))
    )
      issues.add('referenced-code-not-analyzed');
  } else if (
    ['node', 'nodejs', 'python', 'python3', 'ruby', 'perl'].includes(command) &&
    args.length
  )
    issues.add('referenced-code-not-analyzed');
  if (
    ['eval', 'sudo', 'doas', 'timeout', 'nohup', 'exec', 'command', 'call', 'start'].includes(
      command,
    )
  )
    issues.add('command-wrapper-not-resolved');
  if (/[$%^]/.test(argv[0] || '')) issues.add('dynamic-command-not-resolved');
  const syntaxOnly = args.some((arg) => /^-[a-z]*n[a-z]*$/.test(arg));
  const readsShellInput =
    SHELLS.has(command) &&
    !help &&
    args.every((arg) => /^-(?:[a-z]+)?$/.test(arg)) &&
    !lower.includes('-c');
  const stdinShell = readsShellInput && !syntaxOnly;
  const stdinPowerShell =
    isPowerShell &&
    (!args.length ||
      lower.some((arg, i) => ['-command', '-file'].includes(arg) && args[i + 1] === '-'));
  const executeInput =
    stdinShell || stdinPowerShell || ['iex', 'invoke-expression'].includes(command);
  const passthrough =
    !help &&
    (command === 'tee' ||
      (['cat', 'base64'].includes(command) && args.every((arg) => arg.startsWith('-'))));
  return {
    rules,
    issues,
    download,
    source,
    executeInput,
    readsCodeInput:
      readsShellInput || stdinPowerShell || ['iex', 'invoke-expression'].includes(command),
    passthrough,
    uploadInput: inputs.some((input) => input.value === '-'),
  };
}

/**
 * Inspect a bounded literal command subset without execution, expansion or raw output.
 * @param {string} text Untrusted shell command.
 * @param {number} [depth] Internal wrapper recursion depth.
 * @returns {object} Fixed rule IDs and coverage issue codes.
 * @since v0.15.1
 */
function analyzeCommand(text, depth = 0) {
  const parsed = parseLiteralCommands(text);
  if (
    parsed.issues.some((issue) =>
      ['multiline-shell-not-analyzed', 'unclosed-command-quote'].includes(issue),
    )
  )
    return { rules: [], issues: parsed.issues };
  const rules = new Set();
  const issues = new Set(parsed.issues);
  let download = false;
  let secret = false;
  for (const segment of parsed.segments) {
    const streams = redirectStreams(segment, { download, secret }, secretReference);
    streams.issues.forEach((issue) => issues.add(issue));
    const result = inspect(segment.argv, depth, segment.expanded);
    result.rules.forEach((rule) => rules.add(rule));
    result.issues.forEach((issue) => issues.add(issue));
    if (streams.input.download && result.executeInput) rules.add('STA001');
    if (streams.input.secret && result.uploadInput) rules.add('STA002');
    if (streams.inputFile && result.readsCodeInput) issues.add('referenced-code-not-analyzed');
    download =
      streams.outputPipe && (result.download || (streams.input.download && result.passthrough));
    secret = streams.outputPipe && (result.source || (streams.input.secret && result.passthrough));
  }
  return { rules: [...rules].sort(), issues: [...issues].sort() };
}

/** Inspect a process argv without treating argument strings as shell syntax. @param {string} command @param {string[]} args @returns {object} Fixed rule and issue codes. @since v0.15.1 */
function analyzeInvocation(command, args) {
  if (
    typeof command !== 'string' ||
    !command ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== 'string')
  )
    return { rules: [], issues: ['invalid-command-shape'] };
  if (
    args.length >= COMMAND_TOKENS ||
    command.length + args.reduce((sum, arg) => sum + arg.length, 0) > COMMAND_CHARS
  )
    return { rules: [], issues: ['command-size-limit'] };
  const result = inspect([command, ...args], 0);
  return { rules: [...result.rules].sort(), issues: [...result.issues].sort() };
}

module.exports = { analyzeCommand, analyzeInvocation };
