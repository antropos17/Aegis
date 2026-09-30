import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { createModelFixture, OUTPUT } from '../../scripts/qualification/model-broker-fixture.mjs';
import { createModelOwner } from './fixtures/model-broker-owner.mjs';
const require = createRequire(import.meta.url);
const storage = require('../../src/main/operation-ledger');
const fixtures = [],
  owners = [];
afterEach(async () => {
  storage._resetForTest();
  for (const owner of owners) owner.close();
  owners.length = 0;
  for (const fixture of fixtures) await fixture.close();
  fixtures.length = 0;
});
it('withholds successful model content after actual terminal bytes are written but sync fails', async () => {
  const fixture = await createModelFixture();
  fixtures.push(fixture);
  storage._setDepsForTest({
    fs: {
      ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (args[1] !== 'wx' || !String(args[0]).endsWith('.pending')) return handle;
        return {
          stat: (...a) => handle.stat(...a),
          read: (...a) => handle.read(...a),
          write: (...a) => handle.write(...a),
          close: () => handle.close(),
          sync: async () => {
            throw Object.assign(Error('fixture'), { code: 'EIO' });
          },
        };
      },
    },
  });
  const owner = await createModelOwner(fixture);
  owners.push(owner);
  const a = owner.prepare();
  expect(await owner.broker.request(a.capability, a.prepared)).toEqual({
    schemaVersion: 1,
    state: 'outcome-unknown',
    launchAllowed: false,
  });
  expect(fixture.state.deliveries).toBe(1);
  storage._resetForTest();
  owner.close();
  const next = await createModelOwner(fixture);
  owners.push(next);
  expect(await next.ledger.inspect(a.id)).toEqual({ state: 'outcome-unknown' });
  const replay = next.prepare(a.id);
  expect((await next.broker.request(replay.capability, replay.prepared)).state).toBe('refused');
  expect(fixture.state.deliveries).toBe(1);
});

it('retains committed model output when close occurs after the E4 publication cutoff', async () => {
  const fixture = await createModelFixture();
  fixtures.push(fixture);
  let owner;
  owner = await createModelOwner(fixture, (ledger) => ({
    ...ledger,
    settle: async (...args) => {
      const terminal = await ledger.settle(...args);
      owner.close();
      return terminal;
    },
  }));
  owners.push(owner);
  const a = owner.prepare();
  expect(await owner.broker.request(a.capability, a.prepared)).toMatchObject({
    state: 'completed',
    text: OUTPUT,
  });
  expect(await owner.ledger.inspect(a.id)).toEqual({ state: 'completed' });
  expect(fixture.state.deliveries).toBe(1);
});
