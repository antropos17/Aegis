import fs from 'node:fs';
import path from 'node:path';
import { boundedCommand } from '../../../tools/development/bounded-command.mjs';
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const [name, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || '') || !args.length) throw Error('invalid-run-input');
fs.mkdirSync(`${report}/temp`, { recursive: true });
const result = await boundedCommand(process.execPath, args, {
  cwd: process.cwd(),
  env: { ...process.env, TEMP: `${report}/temp`, TMP: `${report}/temp` },
  log: path.join(report, `${name}.log`),
  timeoutMs: 300000,
  maxBytes: 2 * 1024 * 1024,
});
const receipt = { checkedAt: new Date().toISOString(), node: process.version, args, ...result };
fs.writeFileSync(path.join(report, `${name}.json`), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
if (result.code !== 0 || result.reason !== null) process.exitCode = 1;
