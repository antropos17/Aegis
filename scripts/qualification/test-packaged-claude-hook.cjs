'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPackage } = require('@electron/asar');
const { assertArchivedProfileSourcesMatch } = require('./packaged-claude-hook.cjs');

test('compares packaged profile sources with a real ASAR using native paths', async (context) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-packaged-hook-test-'));
  context.after(async () => fs.rm(scratch, { recursive: true, force: true }));
  const source = path.join(scratch, 'source');
  const main = path.join(source, 'src', 'main');
  await fs.mkdir(main, { recursive: true });
  await fs.writeFile(path.join(main, 'claude-hook-app-profile.js'), 'module.exports = 1;\n');
  await fs.writeFile(path.join(main, 'action-policy.js'), 'module.exports = 2;\n');
  const archive = path.join(scratch, 'app.asar');
  await createPackage(source, archive);

  await assertArchivedProfileSourcesMatch(archive, source);
  await fs.writeFile(path.join(main, 'claude-hook-app-profile.js'), 'module.exports = 3;\n');
  await assert.rejects(assertArchivedProfileSourcesMatch(archive, source), {
    code: 'ERR_ASSERTION',
  });
});
