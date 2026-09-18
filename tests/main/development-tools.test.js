import { describe, expect, it } from 'vitest';
import { sourceFacts, coverageScope, localImport } from '../../tools/development/source-facts.mjs';
import { renderMap } from '../../tools/development/render-map.mjs';

describe('development source inventory', () => {
  it('reads real TS directives rather than matching instruction strings in code', () => {
    expect(sourceFacts('// @ts-check\nconst x = 1;', 'x.js').checkJs).toBe(true);
    expect(sourceFacts('// @ts-nocheck\nconst x = 1;', 'x.js').checkJs).toBe(false);
    expect(sourceFacts('const example = "@ts-check";', 'x.js').checkJs).toBe(null);
  });
  it('ignores comments, preserves static IPC and reports computed channels as unresolved', () => {
    const facts = sourceFacts(
      `// ipcMain.handle('fake', cb)
ipcMain.handle('real', cb);
ipcRenderer.invoke(channel);
require('./helper');
import('./lazy.js');
require(platformPath);`,
      'src/main/example.js',
    );
    expect(facts.ipc.map((x) => x.channel)).toEqual(['real']);
    expect(facts.ipc[0].line).toBe(2);
    expect(facts.dynamic.map((x) => x.kind)).toEqual(['ipcRenderer.invoke', 'import']);
    expect(facts.imports).toEqual(['./helper', './lazy.js']);
  });
  it('does not confuse test include globs with coverage scope or silently accept spreads', () => {
    const result = coverageScope(`export default { test: { include: ['tests/**'] },
      coverage: { include: ['src/main/**', ...extra], exclude: ['src/main/generated/**'] } };`);
    expect(result.include).toEqual(['src/main/**']);
    expect(result.exclude).toEqual(['src/main/generated/**']);
    expect(result.unresolved).toBe(true);
    expect(coverageScope('export default {}').unresolved).toBe(true);
  });
  it('resolves relative imports only against the actual inventory', () => {
    const files = new Set(['src/main/platform/index.js']);
    expect(localImport('src/main/main.js', './platform', files)).toBe('src/main/platform/index.js');
    expect(localImport('src/main/main.js', './missing', files)).toBe(null);
    expect(localImport('src/main/main.js', 'fs', files)).toBe(null);
  });
  it('escapes imported data so a path cannot close the embedded JSON script', () => {
    const context = {
      metadata: { commit: 'abc' },
      modules: [{ file: '</script><script>bad()</script>' }],
    };
    const output = renderMap(context, { modules: [], summary: { violations: [] } });
    expect(output.html).not.toContain('</script><script>bad()');
    expect(output.html).toContain('\\u003c/script>');
  });
});
