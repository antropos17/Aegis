import { describe, it, expect, afterAll } from 'vitest';
import Module from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// settings-validation.js requires ./config-manager only for isSafeRegex.
// Intercept that require (gated on the settings-validation parent) so the real
// config-manager — and its electron dependency — never loads in this unit test.
const configPath = path.resolve(__dirname, '../../src/main/config-manager.js');
const settingsValidationPath = path.resolve(__dirname, '../../src/main/settings-validation.js');

const mockConfig = { isSafeRegex: () => true };

const originalLoad = Module._load;
Module._load = function (request, parent, _isMain) {
  if (parent && parent.filename === settingsValidationPath) {
    const resolved = path.resolve(path.dirname(settingsValidationPath), request);
    if (resolved === configPath.replace(/\.js$/, '') || resolved + '.js' === configPath)
      return mockConfig;
  }
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

const { validateSettings } = require(settingsValidationPath);

describe('settings-validation — validateSettings reject branches', () => {
  it('rejects null (not a plain object)', () => {
    expect(validateSettings(null)).toEqual({
      valid: false,
      error: 'Settings must be a plain object',
    });
  });

  it('rejects unknown keys', () => {
    expect(validateSettings({ bogus: 1 })).toEqual({
      valid: false,
      error: 'Unknown settings keys: bogus',
    });
  });

  it('rejects non-positive scanIntervalSec', () => {
    expect(validateSettings({ scanIntervalSec: 0 })).toEqual({
      valid: false,
      error: 'scanIntervalSec must be a positive number',
    });
  });

  it('rejects out-of-range uiScale', () => {
    expect(validateSettings({ uiScale: 5 })).toEqual({
      valid: false,
      error: 'uiScale must be a number between 0.5 and 3',
    });
  });

  it('rejects non-string custom sensitive pattern', () => {
    expect(validateSettings({ customSensitivePatterns: [123] })).toEqual({
      valid: false,
      error: 'Each custom pattern must be a string',
    });
  });

  it('rejects out-of-range timelineZoom', () => {
    expect(validateSettings({ timelineZoom: 99 })).toEqual({
      valid: false,
      error: 'timelineZoom must be a number between 1 and 24',
    });
  });
});
