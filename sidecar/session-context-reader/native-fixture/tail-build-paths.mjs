import fs from 'node:fs';
import path from 'node:path';

const normalized = (value) =>
  path.win32.resolve(value).replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':');
const key = (value) => normalized(value).toLowerCase();
const related = (a, b) => a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\');
function checkedRoot(selected, checkout, runtimeRoot, files) {
  if (typeof selected !== 'string' || !path.win32.isAbsolute(selected))
    throw Error('invalid-tail-build-root');
  const root = normalized(selected);
  if (
    !/^[A-Za-z]:\\/.test(root) ||
    root === path.win32.parse(root).root ||
    [checkout, runtimeRoot].some((protectedRoot) => related(key(root), key(protectedRoot)))
  )
    throw Error('tail-build-output-protected');
  for (let cursor = root; ; cursor = path.win32.dirname(cursor)) {
    if (files.existsSync(cursor) && files.lstatSync(cursor).isSymbolicLink())
      throw Error('tail-build-output-link');
    if (cursor === path.win32.dirname(cursor)) break;
  }
  return root;
}

/** Validate a fresh dedicated leaf for either fixed build target.
 * No SDK or write operation runs here. Neither target reuses output/cache trees.
 * @param {string} selected Output leaf supplied by the orchestrator.
 * @param {string} checkout Source checkout root.
 * @param {string} runtimeRoot Installed runtime root.
 * @param {'reader'|'fixture'} kind Requested fixed build target.
 * @param {typeof fs} [files] Filesystem used for guard checks.
 * @returns {string} Normalized dedicated output root.
 * @since v0.20.1
 */
export function validateTaskRoot(selected, checkout, runtimeRoot, kind, files = fs) {
  if (!['reader', 'fixture'].includes(kind)) throw Error('invalid-tail-build-kind');
  const root = checkedRoot(selected, checkout, runtimeRoot, files);
  if (files.existsSync(root)) throw Error('tail-build-output-exists');
  if (!files.statSync(path.win32.dirname(root)).isDirectory())
    throw Error('tail-build-parent-unavailable');
  return root;
}

/** Validate a completed build for read-only qualification; this never runs an SDK.
 * Only fixed receipt/config/output entries are read. Cache trees are never reused.
 * @param {string} selected Completed dedicated build leaf.
 * @param {string} checkout Source checkout root.
 * @param {'reader'|'fixture'} kind Required completed build target.
 * @param {typeof fs} [files] Filesystem used for proof checks.
 * @returns {object} Validated root, runtime root and build receipt.
 * @since v0.20.1
 */
export function readBuiltTaskRoot(selected, checkout, kind, files = fs) {
  if (
    !['reader', 'fixture'].includes(kind) ||
    typeof selected !== 'string' ||
    !path.win32.isAbsolute(selected)
  )
    throw Error('invalid-tail-built-root');
  const root = checkedRoot(selected, checkout, checkout, files);
  for (const name of ['tail-task.json', kind + '-build.json', 'global.json', 'nuget.config']) {
    const stat = files.lstatSync(path.win32.join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw Error('tail-build-marker-unavailable');
  }
  const marker = JSON.parse(files.readFileSync(path.win32.join(root, 'tail-task.json'), 'utf8'));
  if (typeof marker.runtimeRoot !== 'string') throw Error('tail-build-runtime-unavailable');
  checkedRoot(root, checkout, marker.runtimeRoot, files);
  const receipt = JSON.parse(
    files.readFileSync(path.win32.join(root, kind + '-build.json'), 'utf8'),
  );
  const output = files.lstatSync(
    path.win32.join(root, kind === 'reader' ? 'build' : 'fixture-build'),
  );
  if (
    marker.schema !== 1 ||
    marker.kind !== 'aegis-session-tail-build' ||
    marker.buildKind !== kind ||
    marker.root !== key(root) ||
    marker.checkout !== key(checkout) ||
    receipt.kind !== kind ||
    receipt.result !== 'PASS' ||
    receipt.sourceUnchanged !== true ||
    typeof receipt.cwd !== 'string' ||
    key(receipt.cwd) !== key(root) ||
    !output.isDirectory() ||
    output.isSymbolicLink()
  )
    throw Error('tail-build-root-not-owned');
  return { root, runtimeRoot: marker.runtimeRoot, receipt };
}

/** Mark a new build root exclusively after all prerequisite checks succeed.
 * @param {string} root Validated fresh leaf.
 * @param {string} checkout Source checkout root.
 * @param {string} runtimeRoot Installed runtime root.
 * @param {'reader'|'fixture'} kind Fixed build target.
 * @returns {void}
 * @since v0.20.1
 */
export function createTaskRoot(root, checkout, runtimeRoot, kind) {
  fs.mkdirSync(root);
  fs.writeFileSync(
    path.win32.join(root, 'tail-task.json'),
    JSON.stringify({
      schema: 1,
      kind: 'aegis-session-tail-build',
      buildKind: kind,
      root: key(root),
      checkout: key(checkout),
      runtimeRoot: key(runtimeRoot),
    }),
    { flag: 'wx' },
  );
}
