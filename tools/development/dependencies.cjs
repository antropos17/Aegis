module.exports = {
  forbidden: [
    {
      name: 'renderer-must-not-import-main',
      severity: 'error',
      from: { path: '^(frontend/observatory|src/renderer)/' },
      to: { path: '^src/main/' },
    },
    {
      name: 'shared-must-not-import-process-layers',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^(src/(main|renderer)|frontend/observatory)/' },
    },
    {
      name: 'inspect-cycles',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(reference|node_modules|dist|out|\\.mutants)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.js', '.ts', '.svelte', '.json', '.mjs', '.cjs'] },
  },
};
