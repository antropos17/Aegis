import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const audit = require('../../src/main/audit-logger');
const { logGatewayEvidence } = require('../../src/main/enforcement-evidence-audit');
const { verifyChain } = require('../../src/main/audit-hashchain');
/** Execute the actual logger only inside this disposable child, never the user application.
 * @param {object} input Exact generated owner records. @returns {Promise<object>} Metadata and retained records. @since v0.17.0 */
async function run(input) {
  const root = fs.realpathSync(input.root),
    parent = fs.realpathSync(process.env.TEMP);
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith('aegis-evidence-') ||
    fs.lstatSync(root).isSymbolicLink() ||
    !Array.isArray(input.records) ||
    input.records.length > 256 ||
    !['normal', 'eviction', 'recovery', 'fresh'].includes(input.mode)
  )
    throw Error('audit-fixture-boundary');
  const userDataPath = path.join(root, 'audit');
  audit.init({
    userDataPath,
    loadSqlite: () => null,
    bufferCap: input.mode === 'eviction' ? 2 : 8,
  });
  let failedAppend = false,
    copied,
    restore;
  try {
    await audit._awaitIndexForTest();
    for (const event of input.records) {
      const source = { ...event };
      logGatewayEvidence(audit, source);
      source.code = 'MUTATED';
    }
    if (input.mode === 'recovery') {
      const original = fs.appendFileSync;
      fs.appendFileSync = function (target, ...args) {
        if (path.dirname(target) === path.join(userDataPath, 'audit-logs'))
          throw Object.assign(Error('fixture-append'), { code: 'ENOSPC' });
        return original.call(fs, target, ...args);
      };
      restore = () => {
        fs.appendFileSync = original;
      };
      audit.flush();
      failedAppend = audit.getDeliveryStatus().writeFailed;
      restore();
      restore = undefined;
    }
    audit.flush();
    const records = audit.exportAll(),
      status = audit.getDeliveryStatus(),
      stats = audit.getStats();
    copied = records
      .filter((e) => e.type === 'gateway-evidence')
      .every((e) => e.details.code !== 'MUTATED');
    const logs = fs
      .readdirSync(path.join(userDataPath, 'audit-logs'))
      .filter((n) => /^aegis-audit-.*\.json$/.test(n));
    const chainValid =
      logs.length === 1 && verifyChain(path.join(userDataPath, 'audit-logs', logs[0])).valid;
    const original = fs.readFileSync(path.join(userDataPath, 'audit-logs', logs[0]));
    const lines = original.toString('utf8').trimEnd().split('\n');
    const prefix = path.join(root, 'valid-prefix.json');
    fs.writeFileSync(prefix, lines.slice(0, -1).join('\n') + '\n', { flag: 'wx' });
    return {
      mode: input.mode,
      status,
      totalEntries: stats.totalEntries,
      chainValid,
      validPrefix: verifyChain(prefix).valid,
      copied,
      failedAppend,
      records: records.filter((e) => e.type === 'gateway-evidence').map((e) => e.details),
    };
  } finally {
    restore?.();
    audit.shutdown();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    let count = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      count += chunk.length;
      if (count > 131072) throw Error('input-bound');
      chunks.push(chunk);
    }
    const value = await run(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    process.stdout.write(JSON.stringify(value) + '\n');
  } catch {
    process.stdout.write('{"error":"audit-fixture-unavailable"}\n');
    process.exitCode = 2;
  }
}
