'use strict';

const { spawn } = require('node:child_process');
const prefix = process.env.AEGIS_STDIO_PREFIX;
const owner = process.env.AEGIS_STDIO_OWNER_PID;
const kind = process.env.AEGIS_STDIO_CASE;
if (process.env.AEGIS_CLOUD_GUEST_TASK !== '1' ||
    !/^aegis-guest-stdio-[a-f0-9]{32}$/.test(prefix || '') ||
    !/^[1-9][0-9]{0,9}$/.test(owner || '') || Number(owner) > 4294967295 ||
    !/^[1-5]$/.test(kind || '')) process.exit(125);
// Called only by the fixed authenticated runtime after R ACK. Paths/commands never come from a wire.
const child = spawn('C:\\ProgramData\\AegisCloudLab\\trusted\\guest-stdio.exe', [], {
  cwd: 'C:\\AegisLab\\work', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
});
child.on('error', () => { if (Number(kind) <= 2) process.exit(125); });
child.on('exit', (code, signal) => {
  if (Number(kind) <= 2) process.exit(signal === null && code === 0 ? 0 : 125);
});
if (Number(kind) >= 3) setInterval(() => {}, 1000);
