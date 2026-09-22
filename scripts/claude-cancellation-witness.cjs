/** TEST ONLY: loaded explicitly by the installed-provider cancellation fixture. */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const execution = require('../src/main/action-execution');
const target = process.env.AEGIS_CANCELLATION_WITNESS;
if (!target) throw Error('fixture-witness-required');
let launches = 0;
let exited = false;
let closed = false;
execution._setDepsForTest({
  spawn(...args) {
    launches++;
    const child = spawn(...args);
    child.once('exit', () => {
      exited = true;
    });
    child.once('close', () => {
      closed = true;
    });
    return child;
  },
});
const execute = execution.executeAction;
execution.executeAction = async (...args) => {
  const result = await execute(...args);
  fs.writeFileSync(
    target,
    JSON.stringify({
      launches,
      exited,
      closed,
      cancelled: result.reason === 'action-cancelled',
      interrupted: result.execution.state === 'interrupted',
      terminationConfirmed: result.execution.termination === 'confirmed',
    }),
  );
  return result;
};
