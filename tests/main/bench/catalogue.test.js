/**
 * @file tests/main/bench/catalogue.test.js
 * @description The catalogue's refusals are the reason a bench number can be
 *   believed, so they are what these tests are about: an event line either
 *   carries what the actor observed or it is not written at all.
 */
import { describe, it, expect } from 'vitest';

import catalogue from '../../../bench/lib/catalogue.js';

const OBSERVED_START = Object.freeze({
  timestamp: '2026-08-13T10:20:30.123Z',
  pid: 4242,
  name: 'claude.exe',
  executable: 'X:\\Future\\ESCAPE\\AEGIS\\bench\\runs\\r\\stage\\claude.exe',
  args: ['-n', '600', '127.0.0.1'],
  parentPid: 99,
});

const OBSERVED_CREATION = Object.freeze({
  timestamp: '2026-08-13T10:20:29.001Z',
  pid: 99,
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  path: 'X:\\runs\\r\\stage\\claude.exe',
  name: 'claude.exe',
  directory: 'X:\\runs\\r\\stage',
  sizeBytes: 45056,
  sha256: 'a'.repeat(64),
});

/**
 * @param {Object} [overrides]
 * @returns {Object}
 */
function startEvent(overrides = {}) {
  return catalogue.buildEvent({
    scenario: 'S1-agent-lifecycle',
    step: 'spawn-agent',
    expect: 'E2',
    shape: 'process.start',
    observed: { ...OBSERVED_START, ...overrides },
  });
}

describe('bench catalogue — line shape', () => {
  it('writes the minimal ECS subset for a process start', () => {
    const line = startEvent();
    expect(line['@timestamp']).toBe('2026-08-13T10:20:30.123Z');
    expect(line.ecs.version).toBe(catalogue.ECS_VERSION);
    expect(line.event).toEqual({
      kind: 'event',
      category: ['process'],
      type: ['start'],
      action: 'process-started',
    });
    expect(line.process).toEqual({
      pid: 4242,
      name: 'claude.exe',
      executable: OBSERVED_START.executable,
      args: ['-n', '600', '127.0.0.1'],
      start: '2026-08-13T10:20:30.123Z',
      parent: { pid: 99 },
    });
  });

  it('carries bench.scenario, bench.step and bench.expect on every line', () => {
    expect(startEvent().bench).toEqual({
      scenario: 'S1-agent-lifecycle',
      step: 'spawn-agent',
      expect: 'E2',
    });
  });

  it('never writes process.command_line — the actor never saw one', () => {
    expect(startEvent().process).not.toHaveProperty('command_line');
  });

  it('records a file event with its hash and the pid of the process that wrote it', () => {
    const line = catalogue.buildEvent({
      scenario: 'S1-agent-lifecycle',
      step: 'stage-binary',
      expect: 'E1',
      shape: 'file.creation',
      observed: OBSERVED_CREATION,
    });
    expect(line.event.category).toEqual(['file']);
    expect(line.event.type).toEqual(['creation']);
    expect(line.file).toEqual({
      path: OBSERVED_CREATION.path,
      name: 'claude.exe',
      directory: OBSERVED_CREATION.directory,
      size: 45056,
      hash: { sha256: OBSERVED_CREATION.sha256 },
    });
    expect(line.process).toEqual({ pid: 99, executable: OBSERVED_CREATION.executable });
  });

  it('writes process.exit_code when the OS gave one', () => {
    const line = catalogue.buildEvent({
      scenario: 'S1-agent-lifecycle',
      step: 'terminate-agent',
      expect: 'E3',
      shape: 'process.end',
      observed: {
        timestamp: '2026-08-13T10:21:05.500Z',
        pid: 4242,
        name: 'claude.exe',
        executable: OBSERVED_START.executable,
        exitCode: 1,
      },
    });
    expect(line.process.exit_code).toBe(1);
  });

  it('records the signal instead when the OS gave no exit code', () => {
    const line = catalogue.buildEvent({
      scenario: 'S1-agent-lifecycle',
      step: 'terminate-agent',
      expect: 'E3',
      shape: 'process.end',
      observed: {
        timestamp: '2026-08-13T10:21:05.500Z',
        pid: 4242,
        name: 'claude.exe',
        executable: OBSERVED_START.executable,
        exitCode: null,
        signal: 'SIGTERM',
      },
    });
    expect(line.process).not.toHaveProperty('exit_code');
    expect(line.bench).toEqual({
      terminationSignal: 'SIGTERM',
      scenario: 'S1-agent-lifecycle',
      step: 'terminate-agent',
      expect: 'E3',
    });
  });

  it('never lets a shape overwrite the three keys that say where a line came from', () => {
    const line = catalogue.buildEvent({
      scenario: 'S1-agent-lifecycle',
      step: 'terminate-agent',
      expect: 'E3',
      shape: 'process.end',
      observed: {
        timestamp: '2026-08-13T10:21:05.500Z',
        pid: 4242,
        name: 'claude.exe',
        executable: OBSERVED_START.executable,
        exitCode: 1,
      },
    });
    expect(line.bench.scenario).toBe('S1-agent-lifecycle');
    expect(line.bench.step).toBe('terminate-agent');
    expect(line.bench.expect).toBe('E3');
  });
});

describe('bench catalogue — refusals', () => {
  it('refuses a line whose pid was never observed, naming the field', () => {
    expect(() => startEvent({ pid: undefined })).toThrow(/observed field "pid" was not captured/);
  });

  it('refuses a pid the OS could not have handed out', () => {
    for (const pid of [0, -1, 1.5, '4242']) {
      expect(() => startEvent({ pid })).toThrow(/not a pid the OS handed out/);
    }
  });

  it('refuses a timestamp that was not read off a clock', () => {
    for (const timestamp of ['2026-08-13', 'PLACEHOLDER', '2026-08-13T10:20:30Z']) {
      expect(() => startEvent({ timestamp })).toThrow(/not a UTC instant read off a clock/);
    }
  });

  it('refuses an empty executable path', () => {
    expect(() => startEvent({ executable: '   ' })).toThrow(/observed field "executable" is empty/);
  });

  it('names the step it refused a line for', () => {
    expect(() => startEvent({ name: null })).toThrow(/for step "spawn-agent"/);
  });

  it('refuses an unknown event shape and lists the ones it knows', () => {
    expect(() =>
      catalogue.buildEvent({
        scenario: 'S1',
        step: 's',
        expect: 'E1',
        shape: 'network.connection',
        observed: OBSERVED_START,
      }),
    ).toThrow(/unknown event shape "network.connection".*process\.start/s);
  });
});

describe('bench catalogue — serialize', () => {
  it('writes one JSON document per line, newline-terminated', () => {
    const text = catalogue.serialize([startEvent(), startEvent()]);
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line).not.toContain('\n');
    }
  });

  it('renders an empty catalogue as an empty file, not as a blank line', () => {
    expect(catalogue.serialize([])).toBe('');
  });
});
