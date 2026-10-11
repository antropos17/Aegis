import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const loggerPath = fileURLToPath(new URL('../../src/main/logger.js', import.meta.url));
const fixtures = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function runLogger(dir, mode, legacyCount = 10) {
  const script = `
    const logger = require(process.argv[1]);
    const dir = process.argv[2];
    const mode = process.argv[3];
    const legacyCount = Number(process.argv[4]);
    logger.init({ userDataPath: dir });
    if (mode !== 'restore') logger.info('fixture', 'buffered startup entry');
    if (mode === 'early-flush' || mode === 'early-flush-again') logger.flush();
    const deadline = Date.now() + 2000;
    const waitForSeed = () => {
      const seeded = logger.getStats().todayEntries >= legacyCount + (mode === 'restore' ? 0 : 1);
      if (!seeded) {
        if (Date.now() > deadline) process.exit(2);
        return setTimeout(waitForSeed, 5);
      }
      if (mode === 'flush') logger.flush();
      if (mode === 'early-flush-again') {
        logger.info('fixture', 'entry after legacy scan');
        logger.flush();
      }
      process.stdout.write(JSON.stringify(logger.getStats().todayEntries));
      // Simulate abrupt termination: no shutdown handler may flush the pending entry.
      process.exit(0);
    };
    waitForSeed();
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['-e', script, loggerPath, dir, mode, String(legacyCount)], {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true,
    }),
  );
}

describe('logger durable legacy count', () => {
  it.each([
    ['append', 10, '{"message":"legacy"}\n'],
    ['rotate', 42, JSON.stringify({ message: 'x'.repeat(50_000) }) + '\n'],
  ])(
    'preserves a legacy snapshot during startup %s and a fresh-process reopen',
    (_, activeCount, line) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-logger-durable-'));
      fixtures.push(dir);
      const logDir = path.join(dir, 'logs');
      fs.mkdirSync(logDir);
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      fs.writeFileSync(
        path.join(logDir, `aegis-${day}.1.log`),
        '{"message":"legacy"}\n'.repeat(10),
      );
      fs.writeFileSync(path.join(logDir, `aegis-${day}.log`), line.repeat(activeCount));

      const expected = activeCount + 12;
      const liveCount = runLogger(dir, 'early-flush-again', activeCount + 10);
      const retained = fs
        .readdirSync(logDir)
        .filter((name) => name.endsWith('.log'))
        .flatMap((name) => fs.readFileSync(path.join(logDir, name), 'utf-8').trim().split('\n'));
      expect(retained).toHaveLength(expected);
      expect(runLogger(dir, 'restore', expected)).toBe(expected);
      expect(liveCount).toBe(expected);
    },
  );

  it.each([
    ['crash', 10],
    ['flush', 11],
    ['early-flush', 11],
  ])('restores only persisted entries after %s in a fresh process', (mode, durable) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-logger-durable-'));
    fixtures.push(dir);
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const file = path.join(logDir, `aegis-${day}.log`);
    fs.writeFileSync(file, '{"message":"durable fixture"}\n'.repeat(10));

    expect(runLogger(dir, mode)).toBe(11);
    expect(fs.readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(durable);
    expect(runLogger(dir, 'restore')).toBe(durable);
  });
});
