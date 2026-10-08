'use strict';

// Only the native owner supplies the expected SID. This fixed task cannot admit itself.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const trusted = 'C:\\ProgramData\\AegisCloudLab\\trusted';
const sid = process.env.AEGIS_OWNER_LIFETIME_EXPECTED_SID;
if (
  process.platform !== 'win32' ||
  process.env.AEGIS_CLOUD_GUEST_TASK !== '1' ||
  !/^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/.test(sid || '')
)
  process.exit(121);
const value = spawnSync(
  trusted + '\\guest-owner-lifetime.exe',
  ['--guest-all', trusted + '\\node.exe', trusted, sid],
  {
    cwd: 'C:\\AegisLab\\scratch',
    env: process.env,
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 16384,
  },
);
const output = value.stdout || Buffer.alloc(0);
if (
  value.error ||
  value.status !== 0 ||
  value.signal !== null ||
  (value.stderr?.length || 0) !== 0 ||
  output.length < 2 ||
  output.length > 16384 ||
  output.toString('utf8').trimEnd().split(/\r?\n/).length !== 2
)
  process.exit(122);
// The owner reads this fixed receipt after the native outer Job and private desktop confirm closure.
fs.writeFileSync('C:\\AegisLab\\work\\owner-lifetime-result.jsonl', output, { flag: 'wx' });
