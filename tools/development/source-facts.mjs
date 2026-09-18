import ts from 'typescript';
import path from 'node:path';

/** Extract literal IPC edges and imports; expressions remain explicitly unresolved.
 * @param {string} source @param {string} filename
 * @returns {{ipc: object[], imports: string[], dynamic: object[], checkJs: boolean|null}} @since v0.15.0
 */
export function sourceFacts(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const ipc = [];
  const imports = [];
  const dynamic = [];
  function visit(node) {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const target = node.expression.getText(tree);
      const arg = node.arguments[0];
      const literal = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg));
      if (target === 'require' || target === 'import') {
        if (literal) imports.push(arg.text);
        else dynamic.push({ kind: 'import', file: filename, line });
      }
      if (/^(ipcRenderer\.(invoke|on|once|send)|ipcMain\.(handle|on|once))$/.test(target)) {
        if (literal) ipc.push({ kind: target, channel: arg.text, file: filename, line });
        else dynamic.push({ kind: target, file: filename, line });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return {
    ipc,
    imports: [...new Set(imports)],
    dynamic,
    checkJs: tree.checkJsDirective?.enabled ?? null,
  };
}

/** Read the coverage include/exclude literals without executing Vitest configuration.
 * @param {string} source @returns {{include: string[], exclude: string[], unresolved: boolean}}
 * @since v0.15.0
 */
export function coverageScope(source) {
  const tree = ts.createSourceFile('vitest.config.js', source, ts.ScriptTarget.Latest, true);
  const result = { include: [], exclude: [], unresolved: false };
  let found = false;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'coverage') {
      found = true;
      if (!ts.isObjectLiteralExpression(node.initializer)) result.unresolved = true;
      else
        for (const prop of node.initializer.properties) {
          if (ts.isSpreadAssignment(prop)) result.unresolved = true;
          const key = prop.name?.getText(tree).replaceAll(/['"]/g, '');
          if (!['include', 'exclude'].includes(key)) continue;
          if (!ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer)) {
            result.unresolved = true;
            continue;
          }
          for (const item of prop.initializer.elements) {
            if (ts.isStringLiteral(item)) result[key].push(item.text);
            else result.unresolved = true;
          }
        }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!found || !result.include.length) result.unresolved = true;
  return result;
}

/** Resolve only relative repository imports; no execution or external package lookup.
 * @param {string} from @param {string} specifier @param {Set<string>} files
 * @returns {string|null} @since v0.15.0
 */
export function localImport(from, specifier, files) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return (
    [
      base,
      ...['.js', '.ts', '.svelte', '.mjs', '.cjs'].map((ext) => base + ext),
      ...['js', 'ts'].map((ext) => `${base}/index.${ext}`),
    ].find((file) => files.has(file)) ?? null
  );
}
