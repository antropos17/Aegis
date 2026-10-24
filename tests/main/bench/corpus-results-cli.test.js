import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const runner = require('../../../bench/run'),
  actor = require('../../../bench/lib/actor'),
  childProcess = require('node:child_process');
const root = path.resolve(import.meta.dirname, '../../..'),
  directories = [];
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-path-sentinel-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
let serial = 0;
async function fixture() {
  const dir = directory(),
    scenario = runner.prepareScenario('S3-ordinary-fixture', 'C'),
    now = new Date(Date.UTC(2026, 9, 24, 1, 0, serial++)),
    runId = runner.buildRunId(now, scenario.id, 'C');
  const manifestFile = require.resolve('../../../bench/lib/manifest'),
    previous = require.cache[manifestFile];
  const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
    throw new Error('private-probe-sentinel');
  });
  try {
    delete require.cache[manifestFile];
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        require(manifestFile).collect({
          runId,
          scenario: scenario.id,
          arm: 'C',
          startedAt: now.toISOString(),
        }),
      ),
    );
  } finally {
    if (previous) require.cache[manifestFile] = previous;
    else delete require.cache[manifestFile];
    exec.mockRestore();
  }
  const outcome = await actor.execute(scenario, { runDir: dir, runId });
  runner.writeScenarioArtifacts({ dir, scenario, runId, arm: 'C', outcome });
  return { dir, out: path.join(directory(), 'new-results') };
}
function invoke(
  item,
  args = ['--run', item.dir, '--as-of', '2026-10-24', '--out', item.out],
  preload,
) {
  return spawnSync(
    process.execPath,
    [...(preload ? ['--require', preload] : []), 'bench/corpus-results.cjs', ...args],
    { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8192 },
  );
}
describe('recorded corpus CLI', () => {
  it('writes the two deterministic fresh outputs without exposing private metadata', async () => {
    const item = await fixture(),
      result = invoke(item);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('corpus-results: written\n');
    expect(result.stderr).toBe('');
    const report = JSON.parse(fs.readFileSync(path.join(item.out, 'corpus-results.json'), 'utf8'));
    expect(report.attempts).toHaveLength(1);
    expect(report).toMatchObject({
      measurementAccepted: false,
      w8Accepted: false,
      captureAssessment: 'not-assessed',
    });
    const json = fs.readFileSync(path.join(item.out, 'corpus-results.json')),
      md = fs.readFileSync(path.join(item.out, 'corpus-results.md'));
    const again = { ...item, out: path.join(path.dirname(item.out), 'again') };
    expect(invoke(again).status).toBe(0);
    expect(fs.readFileSync(path.join(again.out, 'corpus-results.json'))).toEqual(json);
    expect(fs.readFileSync(path.join(again.out, 'corpus-results.md'))).toEqual(md);
    expect(json.toString() + md.toString() + result.stdout + result.stderr).not.toMatch(
      /private-probe-sentinel|private-path-sentinel/,
    );
  });
  it('validates input before creating any result directory and uses fixed private diagnostics', async () => {
    const item = await fixture();
    fs.writeFileSync(path.join(item.dir, 'steps.json'), '{"private-input-sentinel":not-json}');
    const result = invoke(item);
    expect(result.status).toBe(3);
    expect(result.stderr).toBe('corpus-results: corpus-input-invalid\n');
    expect(result.stdout).toBe('');
    expect(fs.existsSync(item.out)).toBe(false);
    expect(result.stderr).not.toContain(item.dir);
  });
  it('refuses an existing output directory and preserves its files', async () => {
    const item = await fixture();
    fs.mkdirSync(item.out);
    fs.writeFileSync(path.join(item.out, 'sentinel'), 'preserved');
    const result = invoke(item);
    expect(result.status).toBe(5);
    expect(result.stderr).toBe('corpus-results: corpus-output-refused\n');
    expect(fs.readdirSync(item.out)).toEqual(['sentinel']);
  });
  it('refuses a racing output directory without removing the competing sentinel', async () => {
    const item = await fixture(),
      preload = path.join(directory(), 'race.cjs');
    fs.writeFileSync(
      preload,
      `const fs=require('node:fs'),path=require('node:path'),original=fs.mkdirSync;const output=${JSON.stringify(item.out)};fs.mkdirSync=function(file,...args){if(file===output){original(file);fs.writeFileSync(path.join(file,'sentinel'),'preserved');}return original(file,...args);};`,
    );
    const result = invoke(item, undefined, preload);
    expect(result.status).toBe(5);
    expect(result.stderr).toBe('corpus-results: corpus-output-refused\n');
    expect(fs.readFileSync(path.join(item.out, 'sentinel'), 'utf8')).toBe('preserved');
  });
  it.each(['corpus-results.json', 'corpus-results.md'])(
    'retains an honest partial bundle on an exclusive %s creation race',
    async (filename) => {
      const item = await fixture(),
        preload = path.join(directory(), 'file-race.cjs'),
        target = path.join(item.out, filename);
      fs.writeFileSync(
        preload,
        `const fs=require('node:fs'),original=fs.openSync;const target=${JSON.stringify(target)};fs.openSync=function(file,flags,...args){if(file===target&&typeof flags==='number'&&(flags&fs.constants.O_CREAT)){const fd=original(file,'wx');try{fs.writeFileSync(fd,'preserved-race');}finally{fs.closeSync(fd);}}return original(file,flags,...args);};`,
      );
      const result = invoke(item, undefined, preload);
      expect(result.status).toBe(6);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('corpus-results: corpus-output-partial\n');
      expect(fs.readFileSync(target, 'utf8')).toBe('preserved-race');
      if (filename === 'corpus-results.md')
        expect(
          JSON.parse(fs.readFileSync(path.join(item.out, 'corpus-results.json'), 'utf8')).scope,
        ).toBe('synthetic-corpus-results');
      else expect(fs.existsSync(path.join(item.out, 'corpus-results.md'))).toBe(false);
    },
  );
  it('retains a partial fresh file and sanitizes an actual output write exception', async () => {
    const item = await fixture(),
      preload = path.join(directory(), 'write-failure.cjs');
    fs.writeFileSync(
      preload,
      `const fs=require('node:fs'),write=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(typeof file==='number'){fs.writeSync(file,'partial');throw Error('private-write-sentinel');}return write(file,...args);};`,
    );
    const result = invoke(item, undefined, preload);
    expect(result.status).toBe(6);
    expect(result.stderr).toBe('corpus-results: corpus-output-partial\n');
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(path.join(item.out, 'corpus-results.json'), 'utf8')).toBe('partial');
  });
  it.each(['bad-date', '2026-02-30'])(
    'refuses invalid as-of labels %s without writing',
    async (asOf) => {
      const item = await fixture(),
        result = invoke(item, ['--run', item.dir, '--as-of', asOf, '--out', item.out]);
      expect(result.status).toBe(3);
      expect(fs.existsSync(item.out)).toBe(false);
    },
  );
  it('rejects duplicate IDs and excessive/unknown options with fixed usage/input codes', async () => {
    const item = await fixture();
    expect(
      invoke(item, [
        '--run',
        item.dir,
        '--run',
        item.dir,
        '--as-of',
        '2026-10-24',
        '--out',
        item.out,
      ]).status,
    ).toBe(3);
    expect(invoke(item, []).status).toBe(2);
    expect(invoke(item, ['--unknown', 'value']).status).toBe(2);
    const tooMany = Array.from({ length: 25 }, () => ['--run', item.dir]).flat();
    expect(invoke(item, [...tooMany, '--as-of', '2026-10-24', '--out', item.out]).status).toBe(2);
    expect(invoke(item, ['--help']).status).toBe(0);
    expect(fs.existsSync(item.out)).toBe(false);
  });
});
