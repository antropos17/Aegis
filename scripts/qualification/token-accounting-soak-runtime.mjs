/** Packaged-main callback. No imports: Playwright serializes this function. */
export async function packagedStep({ app }, config) {
  const path = process.getBuiltinModule('node:path');
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  if (!app.isPackaged) throw Error('packaged-required');
  if (path.resolve(app.getPath('userData')) !== path.resolve(config.profile))
    throw Error('profile-isolation-failed');
  if (path.resolve(os.homedir()) !== path.resolve(config.home))
    throw Error('home-isolation-failed');
  if (!globalThis.__tokenSoak) {
    // A separate CommonJS cache prevents test seams from changing the live app.
    // Source bytes come from the actual package, never from the working tree.
    const { createRequire } = process.getBuiltinModule('node:module');
    const vm = process.getBuiltinModule('node:vm');
    const sourceRoot = path.join(app.getAppPath(), 'src', 'main');
    const cache = new Map();
    function load(file) {
      if (cache.has(file)) return cache.get(file).exports;
      const native = createRequire(file);
      const module = { exports: {} };
      cache.set(file, module);
      const localRequire = (name) => {
        const resolved = native.resolve(name);
        return resolved.startsWith(sourceRoot + path.sep) && resolved.endsWith('.js')
          ? load(resolved)
          : native(name);
      };
      const body = vm.runInThisContext(
        '(function(require,module,exports,__filename,__dirname){' +
          fs.readFileSync(file, 'utf8') +
          '\n})',
        { filename: file },
      );
      body(localRequire, module, module.exports, file, path.dirname(file));
      return module.exports;
    }
    const adapter = load(path.join(sourceRoot, 'token-adapters', 'claude-code.js'));
    const tracker = load(path.join(sourceRoot, 'token-tracker.js'));
    const { createLedger } = load(path.join(sourceRoot, 'token-dedup-ledger.js'));
    adapter._setHomedirForTest(() => config.home);
    adapter._setLedgerFactoryForTest(() => createLedger({ file: config.ledger }));
    globalThis.__tokenSoak = { adapter, tracker };
  }
  const { adapter, tracker } = globalThis.__tokenSoak;
  const baseline = adapter.getHistoricalUsage();
  if (baseline) tracker.restoreHistoricalUsage({ ...baseline, adapter: adapter.id });
  const deltas = await adapter.readUsage(config.procs);
  for (const delta of deltas) {
    const proc = config.procs.find((candidate) => candidate.pid === delta.pid);
    tracker.trackTokens(proc, delta);
  }
  const rows = tracker.getAllCosts();
  const collection = adapter.getCollectionStatus();
  let ledgerBytes = 0;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      const info = fs.lstatSync(config.ledger + suffix);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('ledger-path-refused');
      ledgerBytes += info.size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    rowCount: rows.length,
    collection: collection.state,
    collectionReason: ['capacity', 'unavailable'].includes(collection.reason)
      ? collection.reason
      : collection.reason === null
        ? null
        : 'unknown',
    collectionRetryAt: Number.isFinite(collection.retryAt) ? collection.retryAt : null,
    ledgerBytes,
    ledgerLimitBytes: 128 * 1024 ** 2,
    identities: config.procs.map((proc, slot) => {
      const row = tracker.getCost(proc);
      return { slot, inputTokens: row.inputTokens, outputTokens: row.outputTokens };
    }),
    memory: process.memoryUsage().rss,
  };
}
