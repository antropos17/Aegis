import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import config from './dependencies.cjs';
import { renderMap } from './render-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
execFileSync(process.execPath, ['tools/development/context.mjs'], { cwd: root, stdio: 'pipe' });
const result = await cruise(['src', 'frontend/observatory', 'tests'], {
  ...config.options,
  validate: true,
  ruleSet: config,
});
const graph = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
const context = JSON.parse(fs.readFileSync('out/development/context.json', 'utf8'));
fs.writeFileSync(
  'out/development/dependencies.json',
  JSON.stringify({ metadata: context.metadata, ...graph }, null, 2) + '\n',
);
const { html, mermaid } = renderMap(context, graph);
fs.writeFileSync('out/development/map.html', html);
fs.writeFileSync('out/development/architecture.mmd', mermaid);
console.log(
  `Map: out/development/map.html\nModules: ${graph.modules.length}\nErrors: ${graph.summary.error}; warnings: ${graph.summary.warn}`,
);
if (graph.summary.error > 0) process.exitCode = 1;
