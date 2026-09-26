import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  createSnapshot,
  acceptSnapshot,
  validateSnapshot,
  hashSnapshotValue: hash,
} = require('../../src/main/inventory-snapshot');
const { compareSnapshots } = require('../../src/main/inventory-snapshot-diff');

function inventory() {
  return {
    schemaVersion: 3,
    mode: 'project-inventory',
    adapter: { id: 'project', version: 1 },
    scope: { skills: ['.agents/skills'] },
    limits: { entries: 1024 },
    complete: true,
    issues: [],
    components: [
      { path: '.agents/skills/demo/SKILL.md', sha256: hash('manifest'), kind: 'skill-manifest' },
      { path: '.agents/skills/demo/run.js', sha256: hash('script'), kind: 'skill-file' },
    ],
    packages: [
      {
        manifest: '.agents/skills/demo/package.json',
        declaration: 'self-declared',
        version: '1.2.3',
      },
    ],
  };
}
function capture(value = inventory(), root = hash('root'), catalog = null) {
  return createSnapshot(value, root, catalog);
}
function accepted(value = capture()) {
  return acceptSnapshot(value, value.digest, value);
}
function reseal(snapshot) {
  const document = { ...snapshot };
  delete document.digest;
  return { ...document, digest: hash(document) };
}

describe('content-bound inventory acceptance', () => {
  it('keeps a saved and identical snapshot unreviewed until exact-digest acceptance', () => {
    const snapshot = capture();
    expect(compareSnapshots(snapshot, capture())).toMatchObject({
      status: 'review-required',
      contentUnchanged: true,
      reviewRequired: true,
    });
    const trusted = accepted(snapshot);
    expect(snapshot.state).toBe('observed');
    expect(trusted.digest).not.toBe(snapshot.digest);
    expect(compareSnapshots(trusted, capture())).toMatchObject({
      status: 'accepted-content-unchanged',
      reviewRequired: false,
      assessment: 'not-performed',
    });
  });

  it('detects script changes even when the skill manifest is unchanged', () => {
    const baseline = accepted();
    const value = inventory();
    value.components[1].sha256 = hash('substituted script');
    const diff = compareSnapshots(baseline, capture(value));
    expect(diff.reviewRequired).toBe(true);
    expect(diff.changes.components.changed).toEqual([
      { path: '.agents/skills/demo/run.js', fields: ['content'] },
    ]);
    expect(baseline.state).toBe('accepted');
  });

  it('reports additions, removals, metadata changes and package evidence independently', () => {
    const baseline = accepted();
    const value = inventory();
    value.components.shift();
    value.components[0].kind = 'instruction';
    value.components.push({ path: 'AGENTS.md', sha256: hash('new'), kind: 'instruction' });
    value.packages[0].version = '2.0.0';
    const diff = compareSnapshots(baseline, capture(value));
    expect(diff.changes.components).toMatchObject({
      added: ['AGENTS.md'],
      removed: ['.agents/skills/demo/SKILL.md'],
      changed: [{ path: '.agents/skills/demo/run.js', fields: ['metadata'] }],
    });
    expect(diff.changes.packages.changed).toEqual([
      { path: '.agents/skills/demo/package.json', fields: ['content'] },
    ]);
  });

  it('does not report inaccessible files as deleted or preserve acceptance on incomplete scans', () => {
    const value = inventory();
    value.complete = false;
    value.issues = [{ path: '.agents/skills', reason: 'unreadable' }];
    value.components = [];
    const diff = compareSnapshots(accepted(), capture(value));
    expect(diff).toMatchObject({ status: 'incomplete', complete: false, reviewRequired: true });
    expect(diff.changes.components.removed).toEqual([]);
    expect(diff.changes.components.unobserved).toHaveLength(2);
    expect(() => acceptSnapshot(capture(value), capture(value).digest, capture(value))).toThrow(
      'snapshot-incomplete',
    );
  });

  it('calls new observations uncertain when the reference snapshot was incomplete', () => {
    const old = inventory();
    old.complete = false;
    old.issues = [{ reason: 'entry-limit' }];
    old.components = [];
    const diff = compareSnapshots(capture(old), capture());
    expect(diff.changes.components.added).toEqual([]);
    expect(diff.changes.components.newlyObserved).toHaveLength(2);
  });

  it.each(['root', 'adapter', 'adapter-version', 'limits', 'scope', 'schema'])(
    'does not transfer acceptance after %s changes',
    (change) => {
      const value = inventory();
      if (change === 'adapter') value.adapter.id = 'codex-user';
      if (change === 'adapter-version') value.adapter.version++;
      if (change === 'limits') value.limits.entries = 512;
      if (change === 'scope') value.scope.skills = [];
      if (change === 'schema') value.schemaVersion++;
      const current = capture(value, hash(change === 'root' ? 'other root' : 'root'));
      expect(compareSnapshots(accepted(), current)).toMatchObject({
        status: 'incompatible',
        reviewRequired: true,
        changes: null,
      });
    },
  );

  it('rejects a wrong reviewed digest and a changed fresh capture', () => {
    const snapshot = capture();
    expect(() => acceptSnapshot(snapshot, hash('wrong'), capture())).toThrow(
      'snapshot-digest-mismatch',
    );
    const changed = inventory();
    changed.components[0].sha256 = hash('changed');
    expect(() => acceptSnapshot(snapshot, snapshot.digest, capture(changed))).toThrow(
      'snapshot-changed-since-review',
    );
    const trusted = accepted(snapshot);
    expect(() => acceptSnapshot(trusted, trusted.digest, capture())).toThrow(
      'snapshot-already-accepted',
    );
  });

  it('persists only paths and fingerprints even when internal metadata includes private text', () => {
    const value = inventory();
    value.components[0].privateText = 'CANARY_CONFIGURATION';
    value.packages[0].url = 'https://CANARY_PACKAGE.invalid';
    const text = JSON.stringify(capture(value));
    expect(text).not.toContain('CANARY');
    expect(text).not.toContain('self-declared');
  });

  it('rejects corrupted content even when all field shapes remain valid', () => {
    const snapshot = accepted();
    snapshot.body.components[0].sha256 = hash('changed');
    expect(() => validateSnapshot(snapshot)).toThrow('snapshot-invalid');
  });

  it.each([
    (s) => {
      s.schemaVersion = 2;
    },
    (s) => {
      s.extra = 'CANARY';
    },
    (s) => {
      s.body.subject.adapter = ['project'];
    },
    (s) => {
      s.body.subject.rootSha256 = 'CANARY';
    },
    (s) => {
      s.body.components[0].sha256 += '\n';
    },
    (s) => {
      s.body.components[0].path = '../outside';
    },
    (s) => {
      s.body.components[0].path = '/absolute';
    },
    (s) => {
      s.body.components[0].path = 'C:/absolute';
    },
    (s) => {
      s.body.components[0].path = 'a\\b';
    },
    (s) => {
      s.body.components[0].path = 'a\nCANARY';
    },
    (s) => {
      s.body.components.push(s.body.components[0]);
    },
    (s) => {
      s.body.components.reverse();
    },
    (s) => {
      s.body.components[0].sha256 = {};
    },
    (s) => {
      s.body.complete = false;
    },
    (s) => {
      s.body.catalogSha256 = hash('without a source');
    },
    (s) => {
      s.state = 'accepted';
      s.body.complete = false;
      s.body.issueCount = 1;
    },
  ])(
    'rejects an unsupported or ambiguous imported document even with a recalculated digest',
    (mutate) => {
      const snapshot = capture();
      mutate(snapshot);
      expect(() => validateSnapshot(reseal(snapshot))).toThrow('snapshot-invalid');
    },
  );

  it('bounds serialized snapshot size independently of source-file read limits', () => {
    const value = inventory();
    value.components = Array.from({ length: 1024 }, (_, i) => ({
      path: `s${String(i).padStart(4, '0')}/${'a'.repeat(1100)}`,
      sha256: hash('x'),
    }));
    expect(() => capture(value)).toThrow('snapshot-size-limit');
  });
});
