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
  it('accepts explicit boolean update consent and rejects truthy strings', () => {
    expect(validateSettings({ automaticUpdatesEnabled: true }).valid).toBe(true);
    expect(validateSettings({ automaticUpdatesEnabled: false }).valid).toBe(true);
    expect(validateSettings({ automaticUpdatesEnabled: 'true' }).valid).toBe(false);
  });
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

const { validateFalsePositive, validateCustomAgent, validateWatchEntry } = require(
  settingsValidationPath,
);
const bundledAgents = require('../../src/shared/agent-database.json').agents;
const validAgent = { id: 'custom-agent', displayName: 'My agent', names: ['my-agent.exe'] };
const validWatch = { signature: 'custom-agent', pid: null, reason: '', known: false, addedAt: 1 };
const validFalsePositive = { agentName: 'My agent', pattern: 'safe\\.log$', timestamp: 1 };
const booleanFields = [
  'notificationsEnabled',
  'startMinimized',
  'autoStartWithWindows',
  'automaticUpdatesEnabled',
  'darkMode',
  'ignoreCommonBuildDirs',
  'hardwareAcceleration',
];

describe('settings validation — persisted value contracts', () => {
  it('accepts full valid settings, partial permission maps and the shipped catalog', () => {
    expect(
      validateSettings({
        scanIntervalSec: 10,
        notificationsEnabled: true,
        customSensitivePatterns: ['safe\\.log$'],
        startMinimized: false,
        autoStartWithWindows: false,
        automaticUpdatesEnabled: false,
        anthropicApiKey: '',
        darkMode: false,
        uiScale: 1,
        timelineZoom: 6,
        agentPermissions: { 'Codex::C:\\Project': { filesystem: 'allow', sensitive: 'block' } },
        ignoredDirectories: ['C:\\Build'],
        ignoreCommonBuildDirs: true,
        seenAgents: ['Codex'],
        customAgents: bundledAgents,
        hardwareAcceleration: true,
        falsePositivePatterns: [validFalsePositive],
        watchlist: [validWatch],
      }),
    ).toEqual({ valid: true });
    expect(validateSettings({ customAgents: [validAgent] }).valid).toBe(true);
    expect(validateSettings({ agentPermissions: Object.create(null) }).valid).toBe(true);
  });

  it.each(booleanFields)('rejects truthy strings and null for %s', (key) => {
    for (const value of ['true', 'false', 1, null, undefined]) {
      expect(validateSettings({ [key]: value }).valid).toBe(false);
    }
    expect(validateSettings({ [key]: false }).valid).toBe(true);
  });

  it.each(['scanIntervalSec', 'uiScale', 'timelineZoom'])('rejects non-finite %s', (key) => {
    for (const value of [NaN, Infinity, -Infinity, null, undefined, '1']) {
      expect(validateSettings({ [key]: value }).valid).toBe(false);
    }
  });

  it.each([
    'ignoredDirectories',
    'seenAgents',
    'customSensitivePatterns',
    'customAgents',
    'falsePositivePatterns',
    'watchlist',
  ])('requires an actual %s array', (key) => {
    for (const value of [null, {}, false, 'anything', undefined]) {
      expect(validateSettings({ [key]: value }).valid).toBe(false);
    }
    expect(validateSettings({ [key]: [] }).valid).toBe(true);
    expect(validateSettings({ [key]: new Array(1) }).valid).toBe(false);
  });

  it.each(['ignoredDirectories', 'seenAgents'])('rejects invalid %s members', (key) => {
    for (const value of [123, {}, null, '', '   ']) {
      expect(validateSettings({ [key]: [value] }).valid).toBe(false);
    }
  });

  it('requires API keys to be strings without exposing their value in an error', () => {
    expect(validateSettings({ anthropicApiKey: 'private-value' }).valid).toBe(true);
    expect(validateSettings({ anthropicApiKey: { secret: 'private-value' } })).toEqual({
      valid: false,
      error: 'anthropicApiKey must be a string',
    });
  });

  it('rejects inherited objects and prototype-shaped keys', () => {
    for (const value of [[], new Date(), new Map(), Object.create({ darkMode: true })]) {
      expect(validateSettings(value).valid).toBe(false);
    }
    expect(validateSettings(JSON.parse('{"__proto__":{}}')).valid).toBe(false);
    expect(validateSettings({ [Symbol('hidden')]: true }).valid).toBe(false);
  });

  it('requires nested permission maps with known categories and states', () => {
    for (const value of [
      null,
      [],
      true,
      'allow',
      { Codex: null },
      { Codex: 'allow' },
      { Codex: [] },
      { Codex: { filesystem: 'true' } },
      { Codex: { filesystem: null } },
      { Codex: { nonexistent: 'allow' } },
      { '': {} },
      JSON.parse('{"__proto__":{"filesystem":"allow"}}'),
      { Codex: JSON.parse('{"constructor":"allow"}') },
    ]) {
      expect(validateSettings({ agentPermissions: value }).valid).toBe(false);
    }
    expect(
      validateSettings({
        agentPermissions: {
          Codex: {
            filesystem: 'allow',
            sensitive: 'monitor',
            network: 'block',
            terminal: 'allow',
            clipboard: 'monitor',
            screen: 'block',
          },
        },
      }).valid,
    ).toBe(true);
  });
});

describe('settings validation — catalog signatures', () => {
  it('accepts current custom-agent output, including semantic-token color and empty metadata', () => {
    expect(
      validateCustomAgent({
        ...validAgent,
        category: 'cli-tool',
        riskProfile: 'medium',
        vendor: 'Custom',
        icon: '🔧',
        color: 'var(--md-sys-color-on-surface-variant)',
        description: '',
        website: '',
        defaultTrust: 50,
        knownDomains: [],
        knownPorts: [],
        configPaths: [],
        parentEditors: [],
      }).valid,
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { name: 'old', patterns: ['old'] },
    { ...validAgent, id: 'bad id' },
    { ...validAgent, id: '__proto__' },
    { ...validAgent, displayName: ' ' },
    { ...validAgent, names: [] },
    { ...validAgent, names: [5] },
    { ...validAgent, names: [' '.repeat(3)] },
    { ...validAgent, names: ['x'.repeat(257)] },
    { ...validAgent, website: null },
    { ...validAgent, website: 'javascript:alert(1)' },
    { ...validAgent, category: 'invalid' },
    { ...validAgent, riskProfile: 'invalid' },
    { ...validAgent, defaultTrust: NaN },
    { ...validAgent, defaultTrust: Infinity },
    { ...validAgent, defaultTrust: 101 },
    { ...validAgent, vendor: {} },
    { ...validAgent, knownDomains: null },
    { ...validAgent, configPaths: [false] },
    { ...validAgent, parentEditors: 'code' },
    { ...validAgent, knownPorts: [0] },
    { ...validAgent, knownPorts: [65536] },
    { ...validAgent, knownPorts: ['443'] },
    { ...validAgent, knownPorts: [1.5] },
    { ...validAgent, knownPorts: new Array(1) },
    { ...validAgent, bogus: true },
  ])('rejects malformed signatures %#', (entry) => {
    expect(validateSettings({ customAgents: [entry] }).valid).toBe(false);
  });

  it('rejects duplicate IDs and oversized catalogs before persistence', () => {
    expect(validateSettings({ customAgents: [validAgent, { ...validAgent }] }).valid).toBe(false);
    expect(validateSettings({ customAgents: new Array(2001).fill(validAgent) }).valid).toBe(false);
  });
});

describe('settings validation — suppression and advisory entries', () => {
  it.each([
    null,
    {},
    { ...validFalsePositive, timestamp: NaN },
    { ...validFalsePositive, timestamp: Infinity },
    { ...validFalsePositive, agentName: ' ' },
    { ...validFalsePositive, pattern: '' },
    { ...validFalsePositive, pattern: '.*' },
    { ...validFalsePositive, pattern: 'x'.repeat(257) },
    { ...validFalsePositive, bogus: true },
  ])('rejects malformed false positives %# through both entry and settings APIs', (entry) => {
    expect(validateFalsePositive(entry).valid).toBe(false);
    expect(validateSettings({ falsePositivePatterns: [entry] }).valid).toBe(false);
  });

  it('uses the shared regex safety check for both custom and suppression patterns', () => {
    const previous = mockConfig.isSafeRegex;
    mockConfig.isSafeRegex = () => false;
    try {
      expect(validateSettings({ customSensitivePatterns: ['(a+)+'] }).valid).toBe(false);
      expect(validateFalsePositive({ ...validFalsePositive, pattern: '(a+)+' }).valid).toBe(false);
    } finally {
      mockConfig.isSafeRegex = previous;
    }
  });

  it.each([
    null,
    {},
    { ...validWatch, signature: ' ' },
    { ...validWatch, pid: 0 },
    { ...validWatch, pid: -1 },
    { ...validWatch, pid: 1.2 },
    { ...validWatch, pid: '123' },
    { ...validWatch, pid: NaN },
    { ...validWatch, pid: Infinity },
    { ...validWatch, known: 'false' },
    { ...validWatch, reason: null },
    { ...validWatch, addedAt: NaN },
    { ...validWatch, addedAt: Infinity },
    { ...validWatch, addedAt: 0 },
    { ...validWatch, bogus: true },
  ])('rejects malformed watch entries %#', (entry) => {
    expect(validateWatchEntry(entry).valid).toBe(false);
    expect(validateSettings({ watchlist: [entry] }).valid).toBe(false);
  });

  it('accepts both process-specific and any-PID advisory entries', () => {
    expect(validateWatchEntry(validWatch).valid).toBe(true);
    expect(
      validateWatchEntry({ ...validWatch, pid: 123, known: true, reason: 'Review' }).valid,
    ).toBe(true);
  });
});
