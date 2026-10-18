import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { etwRecoveryPassed } from './etw-package.mjs';
import { etwFailuresPassed } from './etw-failure-contract.mjs';
import { etwDualPassed } from './etw-dual-contract.mjs';
import { etwTotalPassed } from './etw-total-contract.mjs';
import { etwGroupPassed } from './etw-group-contract.mjs';
import { etwOrphanPassed } from './etw-orphan-contract.mjs';
import { etwDurablePassed } from './etw-durable-contract.mjs';

/** Run one selected ETW profile against the actual package and bind its receipt.
 * @param {string} root @param {string} output @param {string} candidate
 * @param {Function} command Bounded owner runner. @param {boolean} failures
 * @param {boolean} dual Include the four simultaneous-loss cases.
 * @param {boolean} total Include the five all-helper-loss cases.
 * @param {boolean} group Include five broker-plus-helper-loss cases with main custody.
 * @param {boolean} orphan Include original-main loss and custodian-only loss cases.
 * @param {boolean} durable Include four all-six-loss/relaunch cases and a live-owner rejection.
 * @returns {Promise<object>} Receipt and SHA256. @since v0.19.2
 */
export async function qualifyEtw(
  root,
  output,
  candidate,
  command,
  failures,
  dual = false,
  total = false,
  group = false,
  orphan = false,
  durable = false,
) {
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
      ...(durable
        ? ['--durable']
        : orphan
          ? ['--orphan']
          : group
            ? ['--group']
            : total
              ? ['--total']
              : dual
                ? ['--dual']
                : []),
    ],
    durable
      ? 2400000
      : orphan
        ? 2400000
        : group
          ? 1920000
          : total
            ? 1500000
            : dual
              ? 1200000
              : failures
                ? 900000
                : 420000,
  );
  const file = path.join(output, 'etw/receipt.json');
  if (fs.statSync(file).size > 262144) throw new Error('ETW receipt too large');
  const bytes = fs.readFileSync(file),
    etw = JSON.parse(bytes);
  if (
    !(durable
      ? etwDurablePassed(etw)
      : orphan
        ? etwOrphanPassed(etw)
        : group
          ? etwGroupPassed(etw)
          : total
            ? etwTotalPassed(etw)
            : dual
              ? etwDualPassed(etw)
              : failures
                ? etwFailuresPassed(etw)
                : etwRecoveryPassed(etw))
  )
    throw new Error('Packaged ETW profile incomplete');
  return { etw, etwReceiptSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
