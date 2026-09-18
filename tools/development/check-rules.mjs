import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import config from './dependencies.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parent = path.join(root, 'out/development');
fs.mkdirSync(parent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(parent, 'boundary-test-'));
const previous = process.cwd();
try {
  for (const folder of ['src/renderer', 'src/main', 'src/shared'])
    fs.mkdirSync(path.join(fixture, folder), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src/main/secret.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(fixture, 'src/renderer/view.js'), "require('../main/secret');");
  fs.writeFileSync(path.join(fixture, 'src/shared/leak.js'), "require('../main/secret');");
  process.chdir(fixture);
  const invalid = await cruise(['src'], { ...config.options, validate: true, ruleSet: config });
  const report = typeof invalid.output === 'string' ? JSON.parse(invalid.output) : invalid.output;
  assert.deepEqual(
    new Set(report.summary.violations.map((v) => v.rule.name)),
    new Set(['renderer-must-not-import-main', 'shared-must-not-import-process-layers']),
    JSON.stringify(report),
  );
  assert.equal(report.summary.error, 2);
  fs.writeFileSync(path.join(fixture, 'src/shared/leak.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(fixture, 'src/renderer/view.js'), "require('../shared/leak');");
  const valid = await cruise(['src'], { ...config.options, validate: true, ruleSet: config });
  const clean = typeof valid.output === 'string' ? JSON.parse(valid.output) : valid.output;
  assert.equal(clean.summary.error, 0);
  console.log(
    'Dependency boundaries: two forbidden imports rejected; allowed shared import accepted.',
  );
} finally {
  process.chdir(previous);
  // Only the exact directory returned by mkdtemp; no links or user files are created here.
  assert.equal(path.dirname(fixture), parent);
  fs.rmSync(fixture, { recursive: true, force: true });
}
