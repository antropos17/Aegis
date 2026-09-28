import { describe, expect, it } from 'vitest';
import { createVmSession } from '../../scripts/qualification/vm-session.mjs';
import { deferred, syntheticFixture } from '../fixtures/vm-synthetic-backend.mjs';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function lateMutation(name) {
  const fixture = syntheticFixture();
  const entered = deferred();
  const complete = deferred();
  fixture.backend[name] = async () => {
    fixture.calls.push(name);
    entered.resolve();
    await complete.promise;
    fixture.observed.state = 'running';
  };
  return { fixture, entered, complete };
}

async function begin(session, name) {
  if (name === 'release') await session.prepare();
  const work = name === 'start' ? session.prepare() : session.release();
  return {
    failure: work.then(
      () => null,
      (error) => error,
    ),
  };
}

describe('synthetic VM observation and mutation ordering', () => {
  it.each(['start', 'release'])(
    'refuses a delayed off snapshot captured before a late %s settles',
    async (name) => {
      const { fixture, entered, complete } = lateMutation(name);
      fixture.options.timeoutMs = 1000;
      const observationEntered = deferred();
      const deliver = deferred();
      const inspect = fixture.backend.inspect;
      const stop = fixture.backend.stop;
      let stopping = false;
      let delayed = false;
      fixture.backend.stop = async (...args) => {
        stopping = true;
        return stop(...args);
      };
      fixture.backend.inspect = async (...args) => {
        const captured = await inspect(...args);
        if (stopping && !delayed) {
          delayed = true;
          observationEntered.resolve();
          await deliver.promise;
        }
        return captured;
      };
      const session = createVmSession(fixture.options);
      const { failure } = await begin(session, name);
      await entered.promise;
      const stoppingWork = session.stop();
      const first = await Promise.race([
        stoppingWork.then((result) => ({ result })),
        observationEntered.promise.then(() => ({ inspecting: true })),
      ]);
      try {
        if (first.result) {
          expect(first.result.state).toBe('cleanup-unknown');
          expect(fixture.events).not.toContain('stopped');
          expect(first.result.pendingOperations).toBe(1);
        }
        complete.resolve();
        await nextTurn();
        expect(session.snapshot().pendingOperations).toBe(0);
        deliver.resolve();
        expect((await stoppingWork).state).toBe('cleanup-unknown');
        expect(await failure).toBeInstanceOf(Error);
        expect(session.snapshot().state).toBe('stopped');
        expect(fixture.observed.state).toBe('off');
        expect(fixture.calls.filter((call) => call === 'stop')).toHaveLength(2);
        expect((await session.stop()).state).toBe('stopped');
        expect(fixture.calls.filter((call) => call === 'stop')).toHaveLength(2);
        expect(fixture.events).not.toContain('released');
      } finally {
        complete.resolve();
        deliver.resolve();
        await failure;
        await stoppingWork;
      }
    },
  );

  it.each(['start', 'release'])(
    'retries cleanup after a timed-out %s completes behind the canceled caller',
    async (name) => {
      const { fixture, entered, complete } = lateMutation(name);
      const session = createVmSession(fixture.options);
      const { failure } = await begin(session, name);
      await entered.promise;
      expect((await session.stop()).state).toBe('cleanup-unknown');
      expect(await failure).toBeInstanceOf(Error);
      expect(session.snapshot().pendingOperations).toBe(1);
      expect(fixture.events).not.toContain('stopped');
      complete.resolve();
      await nextTurn();
      expect(fixture.observed.state).toBe('running');
      expect(session.snapshot()).toMatchObject({ state: 'cleanup-unknown', pendingOperations: 0 });
      const before = fixture.calls.filter((call) => call === 'stop').length;
      expect((await session.stop()).state).toBe('stopped');
      expect(fixture.calls.filter((call) => call === 'stop')).toHaveLength(before + 1);
      expect(fixture.observed.state).toBe('off');
      expect(fixture.events).not.toContain('released');
    },
  );

  it.each(['start', 'release'])(
    'keeps cleanup unknown after a journal failure and a late %s',
    async (name) => {
      const { fixture, entered, complete } = lateMutation(name);
      fixture.options.timeoutMs = 1000;
      fixture.options.journal.append = (event) => {
        if (event === 'stop-intent') throw new Error('full');
        fixture.events.push(event);
      };
      const session = createVmSession(fixture.options);
      const { failure } = await begin(session, name);
      await entered.promise;
      expect((await session.stop()).state).toBe('cleanup-unknown');
      complete.resolve();
      expect(await failure).toBeInstanceOf(Error);
      expect(session.snapshot().state).toBe('cleanup-unknown');
      expect(fixture.observed.state).toBe('off');
      expect(fixture.events).not.toContain('stopped');
      expect((await session.stop()).state).toBe('cleanup-unknown');
    },
  );

  it.each(['initial', 'after-start', 'after-evidence', 'before-release'])(
    'cancels admission while the %s running-state observation is delayed',
    async (point) => {
      const fixture = syntheticFixture();
      fixture.options.timeoutMs = 1000;
      const entered = deferred();
      const deliver = deferred();
      const inspect = fixture.backend.inspect;
      let count = 0;
      const delayedIndex = {
        initial: 1,
        'after-start': 2,
        'after-evidence': 3,
        'before-release': 4,
      };
      fixture.backend.inspect = async (...args) => {
        const captured = await inspect(...args);
        if (++count === delayedIndex[point]) {
          entered.resolve();
          await deliver.promise;
        }
        return captured;
      };
      const session = createVmSession(fixture.options);
      if (point === 'before-release') await session.prepare();
      const work = point === 'before-release' ? session.release() : session.prepare();
      const failure = work.then(
        () => null,
        (error) => error,
      );
      await entered.promise;
      const stop = session.stop();
      const sameStop = session.stop();
      expect(sameStop).toBe(stop);
      expect((await stop).state).toBe('stopped');
      deliver.resolve();
      expect(await failure).toBeInstanceOf(Error);
      expect(session.snapshot()).toMatchObject({ state: 'stopped', fixtureReleaseAllowed: false });
      expect(fixture.calls).not.toContain('release');
      expect(fixture.events).not.toContain('released');
      if (point !== 'before-release') expect(fixture.events).not.toContain('ready');
      if (point === 'initial') expect(fixture.calls).not.toContain('start');
      expect(fixture.calls.filter((call) => call === 'stop')).toHaveLength(1);
    },
  );
});
