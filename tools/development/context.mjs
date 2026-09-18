import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { coverageScope, localImport, sourceFacts } from './source-facts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const files = [
  ...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')),
]
  .filter((file) => /^(src|frontend\/observatory|tests)\//.test(file))
  .filter(
    (file) => /\.(js|ts|svelte|mjs|cjs)$/.test(file) && !/(^|\/)(reference|\.mutants)\//.test(file),
  )
  .filter(
    (file) =>
      fs.existsSync(path.join(root, file)) && !fs.lstatSync(path.join(root, file)).isSymbolicLink(),
  )
  .sort();
const fileSet = new Set(files);
const coverage = coverageScope(read('vitest.config.js'));
const digest = createHash('sha256');
const facts = new Map();
const ipc = [];
const dynamic = [];
for (const file of files) {
  const source = read(file);
  digest.update(file).update('\0').update(source).update('\0');
  // Svelte templates are deliberately outside this JS/TS syntax collector.
  const fact = file.endsWith('.svelte')
    ? { imports: [], ipc: [], dynamic: [] }
    : sourceFacts(source, file);
  facts.set(file, { ...fact, lines: source.split('\n').length });
  ipc.push(...fact.ipc);
  dynamic.push(...fact.dynamic);
}
const configs = [
  'tsconfig.main.json',
  'tsconfig.renderer.json',
  'frontend/observatory/tsconfig.json',
];
const typeScopes = configs
  .filter((file) => fs.existsSync(path.join(root, file)))
  .map((file) => {
    const config = ts.readConfigFile(path.join(root, file), ts.sys.readFile);
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(path.join(root, file)),
    );
    if (parsed.errors.length)
      throw new Error(
        parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'),
      );
    return {
      file,
      checkJs: parsed.options.checkJs === true,
      files: new Set(parsed.fileNames.map((f) => path.relative(root, f).replaceAll('\\', '/'))),
    };
  });
for (const file of ['package.json', 'vitest.config.js', 'tsconfig.base.json', ...configs]) {
  if (fs.existsSync(path.join(root, file))) digest.update(file).update(read(file));
}
const directTests = new Map();
for (const [file, fact] of facts)
  if (/\.test\.[jt]s$/.test(file)) {
    for (const specifier of fact.imports) {
      const target = localImport(file, specifier, fileSet);
      if (!target) continue;
      if (!directTests.has(target)) directTests.set(target, []);
      directTests.get(target).push(file);
    }
  }
const modules = files
  .filter((file) => !file.startsWith('tests/'))
  .map((file) => {
    const fact = facts.get(file);
    const scopes = typeScopes.filter((scope) => scope.files.has(file));
    const javascript = /\.[cm]?js$/.test(file);
    return {
      file,
      lines: fact.lines,
      typecheck: file.endsWith('.svelte')
        ? 'svelte-check (separate command)'
        : scopes.length === 0
          ? 'outside configured TS projects'
          : fact.checkJs === false
            ? 'disabled by @ts-nocheck'
            : javascript && fact.checkJs !== true && !scopes.some((scope) => scope.checkJs)
              ? 'JS bodies unchecked by default'
              : 'included in typecheck',
      coverage: coverage.unresolved
        ? 'unknown configuration'
        : coverage.include.some((glob) => path.matchesGlob(file, glob)) &&
            !coverage.exclude.some((glob) => path.matchesGlob(file, glob))
          ? 'instrumented; execution not measured here'
          : 'outside explicit coverage scope',
      directTests: directTests.get(file) ?? [],
    };
  });
const metadata = {
  commit: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  generated: new Date().toISOString(),
  sourceDigest: digest.digest('hex'),
  dirty: Boolean(git('status', '--porcelain')),
  version: pkg.version,
};
const output = path.join(root, 'out/development');
fs.mkdirSync(output, { recursive: true });
const report = {
  metadata,
  modules,
  ipc,
  dynamic,
  coverage,
  limitations: [
    'Static literal IPC calls only; aliases, wrappers, senders and runtime DI need review.',
    'Direct test imports are navigation hints, not proof of coverage or absence of tests.',
    'Svelte syntax edges are not collected; svelte-check is separate. No tests were executed.',
  ],
};
fs.writeFileSync(path.join(output, 'context.json'), JSON.stringify(report, null, 2) + '\n');
const largest = [...modules].sort((a, b) => b.lines - a.lines).slice(0, 8);
const text =
  `# AEGIS development context\n\nCommit: ${metadata.commit}\nBranch: ${metadata.branch}\nGenerated: ${metadata.generated}\nDirty: ${metadata.dirty}\nSource digest: ${metadata.sourceDigest}\nVersion: ${pkg.version}\n\n` +
  `## Entry points\n\n- Main: ${pkg.main}\n- Renderer build: ${pkg.scripts['build:renderer']}\n- Typecheck: ${pkg.scripts.typecheck}\n- Svelte: ${pkg.scripts['typecheck:svelte']}\n\n` +
  `## Navigation\n\n${largest.map((m) => `- ${m.file}: ${m.lines} lines; ${m.typecheck}`).join('\n')}\n\n` +
  `## Verification boundaries\n\n${typeScopes.map((c) => `- ${c.file}: checkJs=${c.checkJs}`).join('\n')}\n` +
  `- Coverage patterns: ${coverage.include.length}; unresolved configuration: ${coverage.unresolved}. This is configuration, not measured coverage.\n` +
  `- Machine-readable module and IPC inventory: out/development/context.json\n- Workflow and check selection: docs/development/workflow.md\n` +
  `- Historical context: search memory-bank/progress.md for the relevant module; read its final handoff only when needed.\n\n## Limits\n\n${report.limitations.map((x) => `- ${x}`).join('\n')}\n`;
fs.writeFileSync(path.join(output, 'context.md'), text);
console.log(text);
