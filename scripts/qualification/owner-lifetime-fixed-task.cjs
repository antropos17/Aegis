'use strict';

// Fixed disposable payload. After readiness neither process spawns again.
const { spawn } = require('node:child_process');
if (process.argv[2] === '--descendant') {
  setTimeout(() => process.exit(126), 20000);
} else if (process.argv.length === 2) {
  const child = spawn(process.execPath, [__filename, '--descendant'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', () => process.exit(124));
  setTimeout(() => process.exit(125), 20000);
} else {
  process.exit(122);
}
