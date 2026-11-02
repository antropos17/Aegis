import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendGateCommandLog,
  GATE_COMMAND_LOG_BYTES,
  GATE_COMMAND_TAIL_CHARACTERS,
} from '../../tools/development/gate-command-log.mjs';

const directories = [];
function directory() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gate-log-'));
  directories.push(folder);
  return folder;
}
afterEach(() => {
  for (const folder of directories.splice(0)) {
    if (
      path.dirname(folder) !== os.tmpdir() ||
      !path.basename(folder).startsWith('aegis-gate-log-')
    )
      throw new Error('Refusing unowned fixture cleanup');
    fs.rmSync(folder, { recursive: true });
  }
});

describe('bounded aggregate gate command evidence', () => {
  it('retains exact Unicode and boundary tails under labels in one fixed file', () => {
    expect(GATE_COMMAND_TAIL_CHARACTERS).toBe(128 * 1024);
    const folder = directory();
    const first = 'stdout\nПривет 😀\n\uD800stderr';
    const second = 'x'.repeat(GATE_COMMAND_TAIL_CHARACTERS);
    appendGateCommandLog(folder, 'before-js', first);
    appendGateCommandLog(folder, 'before-native-build', second);
    expect(fs.readdirSync(folder)).toEqual(['commands.ndjson']);
    expect(
      fs
        .readFileSync(path.join(folder, 'commands.ndjson'), 'utf8')
        .trimEnd()
        .split('\n')
        .map(JSON.parse),
    ).toEqual([
      { label: 'before-js', tail: first },
      { label: 'before-native-build', tail: second },
    ]);
  });

  it('refuses invalid values and malformed existing evidence without changing earlier bytes', () => {
    const folder = directory();
    const file = path.join(folder, 'commands.ndjson');
    appendGateCommandLog(folder, 'before-js', 'retained');
    const original = fs.readFileSync(file);
    for (const [label, tail] of [
      ['../outside', 'tail'],
      ['label', null],
      ['label', 'x'.repeat(GATE_COMMAND_TAIL_CHARACTERS + 1)],
    ]) {
      expect(() => appendGateCommandLog(folder, label, tail)).toThrow();
      expect(fs.readFileSync(file)).toEqual(original);
    }
    for (const malformed of [
      Buffer.from('{"label":"known","tail":"truncated"}'),
      Buffer.from('{"label":"known","tail":"retained","foreign":true}\n'),
      Buffer.from([0xff, 0x0a]),
    ]) {
      fs.writeFileSync(file, malformed);
      expect(() => appendGateCommandLog(folder, 'next', 'tail')).toThrow();
      expect(fs.readFileSync(file)).toEqual(malformed);
    }
    expect(fs.readdirSync(folder)).toEqual(['commands.ndjson']);
  });

  it('accepts the exact total budget and refuses the next append without replacing any bytes', () => {
    expect(GATE_COMMAND_LOG_BYTES).toBe(4 * 1024 ** 2);
    const folder = directory();
    const line = (tail) => JSON.stringify({ label: 'filled', tail }) + '\n';
    const full = line('x'.repeat(GATE_COMMAND_TAIL_CHARACTERS));
    const lines = [];
    let remaining = GATE_COMMAND_LOG_BYTES;
    while (remaining > Buffer.byteLength(full)) {
      lines.push(full);
      remaining -= Buffer.byteLength(full);
    }
    const last = 'x'.repeat(remaining - Buffer.byteLength(line('')));
    const file = path.join(folder, 'commands.ndjson');
    fs.writeFileSync(file, lines.join(''));
    appendGateCommandLog(folder, 'filled', last);
    const original = fs.readFileSync(file);
    expect(original.length).toBe(GATE_COMMAND_LOG_BYTES);
    expect(() => appendGateCommandLog(folder, 'overflow', '')).toThrow();
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  });
});
