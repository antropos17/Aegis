import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { etwRecoveryPassed } from './etw-package.mjs';
import { etwFailuresPassed } from './etw-failure-contract.mjs';

/** Run one selected ETW profile against the actual package and bind its receipt.
 * @param {string} root @param {string} output @param {string} candidate
 * @param {Function} command Bounded owner runner. @param {boolean} failures
 * @returns {Promise<object>} Receipt and SHA256. @since v0.19.2
 */
export async function qualifyEtw(root, output, candidate, command, failures) {
  await command(
    'etw',
    process.execPath,
    [
      path.join(
        root,
        failures
          ? 'frontend/observatory/tests/etw-failures-electron.mjs'
          : 'frontend/observatory/tests/etw-electron.mjs',
      ),
      '--executable',
      path.join(candidate, 'AEGIS - AI Monitoring & Threat Detection.exe'),
      '--output',
      path.join(output, 'etw'),
    ],
    failures ? 900000 : 420000,
  );
  const file = path.join(output, 'etw/receipt.json');
  if (fs.statSync(file).size > 262144) throw new Error('ETW receipt too large');
  const bytes = fs.readFileSync(file),
    etw = JSON.parse(bytes);
  if (!(failures ? etwFailuresPassed(etw) : etwRecoveryPassed(etw)))
    throw new Error('Packaged ETW profile incomplete');
  return { etw, etwReceiptSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
