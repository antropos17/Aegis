import { expect, it } from 'vitest';
import { resourceVisual } from '../../frontend/observatory/runtime/resource-visual';

it('uses the final filename across Windows and POSIX paths, including extensionless configuration', () => {
  expect(resourceVisual({ file: 'C:\\project\\src\\Main.TS' })).toEqual(
    resourceVisual({ path: '/project/src/main.ts' }),
  );
  expect(resourceVisual({ file: '', path: '/project/.env.local' }).label).toBe(
    'Configuration file',
  );
  expect(resourceVisual({ file: '/directory.json/unknown' }).label).toBe('File');
});

it('keeps unknown resources generic and does not infer a directory from an extensionless name', () => {
  expect(resourceVisual({}).label).toBe('Activity');
  expect(resourceVisual({ file: '/workspace/README' }).label).toBe('File');
  expect(resourceVisual({ file: '/workspace/' }).label).toBe('Folder');
  expect(resourceVisual({ file: 'C:\\workspace', isDirectory: true }).label).toBe('Folder');
});

it('distinguishes domain, IPv6 address and missing endpoint metadata without asserting verification', () => {
  expect(resourceVisual({ domain: 'api.example.test', remoteIp: '2001:db8::1' }).label).toBe(
    'Domain name',
  );
  expect(resourceVisual({ domain: ' ', remoteIp: '2001:db8::1' }).label).toBe('IP address');
  expect(resourceVisual({ type: 'network-connection' }).label).toBe('Network destination');
  for (const verdict of ['flagged', 'allowlisted', 'unknown']) {
    expect(resourceVisual({ remoteIp: '2001:db8::1', verdict })).toEqual(
      resourceVisual({ remoteIp: '2001:db8::1' }),
    );
  }
});

it('keeps resource categories independent of sensitivity and ownership', () => {
  const file = { file: '/project/config.json' };
  expect(resourceVisual({ ...file, sensitive: true, agent: 'Codex' })).toEqual(
    resourceVisual(file),
  );
  expect(resourceVisual({ file: '/home/me/.agents/skills/review/SKILL.md' }).label).toBe('Skill');
});
