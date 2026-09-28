import { describe, expect, it } from 'vitest';
import { createVmSession } from '../../scripts/qualification/vm-session.mjs';
import { deferred, evidence, key, syntheticFixture } from '../fixtures/vm-synthetic-backend.mjs';
import { encodeVmFrame } from '../../scripts/qualification/vm-wire.mjs';

describe('synthetic VM admission and cleanup', () => {
  it('uses fresh cleanup signals after canceling admission', async () => {
    const fixture = syntheticFixture();
    const inspect = fixture.backend.inspect;
    fixture.backend.inspect = async (registration, args) => {
      if (args.signal.aborted) throw new Error('canceled');
      return inspect(registration, args);
    };
    const session = createVmSession(fixture.options);
    await session.prepare();
    expect((await session.stop()).state).toBe('stopped');
  });

  it('allows stop before preparation and never starts afterward', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession(fixture.options);
    await session.stop();
    await expect(session.prepare()).rejects.toThrow();
    expect(fixture.calls).not.toContain('start');
  });
  it('orders durable intents, independent observations and one fixed fixture release', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession(fixture.options);
    await expect(session.release()).rejects.toThrow();
    expect((await session.prepare()).fixtureReleaseAllowed).toBe(true);
    expect(fixture.calls).toEqual(['inspect', 'start', 'inspect', 'receive', 'inspect']);
    expect(fixture.events).toEqual(['created', 'start-intent', 'ready']);
    expect((await session.release()).state).toBe('running');
    await expect(session.release()).rejects.toThrow();
    expect(fixture.calls.filter((value) => value === 'release')).toHaveLength(1);
    expect((await session.stop()).state).toBe('stopped');
    await expect(session.prepare()).rejects.toThrow();
    expect(session.snapshot()).toMatchObject({
      launchAllowed: false,
      nativeContainmentQualified: false,
      pendingOperations: 0,
    });
  });

  it.each(['vmId', 'epoch', 'configSha256', 'pendingOperations', 'state'])(
    'refuses the wrong observed %s before start',
    async (field) => {
      const fixture = syntheticFixture();
      fixture.observed[field] = field === 'pendingOperations' ? 1 : 'wrong';
      const session = createVmSession(fixture.options);
      await expect(session.prepare()).rejects.toThrow('vm-admission-unavailable');
      expect(fixture.calls).not.toContain('start');
      expect(fixture.calls).not.toContain('release');
      expect(session.snapshot().state).toBe(field === 'state' ? 'stopped' : 'cleanup-unknown');
    },
  );

  it.each(['start', 'receive', 'inspect-after-start'])(
    'denies admission after a failed %s and confirms cleanup separately',
    async (failure) => {
      const fixture = syntheticFixture();
      if (failure === 'inspect-after-start') {
        const inspect = fixture.backend.inspect;
        fixture.backend.inspect = async (...args) => {
          if (fixture.observed.state === 'running') throw new Error('lost');
          return inspect(...args);
        };
      } else
        fixture.backend[failure] = async () => {
          throw new Error('fixture');
        };
      const session = createVmSession(fixture.options);
      await expect(session.prepare()).rejects.toThrow();
      expect(session.snapshot().state).toBe('stopped');
      expect(fixture.calls).not.toContain('release');
    },
  );

  it('rejects authenticated evidence from the wrong principal and does not release payload', async () => {
    const fixture = syntheticFixture();
    fixture.backend.receive = async (_, { challenge }) =>
      encodeVmFrame(key, evidence(challenge, { principalSha256: '2'.repeat(64) }));
    const session = createVmSession(fixture.options);
    await expect(session.prepare()).rejects.toThrow();
    expect(fixture.calls).not.toContain('release');
    expect(session.snapshot().state).toBe('stopped');
  });

  it('rechecks configuration after evidence and again at release', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession(fixture.options);
    await session.prepare();
    fixture.observed.configSha256 = '2'.repeat(64);
    await expect(session.release()).rejects.toThrow();
    expect(fixture.calls).not.toContain('release');
    expect(session.snapshot().state).toBe('cleanup-unknown');
  });

  it.each(['start-intent', 'ready', 'release-intent', 'stopped'])(
    'retains uncertainty after journal failure at %s',
    async (event) => {
      const fixture = syntheticFixture();
      fixture.options.journal.append = (value) => {
        if (value === event) throw new Error('full');
        fixture.events.push(value);
      };
      const session = createVmSession(fixture.options);
      if (event === 'start-intent' || event === 'ready')
        await expect(session.prepare()).rejects.toThrow();
      else {
        await session.prepare();
        if (event === 'release-intent') await expect(session.release()).rejects.toThrow();
        else await session.stop();
      }
      expect(session.snapshot().state).toBe('cleanup-unknown');
      if (event === 'start-intent') expect(fixture.calls).not.toContain('start');
      expect(fixture.calls).not.toContain('release');
      expect(fixture.calls).toContain('stop');
    },
  );

  it('does not report stopped while an earlier start can still complete', async () => {
    const fixture = syntheticFixture();
    const entered = deferred();
    const late = deferred();
    fixture.backend.start = async () => {
      entered.resolve();
      await late.promise;
      fixture.observed.state = 'running';
    };
    const session = createVmSession(fixture.options);
    const preparing = session.prepare();
    const rejected = expect(preparing).rejects.toThrow();
    await entered.promise;
    expect((await session.stop()).state).toBe('cleanup-unknown');
    expect(session.snapshot().pendingOperations).toBe(1);
    late.resolve();
    await rejected;
    expect(fixture.calls.filter((value) => value === 'stop')).toHaveLength(2);
    expect(fixture.observed.state).toBe('off');
    expect(session.snapshot().state).toBe('stopped');
    expect(fixture.calls).not.toContain('release');
  });

  it('cancels an in-flight release and cleans up after its late completion', async () => {
    const fixture = syntheticFixture();
    const entered = deferred();
    const late = deferred();
    fixture.backend.release = async (_, { signal }) => {
      entered.resolve(signal);
      await late.promise;
    };
    const session = createVmSession(fixture.options);
    await session.prepare();
    const releasing = session.release();
    const rejected = expect(releasing).rejects.toThrow();
    const signal = await entered.promise;
    expect((await session.stop()).state).toBe('cleanup-unknown');
    expect(signal.aborted).toBe(true);
    late.resolve();
    await rejected;
    expect(fixture.events).not.toContain('released');
    expect(session.snapshot().state).toBe('stopped');
  });

  it('retains unresolved timed-out backend work until a fresh stop confirms closure', async () => {
    const fixture = syntheticFixture();
    const late = deferred();
    fixture.backend.start = async () => {
      await late.promise;
      fixture.observed.state = 'running';
    };
    const session = createVmSession(fixture.options);
    await expect(session.prepare()).rejects.toThrow();
    expect(session.snapshot()).toMatchObject({ state: 'cleanup-unknown', pendingOperations: 1 });
    late.resolve();
    await late.promise;
    await Promise.resolve();
    expect((await session.stop()).state).toBe('stopped');
  });

  it('does not accept a guest exit or broken observer as confirmed VM stop', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession(fixture.options);
    await session.prepare();
    fixture.backend.inspect = async () => {
      throw new Error('observer-lost');
    };
    expect((await session.stop()).state).toBe('cleanup-unknown');
    expect(session.snapshot().fixtureReleaseAllowed).toBe(false);
  });

  it('retains independently reported backend jobs after the caller promise settles', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession(fixture.options);
    await session.prepare();
    fixture.observed.pendingOperations = 1;
    expect((await session.stop()).state).toBe('cleanup-unknown');
    expect(session.snapshot().pendingOperations).toBe(0);
    fixture.observed.pendingOperations = 0;
    expect((await session.stop()).state).toBe('stopped');
  });

  it('retains a timed-out stop itself as outstanding work', async () => {
    const fixture = syntheticFixture();
    const late = deferred();
    const session = createVmSession(fixture.options);
    await session.prepare();
    fixture.backend.stop = async () => {
      await late.promise;
      fixture.observed.state = 'off';
    };
    expect((await session.stop()).state).toBe('cleanup-unknown');
    expect(session.snapshot().pendingOperations).toBe(1);
    late.resolve();
    await late.promise;
    await Promise.resolve();
    expect((await session.stop()).state).toBe('stopped');
  });

  it('does not resume from recovered registration and shares concurrent stop work', async () => {
    const fixture = syntheticFixture();
    const session = createVmSession({ ...fixture.options, recovery: true });
    await expect(session.prepare()).rejects.toThrow();
    await expect(session.release()).rejects.toThrow();
    await Promise.all([session.stop(), session.stop()]);
    expect(fixture.calls.filter((value) => value === 'stop')).toHaveLength(1);
    expect(fixture.calls).not.toContain('start');
    expect(session.snapshot().state).toBe('stopped');
  });

  it('refuses backend substitution and isolates mutable registration pins', async () => {
    const fixture = syntheticFixture();
    expect(() =>
      createVmSession({ ...fixture.options, backend: { ...fixture.backend, kind: 'native' } }),
    ).toThrow();
    const session = createVmSession(fixture.options);
    fixture.options.identity.vmId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    fixture.options.pins.configSha256 = '2'.repeat(64);
    await session.prepare();
    await session.stop();
    expect(session.snapshot().state).toBe('stopped');
  });
});
