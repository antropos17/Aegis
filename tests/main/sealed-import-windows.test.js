import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectSealedImportBundle } from '../../scripts/qualification/sealed-import-oracle.mjs';
import { createSealedImportHarness } from '../fixtures/sealed-import/harness.mjs';

const native = process.platform === 'win32' && process.arch === 'x64';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { setup, corpus, run, rejected, finish } = createSealedImportHarness();

describe.skipIf(!native)('native Windows x64 sealed dummy import', () => {
  beforeAll(setup, 40000);
  afterAll(finish);

  it('seals a clean corpus and the independent oracle matches all bytes and hashes', () => {
    const fixture = corpus('positive');
    fs.mkdirSync(path.join(fixture.source, 'lib'));
    fs.writeFileSync(path.join(fixture.source, 'lib', 'binary.bin'), Buffer.from([0, 255, 42, 10]));
    fs.writeFileSync(path.join(fixture.source, 'empty.txt'), '');
    const result = run(fixture);
    expect(result.status).toBe(0);
    const observed = inspectSealedImportBundle(
      path.join(fixture.output, 'bundle.aegis'),
      fixture.source,
    );
    expect(result.report).toMatchObject({ sealed: true, code: 'sealed', ...observed });
    expect(observed.fileCount).toBe(3);
    expect(fs.readdirSync(fixture.output)).toEqual(['bundle.aegis']);
  });

  it('refuses .git material rather than silently omitting its entries', () => {
    const fixture = corpus('git');
    fs.mkdirSync(path.join(fixture.source, '.git'));
    fs.writeFileSync(
      path.join(fixture.source, '.git', 'config'),
      'DISPOSABLE_CREDENTIAL_HELPER_CANARY',
    );
    rejected(fixture, 'none', 'import-excluded');
  });

  it('refuses explicit credential, config, profile and environment filenames', () => {
    for (const name of ['.env', 'credentials.json', 'config.json', 'profile.ini']) {
      const fixture = corpus('excluded');
      fs.writeFileSync(path.join(fixture.source, name), 'DISPOSABLE_DUMMY_ONLY');
      rejected(fixture, 'none', 'import-excluded');
    }
  });

  it('rejects a real junction to an outside canary without reading or publishing it', () => {
    const fixture = corpus('junction');
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    const canary = path.join(outside, 'canary.txt');
    fs.writeFileSync(canary, 'DISPOSABLE_OUTSIDE_CANARY');
    const before = hash(fs.readFileSync(canary));
    fs.symlinkSync(outside, path.join(fixture.source, 'junction'), 'junction');
    rejected(fixture, 'none', 'import-reparse');
    expect(hash(fs.readFileSync(canary))).toBe(before);
  });

  it('rejects an outside canary hardlink even when its content is otherwise valid', () => {
    const fixture = corpus('hardlink');
    const canary = path.join(fixture.root, 'canary.txt');
    fs.writeFileSync(canary, 'DISPOSABLE_HARDLINK_CANARY');
    fs.linkSync(canary, path.join(fixture.source, 'linked.txt'));
    rejected(fixture, 'none', 'import-hardlink');
    expect(fs.statSync(canary).nlink).toBe(2);
    expect(fs.readFileSync(canary, 'utf8')).toBe('DISPOSABLE_HARDLINK_CANARY');
  });

  it('rejects a real alternate stream on a leaf', () => {
    const fixture = corpus('ads');
    fs.writeFileSync(path.join(fixture.source, 'readme.txt:hidden'), 'DISPOSABLE_ADS_CANARY');
    rejected(fixture, 'none', 'import-stream');
  });

  it('rejects a real alternate stream on the source directory', () => {
    const fixture = corpus('directory-ads');
    fs.writeFileSync(`${fixture.source}:hidden`, 'DISPOSABLE_DIRECTORY_ADS_CANARY');
    rejected(fixture, 'none', 'import-stream');
  });

  it('rejects a same-byte file replacement after capture using the complete identity', () => {
    const fixture = corpus('swap');
    rejected(fixture, 'swap', 'import-identity-changed');
    expect(fs.existsSync(path.join(fixture.source, 'readme.txt.old'))).toBe(true);
    expect(fs.readFileSync(path.join(fixture.source, 'readme.txt.old'))).toEqual(
      fs.readFileSync(path.join(fixture.source, 'readme.txt')),
    );
  });

  it('rejects an actual replacement between handle enumeration and first leaf open', () => {
    const fixture = corpus('enum-swap');
    rejected(fixture, 'enum-swap', 'import-identity-changed');
    expect(fs.readFileSync(path.join(fixture.root, 'enumerated-old.txt'))).toEqual(
      fs.readFileSync(path.join(fixture.source, 'readme.txt')),
    );
  });

  it('rejects content changes and new directory membership between capture and seal', () => {
    rejected(corpus('content'), 'content', 'import-content-changed');
    rejected(corpus('membership'), 'membership', 'import-directory-changed');
    rejected(corpus('size-change'), 'size', 'import-size-changed');
  });

  it('rejects stream and hardlink changes introduced after capture', () => {
    rejected(corpus('late-ads'), 'ads', 'import-stream');
    rejected(corpus('late-hardlink'), 'hardlink', 'import-hardlink');
  });

  it('rejects file count, file size, aggregate size, directory and depth budgets', () => {
    const files = corpus('files');
    for (let index = 0; index < 128; index++)
      fs.writeFileSync(path.join(files.source, `${index}.txt`), 'x');
    rejected(files, 'none', 'import-file-budget');
    const size = corpus('size');
    fs.writeFileSync(path.join(size.source, 'large.bin'), Buffer.alloc(65537));
    rejected(size, 'none', 'import-file-size-budget');
    const total = corpus('total');
    for (let index = 0; index < 16; index++)
      fs.writeFileSync(path.join(total.source, `${index}.bin`), Buffer.alloc(65536));
    rejected(total, 'none', 'import-byte-budget');
    const dirs = corpus('dirs');
    for (let index = 0; index < 32; index++) fs.mkdirSync(path.join(dirs.source, `d${index}`));
    rejected(dirs, 'none', 'import-directory-budget');
    const depth = corpus('depth');
    let at = depth.source;
    for (let index = 0; index < 9; index++) {
      at = path.join(at, 'd');
      fs.mkdirSync(at);
    }
    rejected(depth, 'none', 'import-depth-budget');
  });

  it('rejects malformed, UNC and device inputs before any source traversal', () => {
    for (const source of [
      '\\\\server\\share\\project',
      '\\\\?\\C:\\project',
      'C:\\project\\..\\other',
    ]) {
      const fixture = corpus('invalid');
      rejected({ ...fixture, source }, 'none', 'import-path-invalid');
    }
  });

  it('rejects source ADS spelling and a junction selected as the source root', () => {
    const fixture = corpus('root-junction');
    const alias = path.join(fixture.root, 'alias');
    fs.symlinkSync(fixture.source, alias, 'junction');
    rejected({ ...fixture, source: alias }, 'none', 'import-reparse');
    rejected(
      { ...corpus('source-ads'), source: `${fixture.source}:hidden` },
      'none',
      'import-path-invalid',
    );
  });

  it('fails closed when full identity APIs are unavailable and verifies all 128 bits', () => {
    rejected(corpus('id-unavailable'), 'fileid-unavailable', 'import-file-id-unavailable');
    rejected(corpus('upper-id'), 'upper-id', 'import-identity-changed');
  });

  it('detects staged byte corruption and never publishes a partial bundle', () => {
    rejected(corpus('staged'), 'staged', 'import-staged-content-changed');
    rejected(corpus('publication'), 'publication-fail', 'import-publication-failed');
  });

  it('retains source leaves and parent directories against independent write/delete/rename', () => {
    const fixture = corpus('retention');
    expect(run(fixture, 'retention').status).toBe(0);
    expect(
      inspectSealedImportBundle(path.join(fixture.output, 'bundle.aegis'), fixture.source)
        .fileCount,
    ).toBe(1);
    expect(fs.readdirSync(fixture.output)).toEqual(['bundle.aegis']);
    rejected(corpus('writer-held'), 'writer-held', 'import-open-failed');
  });

  it('never overwrites an existing final name and removes only its exact stage', () => {
    const fixture = corpus('collision');
    const unrelated = path.join(fixture.root, 'unrelated.txt');
    fs.writeFileSync(unrelated, 'DISPOSABLE_UNRELATED_CANARY');
    const result = run(fixture, 'collision');
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({
      sealed: false,
      code: 'import-publication-failed',
      cleanup: 'stage-removed',
    });
    expect(fs.readFileSync(path.join(fixture.output, 'bundle.aegis'), 'utf8')).toBe(
      'DISPOSABLE_EXISTING_FINAL_CANARY',
    );
    expect(fs.readdirSync(fixture.output)).toEqual(['bundle.aegis']);
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('DISPOSABLE_UNRELATED_CANARY');
  });

  it('fails the fixture process closed without unwinding unresolved IO (synthetic pending)', () => {
    const fixture = corpus('pending');
    const result = rejected(fixture, 'pending', 'import-publication-pending');
    expect(result.report.cleanup).toBe('stage-retained-uncertain');
    expect(fs.readdirSync(fixture.output)).toHaveLength(1);
    expect(fs.readdirSync(fixture.output)[0]).toMatch(/^stage-[a-f0-9]{32}\.tmp$/);
  });

  it('accepts exact file, aggregate-byte, directory, depth and name limits', () => {
    const total = corpus('limit-total');
    fs.unlinkSync(path.join(total.source, 'readme.txt'));
    for (let index = 0; index < 16; index++)
      fs.writeFileSync(path.join(total.source, `${index}.bin`), Buffer.alloc(65536));
    expect(run(total).report.totalBytes).toBe(1048576);
    expect(
      inspectSealedImportBundle(path.join(total.output, 'bundle.aegis'), total.source).totalBytes,
    ).toBe(1048576);
    const files = corpus('limit-files');
    for (let index = 0; index < 127; index++)
      fs.writeFileSync(path.join(files.source, `${index}.txt`), '');
    for (let index = 0; index < 31; index++) fs.mkdirSync(path.join(files.source, `d${index}`));
    expect(run(files).report.fileCount).toBe(128);
    const depth = corpus('limit-depth');
    let at = depth.source;
    for (let index = 0; index < 8; index++) {
      at = path.join(at, 'd');
      fs.mkdirSync(at);
    }
    expect(run(depth).status).toBe(0);
    const relative = corpus('limit-relative');
    let parent = relative.source;
    for (let index = 0; index < 3; index++) {
      parent = path.join(parent, 'a'.repeat(64));
      fs.mkdirSync(parent);
    }
    fs.writeFileSync(path.join(parent, 'b'.repeat(45)), '');
    expect(run(relative).status).toBe(0);
    fs.renameSync(path.join(parent, 'b'.repeat(45)), path.join(parent, 'b'.repeat(46)));
    const second = { ...relative, output: path.join(relative.root, 'output-over') };
    rejected(second, 'none', 'import-relative-path-budget');
    const component = corpus('component');
    fs.writeFileSync(path.join(component.source, 'a'.repeat(65)), '');
    rejected(component, 'none', 'import-component-budget');
  });
});
