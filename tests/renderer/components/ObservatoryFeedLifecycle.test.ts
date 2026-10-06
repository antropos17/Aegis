import { afterEach, expect, it, vi } from 'vitest';
import {
  createRecordKey,
  feedSnapshot,
  feedScroll,
  feedArrival,
} from '../../../frontend/observatory/runtime/activity-feed';
import type { RecordData } from '../../../frontend/observatory/runtime/host';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps legacy objects and duplicate UUID records inspectable without positional collisions', () => {
  const key = createRecordKey();
  const original: RecordData = { file: '/original.txt', timestamp: 10 };
  const other: RecordData = { file: '/other.txt', timestamp: 20 };
  const before = feedSnapshot([original, other], 'none', [], key);
  const retained = feedSnapshot([other], 'none', [], key);
  expect(retained.groups[0].key).toBe(before.groups.find((group) => group.latest === other)?.key);
  const repeated: RecordData = { eventId: 'same-event', file: '/repeat.txt' };
  const duplicate = feedSnapshot([repeated, repeated], 'none', [], key);
  expect(new Set(duplicate.groups.map((group) => group.key)).size).toBe(2);
  expect(duplicate.groups.every((group) => group.latest === repeated)).toBe(true);
});

it('recognizes equivalent reordered network snapshots without treating their keys as connection lifetimes', () => {
  const key = createRecordKey();
  const socket = (port: number): RecordData => ({
    instanceId: '42:100',
    localPort: port,
    remoteIp: '192.0.2.1',
    remotePort: 443,
    state: 'ESTABLISHED',
  });
  const before = feedSnapshot([socket(1), socket(2)], 'resource', [], key);
  const reordered = feedSnapshot([socket(2), socket(1)], 'resource', [], key);
  expect(reordered.signature).toBe(before.signature);
  expect(feedSnapshot([socket(2), socket(1)], 'none', [], key).signature).toBe(
    feedSnapshot([socket(1), socket(2)], 'none', [], key).signature,
  );
  const changed = feedSnapshot([{ ...socket(1), state: 'CLOSE_WAIT' }], 'none', [], key);
  expect(changed.groups[0].key).not.toBe(feedSnapshot([socket(1)], 'none', [], key).groups[0].key);
});

it('recognizes changed visible severity and legacy endpoint evidence in an otherwise stable record', () => {
  const key = createRecordKey();
  const row: RecordData = { eventId: 'stable-event', ip: '192.0.2.1', severity: 'low' };
  const before = feedSnapshot([row], 'none', [], key);
  expect(feedSnapshot([{ ...row, severity: 'high' }], 'none', [], key).signature).not.toBe(
    before.signature,
  );
  expect(feedSnapshot([{ ...row, ip: '192.0.2.2' }], 'none', [], key).signature).not.toBe(
    before.signature,
  );
});

it('recognizes reordered cloned network groups for different agents sharing one endpoint', () => {
  const key = createRecordKey();
  const codex: RecordData = {
    agent: 'Codex',
    instanceId: '42:100',
    remoteIp: '192.0.2.1',
    remotePort: 443,
    localPort: 8001,
  };
  const claude: RecordData = {
    ...codex,
    agent: 'Claude Code',
    instanceId: '43:100',
    localPort: 8002,
  };
  const before = feedSnapshot([codex, claude], 'resource', [], key);
  const cloned = [{ ...claude }, { ...codex }];
  const reordered = feedSnapshot(cloned, 'resource', [], key);
  expect(reordered.signature).toBe(before.signature);
  expect(before.groups[0].latest).toBe(codex);
  expect(before.groups[1].latest).toBe(claude);
  expect(reordered.groups[0].latest).toBe(cloned[0]);
  expect(reordered.groups[1].latest).toBe(cloned[1]);
});

it('captures all delivered network inspection metadata with canonical object-field ordering', () => {
  const key = createRecordKey();
  const row: RecordData = {
    instanceId: '42:100',
    remoteIp: '192.0.2.1',
    remotePort: 443,
    cwd: null,
    parentEditor: null,
    category: 'other',
    userAgent: 'node.exe',
    httpUnencrypted: false,
    details: { actor: 'Codex', directory: 'X:/project' },
  };
  const before = feedSnapshot([row], 'none', [], key);
  for (const change of [
    { cwd: 'X:/project' },
    { parentEditor: 'VS Code' },
    { category: 'agent' },
    { userAgent: 'codex.exe' },
    { httpUnencrypted: true },
  ]) {
    expect(feedSnapshot([{ ...row, ...change }], 'none', [], key).signature).not.toBe(
      before.signature,
    );
  }
  expect(
    feedSnapshot(
      [{ ...row, details: { directory: 'X:/project', actor: 'Codex' } }],
      'none',
      [],
      key,
    ).signature,
  ).toBe(before.signature);
});

it('holds a partially scrolled feed after native input while ignoring later programmatic scroll', () => {
  const root = document.createElement('div');
  root.setAttribute('data-feed-scroll', '');
  const feed = document.createElement('section');
  root.append(feed);
  document.body.append(root);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600));
  vi.spyOn(feed, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 250 - root.scrollTop, 600, 1000),
  );
  const hold = vi.fn();
  const action = feedScroll(feed, { active: true, more: false, load: vi.fn(), hold });
  try {
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    root.scrollTop = 100;
    root.dispatchEvent(new Event('scroll'));
    expect(hold).toHaveBeenCalled();
    const reviewing = hold.mock.calls.length;
    root.scrollTop = 150;
    root.dispatchEvent(new Event('scroll'));
    expect(hold).toHaveBeenCalledTimes(reviewing);
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    const following = hold.mock.calls.length;
    action.update({ active: true, more: false, load: vi.fn(), hold, following: true });
    root.scrollTop = 200;
    root.dispatchEvent(new Event('scroll'));
    expect(hold).toHaveBeenCalledTimes(following);
    action.update({ active: false, more: false, load: vi.fn(), hold });
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    root.dispatchEvent(new Event('scroll'));
    expect(hold).toHaveBeenCalledTimes(following);
    action.destroy();
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    root.dispatchEvent(new Event('scroll'));
    expect(hold).toHaveBeenCalledTimes(following);
  } finally {
    action.destroy();
    root.remove();
  }
});

it('loads near the native scroll boundary only while active and disconnects on pause and disposal', () => {
  let deliver: IntersectionObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const Observer = vi.fn(function (callback: IntersectionObserverCallback) {
    deliver = callback;
    return { observe, disconnect };
  });
  vi.stubGlobal('IntersectionObserver', Observer);
  const root = document.createElement('div');
  root.setAttribute('data-feed-scroll', '');
  const feed = document.createElement('section');
  feed.innerHTML = '<div data-feed-older></div>';
  root.append(feed);
  document.body.append(root);
  const load = vi.fn();
  const hold = vi.fn();
  const active = { active: true, more: true, load, hold };
  const action = feedScroll(feed, active);
  const intersection = () =>
    deliver?.(
      [{ isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
  try {
    intersection();
    expect(load).toHaveBeenCalledTimes(1);
    action.update({ ...active, active: false });
    intersection();
    expect(load).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    action.update(active);
    intersection();
    expect(load).toHaveBeenCalledTimes(2);
    action.update({ ...active, more: false });
    intersection();
    expect(load).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
  } finally {
    action.destroy();
    root.remove();
  }
});

it('fades only a newly visible following row and never replays a canceled arrival', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const row = document.createElement('div');
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 600, 40));
  const arrival = feedArrival(row, true);
  expect(row).toHaveClass('feed-arrival');
  arrival.update(false);
  expect(row).not.toHaveClass('feed-arrival');
  arrival.update(true);
  expect(row).not.toHaveClass('feed-arrival');
  arrival.destroy();
  const inactive = feedArrival(row, false);
  expect(row).not.toHaveClass('feed-arrival');
  inactive.destroy();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const reduced = feedArrival(row, true);
  expect(row).not.toHaveClass('feed-arrival');
  reduced.destroy();
});
