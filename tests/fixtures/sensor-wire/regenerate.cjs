/** Independently prefix literal expected JSON; never import the production codec. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
if (cases.length > 64) throw Error('Fixture manifest limit');
for (const entry of cases) {
  if (!/^[a-z0-9-]+$/.test(entry.name) || entry.json.length > 65536)
    throw Error('Fixture entry limit');
  JSON.parse(entry.json);
  const payload = Buffer.from(entry.json, 'utf8');
  const bytes = Buffer.alloc(4 + payload.length);
  bytes.writeUInt32LE(payload.length, 0);
  payload.copy(bytes, 4);
  fs.writeFileSync(path.join(__dirname, `${entry.name}.bin`), bytes);
}
console.log(`${cases.length} independent sensor/1 binary fixtures written`);
