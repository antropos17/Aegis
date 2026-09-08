import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import database from '../../src/shared/agent-database.json';
import scanner from '../../src/main/process-scanner.js';
import ruleLoader from '../../src/main/rule-loader.js';

const RULES_DIR = path.resolve(__dirname, '../../rules');
// Independent expectations: deleting an alias from the database must fail a test.
const ALIASES = ['openclaw', 'moltbot', 'clawdbot', 'molty'];

describe('OpenClaw detection contract (#75)', () => {
  beforeEach(() => {
    scanner._resetForTest();
  });

  afterEach(() => {
    scanner._resetForTest();
  });

  it('keeps the canonical entry, legacy aliases, gateway port and config paths together', () => {
    const entries = database.agents.filter((a) => a.id === 'openclaw');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      displayName: 'OpenClaw',
      names: expect.arrayContaining(ALIASES),
      knownPorts: expect.arrayContaining([18789]),
      configPaths: expect.arrayContaining(['~/.openclaw/', '~/.openclaw/config', '~/.moltbot/']),
    });
    for (const alias of ALIASES) {
      expect(database.agents.filter((a) => a.names.includes(alias)).map((a) => a.id)).toEqual([
        'openclaw',
      ]);
    }
  });

  it.each(ALIASES)('resolves the %s process alias to OpenClaw', async (name) => {
    scanner._setPlatformForTest({
      providesStartTime: false,
      listProcesses: async () => [{ name, pid: 4242 }],
    });
    const result = await scanner.scanProcesses();
    expect(result.reliable).toBe(true);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({ agent: 'OpenClaw', pid: 4242 });
  });

  it('does not classify lookalike executable names as OpenClaw', async () => {
    scanner._setPlatformForTest({
      providesStartTime: false,
      listProcesses: async () => [
        { name: 'notopenclaw', pid: 4242 },
        { name: 'moltbot-helper', pid: 4243 },
      ],
    });
    expect((await scanner.scanProcesses()).agents).toEqual([]);
  });

  it.each([
    ['AI013', '.openclaw', 'settings.json', 'AI agent config — OpenClaw'],
    ['AI034', '.moltbot', 'settings.json', 'AI agent config — OpenClaw (legacy Moltbot)'],
    ['AI035', '.openclaw', 'config.yaml', 'AI agent config — OpenClaw'],
  ])(
    '%s matches Windows/POSIX config paths without matching sibling directories',
    (id, dir, file, reason) => {
      const loaded = ruleLoader.reloadRules(RULES_DIR).get(id);
      expect(loaded).toBeDefined();
      expect(loaded.reason).toBe(reason);
      for (const separator of ['/', '\\']) {
        const prefix = separator === '/' ? '/home/test' : 'C:\\Users\\test';
        expect(loaded.pattern.test([prefix, dir, file].join(separator))).toBe(true);
        expect(loaded.pattern.test([prefix, `${dir}-backup`, file].join(separator))).toBe(false);
      }
      if (id === 'AI035') {
        expect(loaded.pattern.test('/home/test/.openclaw/config.yaml.bak')).toBe(false);
        expect(loaded.pattern.test('C:\\Users\\test\\.openclaw\\other.yaml')).toBe(false);
      }
    },
  );
});
