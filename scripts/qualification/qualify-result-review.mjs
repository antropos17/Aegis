import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const {
  parseResultReviewBundle,
  copyResultReviewSnapshot,
} = require('../../src/main/result-review-bundle');
const {
  createResultReviewPlan,
  resultReviewSelectionDigest,
  prepareResultReviewPublication,
} = require('../../src/main/result-review-plan');
const CASES = Object.freeze([
  'selected',
  'deletion',
  'stale',
  'original-conflict',
  'swapped-bytes',
  'traversal',
  'link',
  'case-collision',
  'collision',
  'interrupted',
  'dishonest',
]);
const prior = new Map([
  ['edit.txt', Buffer.from('old')],
  ['keep.txt', Buffer.from('keep')],
  ['delete.txt', Buffer.from('remove')],
]);
const after = new Map([
  ['edit.txt', Buffer.from('new')],
  ['keep.txt', Buffer.from('keep')],
  ['add.txt', Buffer.from('added')],
]);
const entries = (files) =>
  [...files].map(([name, bytes]) => ({
    path: name,
    kind: 'file',
    contentBase64: bytes.toString('base64'),
  }));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function clean(root, parent) {
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith('aegis-result-review-') ||
    (await fs.lstat(root)).isSymbolicLink()
  )
    throw Error('fixture-cleanup-boundary');
  const items = await fs.readdir(root, { withFileTypes: true });
  if (items.length > 16 || items.some((item) => !item.isFile() || item.isSymbolicLink()))
    throw Error('fixture-cleanup-boundary');
  for (const item of items) await fs.unlink(path.join(root, item.name));
  await fs.rmdir(root);
}

async function originals(root) {
  const files = new Map();
  for (const name of prior.keys()) files.set(name, await fs.readFile(path.join(root, name)));
  return files;
}

// The caller owns an exact generated fixture root, never an arbitrary project destination.
async function publish(root, bytes, interrupted) {
  const stage = path.join(root, '.stage-' + randomUUID()),
    destination = path.join(root, 'selected-result.json');
  let handle;
  let failure;
  try {
    handle = await fs.open(stage, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    if (!(await fs.readFile(stage)).equals(bytes)) throw Error('fixture-stage-mismatch');
    if (interrupted) throw Error('fixture-publication-interrupted');
    // Exclusive hard-link publication preserves an existing final artifact.
    await fs.link(stage, destination);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (handle) await handle.close();
    } catch (error) {
      failure ||= error;
    }
    try {
      await fs.unlink(stage);
    } catch (error) {
      if (error.code !== 'ENOENT') failure ||= error;
    }
  }
  if (failure) throw failure;
}

async function inspect(root, expectedName, expectedBytes, deletion) {
  const bytes = await fs.readFile(path.join(root, 'selected-result.json'));
  const value = JSON.parse(bytes.toString('utf8'));
  const change = value.changes[0];
  return (
    value.kind === 'selected-result-changes' &&
    value.changes.length === 1 &&
    change.path === expectedName &&
    value.launchAllowed === false &&
    value.projectExportAllowed === false &&
    value.writerState === 'stop-unconfirmed' &&
    (deletion
      ? change.type === 'deletion' && change.contentBase64 === null
      : Buffer.from(change.contentBase64, 'base64').equals(expectedBytes)) &&
    !value.changes.some((row) => row.path === 'add.txt' || row.path === 'keep.txt')
  );
}

async function runCase(name) {
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'aegis-result-review-'));
  try {
    for (const [file, bytes] of prior)
      await fs.writeFile(path.join(root, file), bytes, { flag: 'wx' });
    const input = {
      schemaVersion: 1,
      captureSource: 'external-result',
      before: { complete: true, files: entries(prior) },
      after: { complete: true, files: entries(after) },
      claims: { accepted: true, stopped: true, boundaryPassed: true },
    };
    if (name === 'traversal') input.after.files[0].path = '../outside.txt';
    if (name === 'link') input.after.files[0].kind = 'link';
    if (name === 'case-collision')
      input.after.files.push({ ...input.after.files[0], path: 'EDIT.txt' });
    const raw = Buffer.from(JSON.stringify(input));
    if (['traversal', 'link', 'case-collision'].includes(name)) {
      let refused = false;
      try {
        parseResultReviewBundle(raw);
      } catch (error) {
        refused = error.message === 'result-bundle-invalid';
      }
      return {
        name,
        passed: refused && !(await fs.readdir(root)).includes('selected-result.json'),
        published: false,
      };
    }
    const review = parseResultReviewBundle(raw),
      owner = { reviewId: randomUUID(), revision: 1 };
    const selected = review.changes.find(
      (change) => change.path === (name === 'deletion' ? 'delete.txt' : 'edit.txt'),
    );
    const ids = [selected.id],
      acknowledgeDeletion = name === 'deletion';
    const plan = createResultReviewPlan(review, owner, {
      ids,
      acknowledgeDeletion,
      baselineDigest: review.baselineDigest,
      snapshotDigest: review.snapshotDigest,
      selectionDigest: resultReviewSelectionDigest(ids, acknowledgeDeletion),
    });
    if (name === 'swapped-bytes') {
      raw.fill(0);
      copyResultReviewSnapshot(review, 'after').get('edit.txt').fill(0);
    }
    if (name === 'original-conflict') await fs.writeFile(path.join(root, 'edit.txt'), 'changed');
    const current = {
      ...owner,
      revision: name === 'stale' ? 2 : owner.revision,
      originals: await originals(root),
    };
    if (['stale', 'original-conflict'].includes(name)) {
      let refused = false,
        retryRefused = false;
      try {
        prepareResultReviewPublication(plan, current);
      } catch (error) {
        refused =
          error.message ===
          (name === 'stale' ? 'result-selection-stale' : 'result-original-conflict');
      }
      await fs.writeFile(path.join(root, 'edit.txt'), 'old');
      try {
        prepareResultReviewPublication(plan, { ...owner, originals: await originals(root) });
      } catch (error) {
        retryRefused = error.message === 'result-plan-expired';
      }
      return { name, passed: refused && retryRefused, published: false };
    }
    const bytes = prepareResultReviewPublication(plan, current);
    if (name === 'collision')
      await fs.writeFile(path.join(root, 'selected-result.json'), 'sentinel', { flag: 'wx' });
    let failure;
    try {
      await publish(root, bytes, name === 'interrupted');
    } catch (error) {
      failure = error;
    }
    if (['collision', 'interrupted'].includes(name)) {
      const stageClean = !(await fs.readdir(root)).some((file) => file.startsWith('.stage-'));
      const preserved =
        name === 'collision'
          ? (await fs.readFile(path.join(root, 'selected-result.json'), 'utf8')) === 'sentinel'
          : !(await fs.readdir(root)).includes('selected-result.json');
      return { name, passed: !!failure && stageClean && preserved, published: false };
    }
    const publicationValid =
      !failure &&
      (await inspect(
        root,
        name === 'deletion' ? 'delete.txt' : 'edit.txt',
        Buffer.from('new'),
        name === 'deletion',
      ));
    const unchanged = [...(await originals(root))].every(([file, bytes]) =>
      prior.get(file).equals(bytes),
    );
    return {
      name,
      passed: publicationValid && unchanged,
      published: (await fs.readdir(root)).includes('selected-result.json'),
      originalFilesUnchanged: unchanged,
      bundleSha256: sha(bytes),
    };
  } finally {
    await clean(root, parent);
  }
}

/** Execute fixed disposable publication cases and independent byte oracles; no project is applied.
 * @param {string} selected Fixed case selector or all. @returns {Promise<object>} Metadata-only qualification. @since v0.17.0 */
export async function qualifyResultReview(selected = 'all') {
  if (selected !== 'all' && !CASES.includes(selected)) throw Error('fixture-selector-invalid');
  const results = [];
  for (const name of selected === 'all' ? CASES : [selected]) results.push(await runCase(name));
  return {
    schemaVersion: 1,
    passed: results.every((row) => row.passed),
    developerOnly: true,
    launchAllowed: false,
    projectExportAllowed: false,
    cases: results,
    notRun: [
      'arbitrary-project-capture',
      'hostile-filesystem-swaps',
      'writer-termination',
      'guest-return-authenticity',
      'power-loss-recovery',
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw Error('fixture-selector-invalid');
    const value = await qualifyResultReview(process.argv[2]);
    process.stdout.write(JSON.stringify(value) + '\n');
    process.exitCode = value.passed ? 0 : 2;
  } catch {
    process.stdout.write(
      JSON.stringify({
        passed: false,
        error: 'result-qualification-unavailable',
        launchAllowed: false,
      }) + '\n',
    );
    process.exitCode = 2;
  }
}
