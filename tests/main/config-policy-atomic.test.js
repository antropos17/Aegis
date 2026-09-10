import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../../src/main/config-manager.js';

it('merges global and project policy writes against latest canonical state without stale map replacement', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-policy-atomic-'));
  const file = path.join(directory, 'settings.json');
  config._setSettingsPathForTest(file);
  try {
    config.loadSettings();
    const first = { network: 'block' };
    const second = { network: 'allow' };
    config.saveInstancePermissions('Codex', 'X:/two::nested', second, null);
    config.saveInstancePermissions('Codex', null, first, 'X:/one');
    config.saveInstancePermissions('Codex', null, { filesystem: 'monitor' }, null);
    config.loadSettings();
    expect(config.getSettings().agentPermissions).toEqual({
      'Codex::X:/two::nested': second,
      'Codex::X:/one': first,
      Codex: { filesystem: 'monitor' },
    });
  } finally {
    config._setSettingsPathForTest(null);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
