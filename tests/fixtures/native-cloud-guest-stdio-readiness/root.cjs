'use strict';
const { spawn } = require('node:child_process');
const helper = spawn(process.env.STDIO_FIXTURE_HELPER, ['helper'], { stdio: 'ignore' });
helper.on('error', () => process.exit(125));
helper.on('exit', (code) => {
  if (Number(process.env.AEGIS_STDIO_CASE) < 3) process.exit(code === 0 ? 0 : 125);
});
if (Number(process.env.AEGIS_STDIO_CASE) >= 3) setInterval(() => {}, 1000);
