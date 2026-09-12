/** @file Logs child exit codes during hosted qualification without logging arguments or environment. */
'use strict';

const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const originalFork = childProcess.fork;
childProcess.fork = function (...args) {
  const child = originalFork.apply(this, args);
  child.on('exit', (code, signal) => {
    if (code !== 0) console.error('[qualification child exit]', JSON.stringify({ code, signal }));
  });
  return child;
};
syncBuiltinESMExports();
