import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = 'out/development/agent-skills.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');

function inspect(root, relative) {
  const parts = relative.split('/');
  if (parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || ['.', '..'].includes(part))) {
    throw new Error(`Invalid catalog path: ${relative}`);
  }
  let current = root;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
      throw new Error(`Linked path is not an installation target: ${current}`);
    }
    if (current !== path.join(root, ...parts) && !stat.isDirectory()) {
      throw new Error(`Expected a directory: ${current}`);
    }
  }
  return current;
}

function contents(root, relative) {
  const filename = inspect(root, relative);
  try {
    return fs.readFileSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readReceipt(root) {
  const bytes = contents(root, receiptPath);
  if (!bytes) return {};
  const receipt = JSON.parse(bytes);
  if (
    receipt.version !== 1 ||
    !receipt.files ||
    typeof receipt.files !== 'object' ||
    Array.isArray(receipt.files)
  ) {
    throw new Error('Invalid skill installation receipt');
  }
  for (const [filename, digest] of Object.entries(receipt.files)) {
    if (!/^\.(agents|claude)\/skills\//.test(filename) || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('Invalid skill installation receipt entry');
    }
    inspect(root, filename);
  }
  return receipt.files;
}

/**
 * Preview or synchronize this checkout's catalog into both ignored installations.
 * @param {string} root Exact checkout (or disposable fixture) containing the catalog.
 * @param {{write?: boolean}} options Write only after the complete preflight passes.
 * @returns {{changed: string[], unchanged: number}} Installation comparison.
 * @since v0.19.2
 */
export function syncSkills(root = checkout, { write = false } = {}) {
  root = path.resolve(root);
  const catalog = JSON.parse(contents(root, 'tools/agent-skills/catalog.json'));
  if (catalog.version !== 1 || !Array.isArray(catalog.skills) || !catalog.skills.length) {
    throw new Error('Invalid skill catalog');
  }
  const previous = readReceipt(root);
  const plan = new Map();
  for (const skill of catalog.skills) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
      !Array.isArray(skill.files) ||
      !skill.files.includes('SKILL.md')
    ) {
      throw new Error('Invalid skill catalog entry');
    }
    for (const file of skill.files) {
      const source = `tools/agent-skills/${skill.name}/${file}`;
      const bytes = contents(root, source);
      if (!bytes) throw new Error(`Missing catalog file: ${source}`);
      const markdown = bytes.toString('utf8').replace(/\r\n/g, '\n');
      if (file === 'SKILL.md' && !markdown.startsWith(`---\nname: ${skill.name}\n`)) {
        throw new Error(`Skill name/frontmatter mismatch: ${source}`);
      }
      for (const client of ['agents', 'claude']) {
        if (client === 'claude' && file.startsWith('agents/')) continue;
        const target = `.${client}/skills/${skill.name}/${file}`;
        if (plan.has(target)) throw new Error(`Duplicate catalog target: ${target}`);
        const desired =
          client === 'claude' && skill.name === 'ship' && file === 'SKILL.md'
            ? Buffer.from(markdown.replace(/^---\n/, '---\ndisable-model-invocation: true\n'))
            : bytes;
        const current = contents(root, target);
        const currentHash = current === null ? null : hash(current);
        const desiredHash = hash(desired);
        if (currentHash && currentHash !== desiredHash && currentHash !== previous[target]) {
          throw new Error(`Local customization preserved; reconcile before syncing: ${target}`);
        }
        plan.set(target, { desired, desiredHash, currentHash });
      }
    }
  }
  for (const target of Object.keys(previous)) {
    if (!plan.has(target) && contents(root, target) !== null) {
      throw new Error(`Retired catalog file preserved; review its removal manually: ${target}`);
    }
  }
  const changed = [...plan].filter(([, item]) => item.currentHash !== item.desiredHash);
  if (write) {
    // Repeat the preflight before any write to catch edits made while planning.
    for (const [target, item] of plan) {
      const current = contents(root, target);
      if ((current === null ? null : hash(current)) !== item.currentHash) {
        throw new Error(`Installation changed during preflight: ${target}`);
      }
    }
    for (const [target, item] of changed) {
      const filename = inspect(root, target);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, item.desired, { flag: item.currentHash === null ? 'wx' : 'w' });
    }
    const receipt = inspect(root, receiptPath);
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(
      receipt,
      `${JSON.stringify(
        {
          version: 1,
          files: Object.fromEntries([...plan].map(([target, item]) => [target, item.desiredHash])),
        },
        null,
        2,
      )}\n`,
    );
  }
  return { changed: changed.map(([target]) => target), unchanged: plan.size - changed.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !['--write', '--check'].includes(arg))) {
      throw new Error('Usage: node scripts/sync-agent-skills.mjs [--write|--check]');
    }
    const result = syncSkills(checkout, { write: args.includes('--write') });
    console.log(JSON.stringify({ checkout, mode: args[0] || 'preview', ...result }, null, 2));
    if (args.includes('--check') && result.changed.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
