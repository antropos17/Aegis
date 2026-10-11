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

function runLogger(dir, mode) {
  const script = `
    const logger = require(process.argv[1]);
    const dir = process.argv[2];
    const mode = process.argv[3];
    logger.init({ userDataPath: dir });
    if (mode !== 'restore') logger.info('fixture', 'buffered startup entry');
    if (mode === 'early-flush') logger.flush();
    const deadline = Date.now() + 2000;
    const waitForSeed = () => {
      const seeded = logger.getStats().todayEntries >= (mode === 'restore' ? 10 : 11);
      if (!seeded) {
        if (Date.now() > deadline) process.exit(2);
        return setTimeout(waitForSeed, 5);
      }
      if (mode === 'flush') logger.flush();
      process.stdout.write(JSON.stringify(logger.getStats().todayEntries));
      // Simulate abrupt termination: no shutdown handler may flush the pending entry.
      process.exit(0);
    };
    waitForSeed();
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['-e', script, loggerPath, dir, mode], {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true,
    }),
  );
}

describe('logger durable legacy count', () => {
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
