import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

export const GATE_COMMAND_LOG_BYTES = 4 * 1024 ** 2;
export const GATE_COMMAND_TAIL_CHARACTERS = 128 * 1024;
const refused = () => {
  throw new Error('gate-command-log-refused');
};
const valid = (value) =>
  value !== null &&
  typeof value === 'object' &&
  Object.keys(value).length === 2 &&
  Object.hasOwn(value, 'label') &&
  Object.hasOwn(value, 'tail') &&
  typeof value.label === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(value.label) &&
  typeof value.tail === 'string' &&
  value.tail.length <= GATE_COMMAND_TAIL_CHARACTERS;

/** Retain bounded command tails in one fixed leaf without replacing earlier records.
 * @param {string} directory Fresh gate-owned logs directory.
 * @param {string} label Fixed command label, used only as a JSON value.
 * @param {string} tail Existing console-tail projection.
 * @returns {void} @since v0.20.1
 */
export function appendGateCommandLog(directory, label, tail) {
  const value = { label, tail };
  if (!valid(value) || !path.isAbsolute(directory)) refused();
  const folder = fs.lstatSync(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink()) refused();
  const file = path.join(directory, 'commands.ndjson');
  const line = Buffer.from(JSON.stringify(value) + '\n');
  const present = fs.existsSync(file);
  if (present) {
    const leaf = fs.lstatSync(file);
    if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1) refused();
  }
  const descriptor = fs.openSync(file, present ? 'r+' : 'wx', 0o600);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size + line.length > GATE_COMMAND_LOG_BYTES)
      refused();
    if (stat.size) {
      const bytes = fs.readFileSync(descriptor);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (bytes.length !== stat.size || !text.endsWith('\n')) refused();
        for (const row of text.slice(0, -1).split('\n')) {
          const record = JSON.parse(row);
          if (!valid(record) || JSON.stringify(record) !== row) refused();
        }
      } catch {
        refused();
      }
    }
    if (fs.fstatSync(descriptor).size !== stat.size) refused();
    if (fs.writeSync(descriptor, line, 0, line.length, stat.size) !== line.length) refused();
  } finally {
    fs.closeSync(descriptor);
  }
}
