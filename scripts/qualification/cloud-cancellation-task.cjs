'use strict';

// Administrator-owned fixed test payload. No project path or command input.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
fs.writeFileSync('C:\\AegisLab\\work\\cancellation\\released.txt', 'fixed-cancellation-payload', {
  flag: 'wx',
});
const child = spawn(
  process.execPath,
  ['C:\\ProgramData\\AegisCloudLab\\trusted\\cloud-cancellation-child.cjs'],
  { stdio: 'ignore', windowsHide: true },
);
child.on('error', () => process.exit(124));
setTimeout(() => process.exit(125), 20000);
