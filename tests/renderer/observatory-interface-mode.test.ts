import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  readAdvancedMode,
  saveAdvancedMode,
} from '../../frontend/observatory/runtime/interface-mode';
import {
  findCommands,
  navigationWorkspaces,
  workspaceCommands,
  workspaces,
} from '../../frontend/observatory/runtime/navigation';

let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

it.each([null, 'false', 'TRUE', '1', 'invalid'])('defaults to Simple for %s', (value) => {
  if (value !== null) values.set('aegis-advanced-mode', value);
  expect(readAdvancedMode()).toBe(false);
});

it('persists explicit true and false independently of unrelated preferences', () => {
  values.set('aegis-theme', 'dark-hc');
  saveAdvancedMode(true);
  expect(readAdvancedMode()).toBe(true);
  expect(values.get('aegis-advanced-mode')).toBe('true');
  saveAdvancedMode(false);
  expect(readAdvancedMode()).toBe(false);
  expect(values.get('aegis-advanced-mode')).toBe('false');
  expect(values.get('aegis-theme')).toBe('dark-hc');
});

it('defaults safely when storage cannot be read and rejects unverified saves', () => {
  storage.getItem.mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  expect(readAdvancedMode()).toBe(false);
  expect(() => saveAdvancedMode(true)).toThrow('Storage unavailable');
  storage.getItem.mockReturnValue(null);
  expect(() => saveAdvancedMode(true)).toThrow('could not be saved');
});

it('propagates a rejected write without changing the saved mode', () => {
  storage.setItem.mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  expect(() => saveAdvancedMode(true)).toThrow('Quota exceeded');
  expect(readAdvancedMode()).toBe(false);
});

it('keeps complete routes and command aliases behind the compact Simple navigation', () => {
  expect(navigationWorkspaces(false).map(({ label }) => label)).toEqual([
    'Investigate',
    'Check files',
    'Settings',
  ]);
  expect(navigationWorkspaces(true)).toEqual(workspaces);
  const commands = workspaceCommands(false);
  expect(commands.map(({ target }) => target)).toEqual(workspaces.map(({ id }) => id));
  expect(findCommands(commands, 'home')).toMatchObject([
    { target: 'overview', label: 'Investigate' },
  ]);
  expect(findCommands(commands, 'monitoring')).toMatchObject([{ target: 'overview' }]);
  expect(findCommands(commands, 'network')[0]).toMatchObject({ target: 'network' });
});
