import { describe, expect, it, vi } from 'vitest';
import identity from '../../../src/main/platform/sensor-identity.js';

const BOOT = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOT = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const CONTEXT = { bootId: BOOT, bootTimeSeconds: '1700000000', clockTicks: '100' };
const ERROR = { code: 'sensor-identity-invalid', message: 'sensor-identity-invalid' };
const EMPTY = { startTime: null, rawBirth: null, witness: null, witnessSource: null };

function linux(birth = '12345', bootId = BOOT) {
  return {
    birth,
    witness: { kind: 'linux-start-ticks', bootId, startTicks: birth },
    identityError: null,
  };
}

function darwin(birth = '1700000000000123', uniqueId = '9007199254740993') {
  return {
    birth,
    witness: { kind: 'macos-unique-id', bootSessionId: BOOT, pUniqueId: uniqueId },
    identityError: null,
  };
}

function rejects(fn) {
  expect(fn).toThrowError(expect.objectContaining(ERROR));
}

describe('sensor identity observations', () => {
  it('reads only approved own data fields and ignores unrelated carrying metadata', () => {
    const getter = vi.fn(() => {
      throw Error('private');
    });
    const observation = { pid: 42, ...linux() };
    Object.defineProperty(observation, 'metadata', { get: getter });
    expect(identity.createWatchRoot(observation, { platform: 'linux' }).pid).toBe(42);
    expect(getter).not.toHaveBeenCalled();
    for (const key of ['pid', 'birth', 'witness', 'identityError']) {
      const value = { pid: 42, ...linux() };
      Object.defineProperty(value, key, { enumerable: true, get: getter });
      rejects(() => identity.createWatchRoot(value, { platform: 'linux' }));
    }
    const options = Object.defineProperty({}, 'platform', { enumerable: true, get: getter });
    rejects(() => identity.validateSensorIdentity(linux(), options));
    rejects(() => identity.createWatchRoot({ pid: 42, ...linux() }, options));
    rejects(() => identity.convertSensorIdentity(linux(), options));
    const conversion = { platform: 'linux' };
    Object.defineProperty(conversion, 'linuxContext', { enumerable: true, get: getter });
    rejects(() => identity.convertSensorIdentity(linux(), conversion));
    const witness = linux();
    Object.defineProperty(witness.witness, 'kind', { enumerable: true, get: getter });
    rejects(() => identity.validateSensorIdentity(witness));
    const context = { ...CONTEXT };
    Object.defineProperty(context, 'clockTicks', { enumerable: true, get: getter });
    rejects(() => identity.createLinuxBirthConverter(context));
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects proxy reflection, hidden/Symbol closed-shape extras and inherited identity fields', () => {
    const trap = vi.fn(() => {
      throw Error('trap');
    });
    const proxied = (value) =>
      new Proxy(value, {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      });
    rejects(() => identity.validateSensorIdentity(proxied(linux())));
    rejects(() => identity.validateSensorIdentity(linux(), proxied({ platform: 'linux' })));
    rejects(() => identity.createLinuxBirthConverter(proxied(CONTEXT)));
    expect(trap).not.toHaveBeenCalled();
    for (const key of ['hidden', Symbol('hidden')]) {
      const value = linux();
      Object.defineProperty(value.witness, key, { value: 1 });
      rejects(() => identity.validateSensorIdentity(value));
      const context = { ...CONTEXT };
      Object.defineProperty(context, key, { value: 1 });
      rejects(() => identity.createLinuxBirthConverter(context));
    }
    rejects(() => identity.validateSensorIdentity(Object.create(linux())));
    expect(identity.validateSensorIdentity(Object.assign(Object.create(null), linux()))).toEqual(
      linux(),
    );
  });
  it('copies precise raw observations without rounding or sharing witnesses', () => {
    for (const observation of [linux('9007199254740993'), darwin()]) {
      const checked = identity.validateSensorIdentity(observation);
      expect(checked).toEqual(observation);
      expect(checked).not.toBe(observation);
      expect(checked.witness).not.toBe(observation.witness);
      observation.witness.kind = 'changed';
      expect(checked.witness.kind).not.toBe('changed');
    }
  });

  it.each(['read-failed', 'process-gone', 'not-supported'])(
    'keeps a valid %s unavailable observation distinct from malformed identity',
    (identityError) => {
      const observation = { birth: null, witness: null, identityError };
      expect(identity.validateSensorIdentity(observation)).toEqual(observation);
      expect(identity.convertSensorIdentity(observation, { platform: 'linux' })).toEqual(EMPTY);
      expect(identity.convertSensorIdentity(observation, { platform: 'darwin' })).toEqual(EMPTY);
      const stale = {
        ...observation,
        pid: 4,
        startTime: 1700000000000,
        rawBirth: '12345',
        generationWitness: `${BOOT}:12345`,
      };
      identity.convertSensorIdentity(
        { pid: 4, ...linux() },
        { platform: 'linux', linuxContext: CONTEXT },
      );
      expect(identity.convertSensorIdentity(stale, { platform: 'linux' })).toEqual(EMPTY);
      rejects(() => identity.createWatchRoot({ pid: 4, ...observation }, { platform: 'linux' }));
    },
  );

  it.each([
    null,
    [],
    {},
    { birth: null, witness: null, identityError: null },
    { birth: null, witness: null, identityError: 'secret process path' },
    { ...linux(), identityError: 'read-failed' },
    { ...linux(), witness: null },
    { ...linux(), birth: null },
    { ...linux(), identityError: undefined },
    { ...linux(), witness: { ...linux().witness, startTicks: '12346' } },
    { ...linux(), witness: { ...linux().witness, bootId: OTHER_BOOT.toUpperCase() } },
    { ...linux(), witness: { ...linux().witness, extra: 'secret' } },
    { ...darwin(), witness: { ...darwin().witness, pUniqueId: '0' } },
    { ...darwin(), witness: { ...darwin().witness, bootSessionId: 'invalid' } },
    { ...darwin(), witness: { ...darwin().witness, kind: 'unknown' } },
  ])('rejects contradictory or malformed observation %# with a fixed code', (value) => {
    rejects(() => identity.validateSensorIdentity(value));
  });

  it.each([
    '',
    '00',
    '01',
    '-1',
    '+1',
    '1.0',
    '1e3',
    ' 1',
    '1\n',
    '18446744073709551616',
    12345,
    1n,
  ])('rejects non-u64 birth %#', (birth) => {
    rejects(() => identity.validateSensorIdentity(linux(birth)));
    rejects(() => identity.validateSensorIdentity(darwin(birth)));
  });

  it('accepts raw zero and the exact u64 maximum without weakening unique IDs', () => {
    for (const birth of ['0', '18446744073709551615']) {
      expect(identity.validateSensorIdentity(linux(birth)).birth).toBe(birth);
      expect(identity.validateSensorIdentity(darwin(birth)).birth).toBe(birth);
    }
    expect(
      identity.convertSensorIdentity(linux('0'), { platform: 'linux', linuxContext: CONTEXT })
        .startTime,
    ).toBe(1700000000000);
    rejects(() => identity.convertSensorIdentity(darwin('0'), { platform: 'darwin' }));
  });

  it('requires matching explicit platforms and never infers a runtime conversion platform', () => {
    rejects(() => identity.validateSensorIdentity(linux(), { platform: 'darwin' }));
    rejects(() => identity.validateSensorIdentity(darwin(), { platform: 'linux' }));
    rejects(() => identity.validateSensorIdentity(linux(), { platform: 'win32' }));
    rejects(() => identity.createWatchRoot({ pid: 4, ...linux() }));
    rejects(() => identity.convertSensorIdentity(linux(), { linuxContext: CONTEXT }));
    for (const options of [null, 'linux', 1, []]) {
      rejects(() => identity.validateSensorIdentity(linux(), options));
      rejects(() => identity.createWatchRoot({ pid: 4, ...linux() }, options));
      rejects(() => identity.convertSensorIdentity(linux(), options));
    }
  });
});

describe('carrying observations to roots and runtime identity', () => {
  it('retains distinct witnesses when raw births occupy the same epoch millisecond', () => {
    const first = identity.convertSensorIdentity(darwin('1700000000000123'), {
      platform: 'darwin',
    });
    const second = identity.convertSensorIdentity(darwin('1700000000000999', '9007199254740994'), {
      platform: 'darwin',
    });
    expect(first).toEqual({
      startTime: 1700000000000,
      rawBirth: '1700000000000123',
      witness: `${BOOT}:9007199254740993`,
      witnessSource: 'macosUniqueId',
    });
    expect(second.startTime).toBe(first.startTime);
    expect(second.witness).toBe(`${BOOT}:9007199254740994`);
    const nextBoot = darwin();
    nextBoot.witness.bootSessionId = OTHER_BOOT;
    expect(identity.convertSensorIdentity(nextBoot, { platform: 'darwin' }).witness).toBe(
      `${OTHER_BOOT}:9007199254740993`,
    );
    const options = { platform: 'linux', linuxContext: { ...CONTEXT, clockTicks: '10000' } };
    const a = identity.convertSensorIdentity(linux('12340'), options);
    const b = identity.convertSensorIdentity(linux('12341'), options);
    expect(a.startTime).toBe(1700000001234);
    expect(b.startTime).toBe(a.startTime);
    expect(b.witness).toBe(`${BOOT}:12341`);
    expect(b.witness).not.toBe(a.witness);
  });

  it('creates roots from raw carrying fields and strips unrelated event metadata', () => {
    const observation = {
      pid: 42,
      ...linux('9007199254740993'),
      instanceId: '42:1',
      startTime: 1,
      name: 'sensitive',
    };
    const root = identity.createWatchRoot(observation, { platform: 'linux' });
    expect(root).toEqual({
      pid: 42,
      birth: '9007199254740993',
      witness: linux('9007199254740993').witness,
    });
    observation.witness.startTicks = '1';
    expect(root.witness.startTicks).toBe('9007199254740993');
    rejects(() =>
      identity.createWatchRoot(
        { pid: 42, startTime: 1700000000000, instanceId: '42:1700000000000' },
        { platform: 'linux' },
      ),
    );
    expect(
      identity.createWatchRoot({ pid: 2147483647, ...darwin() }, { platform: 'darwin' }).pid,
    ).toBe(2147483647);
  });

  it.each([0, -1, 1.5, 2147483648, '42', NaN, Infinity])('rejects root PID %#', (pid) => {
    rejects(() => identity.createWatchRoot({ pid, ...linux() }, { platform: 'linux' }));
  });

  it('binds Linux conversion to the host boot and ignores a peer clock anchor', () => {
    const observation = { ...linux(), clockAnchor: { unixUsec: '1' } };
    expect(
      identity.convertSensorIdentity(observation, { platform: 'linux', linuxContext: CONTEXT }),
    ).toEqual({
      startTime: 1700000123450,
      rawBirth: '12345',
      witness: `${BOOT}:12345`,
      witnessSource: 'linuxStartTicks',
    });
    rejects(() =>
      identity.convertSensorIdentity(linux('12345', OTHER_BOOT), {
        platform: 'linux',
        linuxContext: CONTEXT,
      }),
    );
    rejects(() => identity.convertSensorIdentity(observation, { platform: 'linux' }));
  });

  it('normalizes greater-than-2^53 microseconds with integer division and safe result checks', () => {
    expect(
      identity.convertSensorIdentity(darwin('9007199254740999'), { platform: 'darwin' }).startTime,
    ).toBe(9007199254740);
    expect(
      identity.convertSensorIdentity(darwin('9007199254740991999'), { platform: 'darwin' })
        .startTime,
    ).toBe(Number.MAX_SAFE_INTEGER);
    rejects(() =>
      identity.convertSensorIdentity(darwin('9007199254740992000'), { platform: 'darwin' }),
    );
  });
});

describe('pure Linux D1 converter', () => {
  it('captures a copied context, uses fresh ticks and preserves BigInt precision', () => {
    const context = { ...CONTEXT, clockTicks: '1000000' };
    const convert = identity.createLinuxBirthConverter(context);
    context.bootTimeSeconds = '1';
    context.clockTicks = '1';
    expect(convert('9007199254740999')).toBe(10707199254740);
    expect(convert(9007199254741000n)).toBe(10707199254741);
    expect(convert(0n)).toBe(1700000000000);
    expect(convert('12345')).toBe(1700000000012);
  });

  it('keeps accepted procfs ticks beyond wire u64 when their quotient is safe', () => {
    const convert = identity.createLinuxBirthConverter({
      ...CONTEXT,
      clockTicks: '9007199254740991',
    });
    expect(convert(18446744073709551616n)).toBe(1700002048000);
    expect(convert('18446744073709551616')).toBe(1700002048000);
    rejects(() => identity.validateSensorIdentity(linux('18446744073709551616')));
  });

  it.each([
    null,
    {},
    { ...CONTEXT, extra: true },
    { ...CONTEXT, bootId: 'bad' },
    { ...CONTEXT, bootTimeSeconds: '0' },
    { ...CONTEXT, bootTimeSeconds: 1700000000 },
    { ...CONTEXT, clockTicks: '0' },
    { ...CONTEXT, clockTicks: '0100' },
    { ...CONTEXT, clockTicks: '1e2' },
    { ...CONTEXT, clockTicks: '9007199254740992' },
    { ...CONTEXT, bootTimeSeconds: '9007199254740992' },
  ])('rejects malformed host context %#', (context) => {
    rejects(() => identity.createLinuxBirthConverter(context));
  });

  it('bounds converted milliseconds and rejects noncanonical or negative fresh ticks', () => {
    const convert = identity.createLinuxBirthConverter(CONTEXT);
    expect(convert('900549925474099')).toBe(Number.MAX_SAFE_INTEGER - 1);
    rejects(() => convert('900549925474100'));
    for (const ticks of [-1n, 12345, '01', '-1', '1e2', '']) rejects(() => convert(ticks));
    rejects(() =>
      identity.createLinuxBirthConverter({ ...CONTEXT, bootTimeSeconds: '9007199254741' })('0'),
    );
    expect(
      identity.createLinuxBirthConverter({ ...CONTEXT, bootTimeSeconds: '1', clockTicks: '3' })(
        '1',
      ),
    ).toBe(1333);
  });
});
