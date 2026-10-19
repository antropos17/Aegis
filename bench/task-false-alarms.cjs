#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { evaluateTaskFalseAlarms, LIMITS } = require('./lib/task-false-alarms.js');
const HELP = `Offline task false-alarm incidence (no collection or task execution).
Usage: node bench/task-false-alarms.cjs --input EVIDENCE.json --output NEW.json
       node bench/task-false-alarms.cjs --help

Input: closed task-false-alarms/1 JSON, at most 1 MiB, 512 started tasks.
Units: monotonic milliseconds; exposure in hours; incidence as a fraction.
Requires frozen rubric/roster, run/source hashes, coverage/loss, task outcomes,
alarms and resolved independent adjudications. See docs/bench/TASK-FALSE-ALARMS.md.
Output: deterministic task-false-alarms-result/1 JSON, new file only (max 4 MiB).
Both files must have existing ordinary parents; links/reparse paths are refused.
Exit: 0 written (including null incidence) or help; 2 usage; 3 input path/read;
4 invalid evidence; 5 output path/collision; 6 output write. Errors are fixed codes.
`;
const fail = (code) => {
  throw new Error(code);
};

// Inspect every ancestor, including Windows junctions exposed as symbolic links.
// Owned, non-adversarial directories remain a prerequisite: this is not containment.
function ordinaryPath(file, output) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.length > 1024 ||
    file.includes('\0') ||
    /^[/\\]{2}/.test(file)
  )
    fail(output ? 'output-path' : 'input-path');
  const resolved = path.resolve(file),
    root = path.parse(resolved).root;
  let current = root;
  const parts = resolved.slice(root.length).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes(':')) fail(output ? 'output-path' : 'input-path');
    current = path.join(current, parts[i]);
    const last = i === parts.length - 1;
    if (last && output) {
      try {
        fs.lstatSync(current);
      } catch (error) {
        if (error.code === 'ENOENT') return resolved;
        throw error;
      }
      fail('output-path');
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (last ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
      fail(output ? 'output-path' : 'input-path');
  }
  return resolved;
}

// A small bounded JSON parser also refuses duplicate object keys before they can
// be erased by JSON.parse. It never evaluates code or reports malformed text.
function parseEvidence(text) {
  let pos = 0,
    nodes = 0;
  const space = () => {
    while (/[\t\n\r ]/.test(text[pos] || 'x')) pos++;
  };
  function string() {
    const start = pos++;
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === '\\') pos++;
      else if (ch === '"') return JSON.parse(text.slice(start, pos));
    }
    fail('input-invalid');
  }
  function value(depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('input-invalid');
    space();
    if (text[pos] === '"') return string();
    if (text[pos] === '{' || text[pos] === '[') {
      const object = text[pos++] === '{',
        out = object ? Object.create(null) : [],
        end = object ? '}' : ']';
      space();
      if (text[pos] === end) {
        pos++;
        return out;
      }
      while (pos < text.length) {
        let key;
        if (object) {
          if (text[pos] !== '"') fail('input-invalid');
          key = string();
          space();
          if (Object.hasOwn(out, key) || text[pos++] !== ':') fail('input-invalid');
        }
        const item = value(depth + 1);
        if (object) out[key] = item;
        else out.push(item);
        space();
        if (text[pos] === end) {
          pos++;
          return out;
        }
        if (text[pos++] !== ',') fail('input-invalid');
        space();
      }
      fail('input-invalid');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      text.slice(pos),
    );
    if (!token) fail('input-invalid');
    pos += token[0].length;
    return JSON.parse(token[0]);
  }
  const out = value(0);
  space();
  if (pos !== text.length) fail('input-invalid');
  return out;
}

function readEvidence(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > LIMITS.bytes) fail('input-path');
    const bytes = Buffer.alloc(LIMITS.bytes + 1);
    let used = 0,
      read;
    do {
      read = fs.readSync(fd, bytes, used, bytes.length - used, null);
      used += read;
    } while (read && used < bytes.length);
    const after = fs.fstatSync(fd),
      named = fs.lstatSync(file);
    if (
      used > LIMITS.bytes ||
      used !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      named.isSymbolicLink() ||
      named.ino !== before.ino ||
      named.dev !== before.dev
    )
      fail('input-path');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
  } finally {
    fs.closeSync(fd);
  }
}

let stage = 'usage';
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP);
  else {
    if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') fail('usage');
    stage = 'input-path';
    const input = ordinaryPath(args[1], false);
    stage = 'output-path';
    const output = ordinaryPath(args[3], true);
    stage = 'input-path';
    const text = readEvidence(input);
    stage = 'input-invalid';
    const result = evaluateTaskFalseAlarms(parseEvidence(text));
    const encoded = JSON.stringify(result, null, 2) + '\n';
    if (Buffer.byteLength(encoded) > 4194304) fail('input-invalid');
    stage = 'output-path';
    const fd = fs.openSync(
      output,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    stage = 'output-write';
    try {
      fs.writeFileSync(fd, encoded);
    } finally {
      fs.closeSync(fd);
    }
    process.stdout.write(
      JSON.stringify({ status: 'written', reason: result.incidence.reason }) + '\n',
    );
  }
} catch {
  const codes = {
    usage: 2,
    'input-path': 3,
    'input-invalid': 4,
    'output-path': 5,
    'output-write': 6,
  };
  process.stderr.write('task-false-alarms: ' + stage + '\n');
  process.exitCode = codes[stage];
}
