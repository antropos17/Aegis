'use strict';

const INSTRUCTION_LIMITS = Object.freeze({
  instructionChars: 65536,
  instructionLines: 2048,
  instructionClauseChars: 512,
  instructionClauseLines: 4,
  instructionFindings: 64,
});
const SIGNALS = Object.freeze({
  STA012: 'prior-instruction-override',
  STA013: 'sensitive-data-transfer',
  STA014: 'consent-bypass',
  STA015: 'action-concealment',
});
const AUDIENCE = /\b(?:users?|operators?|humans?)\b/i;
const CONSENT_OBJECT =
  /^(?:(?:the|all|any|users?'?s?|human|operator|explicit|prior|for)\s+){0,6}(?:approval|consent|confirmation|permissions?)\b/i;

function directive(text) {
  let value = text.trim().replace(/^(?:instead|then|now)\s+/i, '');
  for (let index = 0; index < 2; index++)
    value = value.replace(
      /^(?:please,?|you\s+(?:must|should|need\s+to|have\s+to|are\s+required\s+to))\s+/i,
      '',
    );
  return value;
}

function actionObject(text) {
  const action =
    /^(?:(?:this|these|the|your|our|all)\s+){0,3}(?:actions?|activities|activity|operations?|executions?|transfers?|uploads?|commands?|tool\s+calls?)\b/i.exec(
      text,
    );
  return Boolean(
    action &&
    !/^\s+(?:progress|status|indicators?|spinners?|buttons?|icons?|labels?|names?|examples?|dialogs?|modals?|windows?)\b/i.test(
      text.slice(action[0].length),
    ),
  );
}

function consentObject(text) {
  const consent = CONSENT_OBJECT.exec(text);
  return Boolean(
    consent &&
    !/^\s+(?:notifications?|alerts?|logs?|labels?|documentation|examples?|tests?|summaries|reports?|questions?)\b/i.test(
      text.slice(consent[0].length),
    ),
  );
}

function concealedAction(value, negative) {
  if (!AUDIENCE.test(value)) return false;
  if (negative) {
    const audienceFirst =
      /^(?:tell|inform|notify)\s+(?:the\s+)?(?:users?|operators?|humans?)\s+/i.exec(value);
    if (audienceFirst) {
      const tail = value.slice(audienceFirst[0].length);
      return /^(?:about|of)\s+/i.test(tail)
        ? actionObject(tail.replace(/^(?:about|of)\s+/i, ''))
        : /^(?:that\s+)?(?:you|we)\s+(?:sent|uploaded|executed|transferred|ran)\b/i.test(tail);
    }
    const objectFirst = /^(?:show|reveal|mention|report|disclose)\s+/i.exec(value);
    return Boolean(
      objectFirst &&
      actionObject(value.slice(objectFirst[0].length)) &&
      /\bto\s+(?:the\s+)?(?:users?|operators?|humans?)\b/i.test(value),
    );
  }
  const verb = /^(?:hide|conceal|withhold|omit|suppress|keep)\s+/i.exec(value);
  return Boolean(
    verb &&
    actionObject(value.slice(verb[0].length)) &&
    /\bfrom\s+(?:the\s+)?(?:users?|operators?|humans?)\b/i.test(value) &&
    (!/^keep\b/i.test(value) || /\b(?:hidden|secret)\b/i.test(value)),
  );
}

function transfer(value) {
  const verb = /^(?:send|upload|transmit|post|forward|exfiltrate|share|email)\s+/i.exec(value);
  if (!verb) return false;
  let object = value.slice(verb[0].length);
  const modifiers = /^(?:(?:the|all|any|your|our|local|stored|saved|raw|production)\s+){0,4}/i;
  object = object
    .replace(modifiers, '')
    .replace(/^(?:contents?|values)\s+(?:of|from)\s+/i, '')
    .replace(modifiers, '');
  const path = /^(?:["'`])?([^\s"'`]+)(?:["'`])?/.exec(object);
  const name = path?.[1].replaceAll('\\', '/').toLowerCase();
  const base = name?.split('/').at(-1);
  const secretFile = Boolean(
    base &&
    ((/^\.env(?:\.[\w.-]+)?$/.test(base) &&
      !/^\.env\.(?:example|sample|template|dist)$/.test(base)) ||
      base === '.npmrc' ||
      /(?:^|\/)\.aws\/credentials$/.test(name) ||
      /(?:^|\/)\.kube\/config$/.test(name) ||
      /(?:^|\/)\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)$/.test(name)),
  );
  const sensitive =
    /^(?:api\s+keys?|(?:access|auth|bearer|api|secret)\s+tokens?|tokens?|credentials?|passwords?|private\s+keys?|secrets?)\b/i.exec(
      object,
    );
  if (!secretFile && !sensitive) return false;
  const tail = object.slice(secretFile ? path[0].length : sensitive[0].length);
  if (
    /^\s+(?:names?|labels?|identifiers?|documentation|examples?|placeholders?|fingerprints?|hashes|checksums?)\b/i.test(
      tail,
    )
  )
    return false;
  return /\b(?:to|via|into|at)\s+\S+/i.test(tail);
}

function signals(text) {
  const value = directive(text);
  const negative = /^(?:do\s+not|don't|never|not)\s+/i.test(value);
  const result = [];
  if (!negative) {
    if (
      /^(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your)\s+){0,2}(?:(?:previous|prior|earlier|above|system|developer|higher[- ]priority)\s+){1,3}(?:instructions?|rules?|messages?|prompts?)\b/i.test(
        value,
      )
    )
      result.push('STA012');
    if (transfer(value)) result.push('STA013');
    const bypass = /^(?:bypass|skip|disable|ignore|avoid)\s+/i.exec(value);
    const without = /\bwithout\s+(?:(?:asking|requesting|seeking|waiting)\s+)?/i.exec(value);
    if (
      (bypass && consentObject(value.slice(bypass[0].length))) ||
      (/^(?:run|execute|invoke|use|perform|proceed|continue)\b/i.test(value) &&
        without &&
        consentObject(value.slice(without.index + without[0].length)))
    )
      result.push('STA014');
    if (concealedAction(value, false)) result.push('STA015');
  } else {
    const body = value.replace(/^(?:do\s+not|don't|never|not)\s+/i, '');
    const ask = /^(?:ask|request|seek|wait)\s+/i.exec(body);
    if (ask && consentObject(body.slice(ask[0].length))) result.push('STA014');
    if (concealedAction(body, true)) result.push('STA015');
  }
  return result;
}

/** Inspect bounded English instruction patterns without execution or raw evidence. @param {string} text Untrusted text. @returns {object} Fixed findings and coverage issues. @since v0.15.1 */
function analyzeInstructions(text) {
  if (typeof text !== 'string') return { findings: [], issues: ['invalid-instruction-shape'] };
  const findings = [];
  const issues = new Set(text ? ['instruction-semantics-not-analyzed'] : []);
  const result = () => ({ findings, issues: [...issues].sort() });
  if (text.length > INSTRUCTION_LIMITS.instructionChars) {
    issues.add('instruction-size-limit');
    return result();
  }
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > INSTRUCTION_LIMITS.instructionLines) {
    issues.add('instruction-line-limit');
    return result();
  }
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code > 127) issues.add('instruction-language-not-analyzed');
    if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 8203 && code <= 8207))
      issues.add('instruction-obfuscated-text-not-analyzed');
  }
  if (
    /\\u[0-9a-f]{4}|&#(?:\d+|x[0-9a-f]+);|(?:%[0-9a-f]{2}){2}|\b[A-Za-z0-9+/]{40,}={0,2}/i.test(
      text,
    )
  )
    issues.add('instruction-obfuscated-text-not-analyzed');
  let clause = '';
  let firstLine = 0;
  let lastLine = 0;
  let clauseLines = 0;
  let overflow = false;
  let quote = null;
  let fence = null;
  const seen = new Set();
  function flush() {
    const value = clause.trim();
    if (overflow) issues.add('instruction-clause-limit');
    else if (value) {
      if (quote || /^(?:"[\s\S]*"|'[\s\S]*'|`[\s\S]*`)$/.test(value)) {
        issues.add('instruction-quoted-context-not-analyzed');
      } else {
        for (const ruleId of signals(value)) {
          const key = `${firstLine}:${ruleId}`;
          if (seen.has(key)) continue;
          if (findings.length >= INSTRUCTION_LIMITS.instructionFindings) {
            issues.add('instruction-finding-limit');
            break;
          }
          seen.add(key);
          findings.push({
            ruleId,
            line: firstLine,
            context: 'instruction-text',
            instruction: { signal: SIGNALS[ruleId] },
          });
        }
      }
    }
    clause = '';
    firstLine = lastLine = clauseLines = 0;
    overflow = false;
    quote = null;
  }
  function append(character, line) {
    if (!firstLine && !/\s/.test(character)) firstLine = line;
    if (firstLine && lastLine !== line) {
      lastLine = line;
      clauseLines++;
    }
    if (
      clause.length >= INSTRUCTION_LIMITS.instructionClauseChars ||
      clauseLines > INSTRUCTION_LIMITS.instructionClauseLines
    )
      overflow = true;
    else clause += character;
  }
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].trim();
    const delimiter = /^(?:`{3,}|~{3,})/.exec(line);
    if (delimiter) {
      flush();
      issues.add('instruction-code-block-not-analyzed');
      if (!fence) fence = delimiter[0];
      else if (
        delimiter[0][0] === fence[0] &&
        delimiter[0].length >= fence.length &&
        !line.slice(delimiter[0].length).trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    if (!line || /^(?:={3,}|-{3,})$/.test(line)) {
      flush();
      continue;
    }
    if (/^>/.test(line)) {
      flush();
      issues.add('instruction-quoted-context-not-analyzed');
      continue;
    }
    const heading = /^#{1,6}(?:\s+|$)/.test(line);
    const bullet = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
    const boundary = heading || bullet.test(line);
    line = line.replace(/^#{1,6}\s+/, '').replace(bullet, '');
    if (boundary) flush();
    if (clause) append(' ', index + 1);
    for (let position = 0; position < line.length; position++) {
      const character = line[position];
      const apostrophe =
        character === "'" &&
        /[A-Za-z]/.test(line[position - 1] || '') &&
        /[A-Za-z]/.test(line[position + 1] || '');
      if ('"\'`'.includes(character) && !apostrophe && line[position - 1] !== '\\') {
        if (quote === character) quote = null;
        else if (!quote) quote = character;
      }
      if (
        !quote &&
        (character === ';' ||
          ('.!?'.includes(character) && (!line[position + 1] || /\s/.test(line[position + 1]))))
      )
        flush();
      else append(character, index + 1);
    }
    if (heading) flush();
  }
  flush();
  return result();
}

module.exports = { analyzeInstructions, INSTRUCTION_LIMITS };
