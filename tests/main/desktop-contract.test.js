import { describe, expect, it } from 'vitest';
import { desktopPassed, monitoringPassed } from '../../tools/development/desktop-contract.mjs';

const fixture = () => {
  const flags = { cleanupUnknown: false, guiEnrollment: false, launchAllowed: false };
  const live = { ...flags, state: 'running', rootAlive: true, released: true, activeProcesses: 4 };
  const stopped = {
    ...flags,
    state: 'stopped',
    rootAlive: false,
    activeProcesses: 0,
    profileDataRetained: true,
  };
  return {
    passed: true,
    phase: 'complete',
    modeledAuthority: true,
    guiEnrollment: false,
    launchAllowed: false,
    closureConfirmed: true,
    chromiumProfileCreated: true,
    sameEpochRetryRefused: true,
    window: { Visible: true, ImageHasContent: true, Width: 1280, Height: 800 },
    start: { ...live },
    query: { ...live },
    stop: { ...stopped },
    afterStop: { ...stopped },
    finalStop: { ...stopped },
  };
};
describe('packaged desktop evidence boundary', () => {
  it('accepts a visible multiprocess lifecycle only with final original Job closure', () => {
    expect(desktopPassed(fixture())).toBe(true);
    expect(desktopPassed({ passed: true })).toBe(false);
  });
  it.each(['stop', 'afterStop', 'finalStop'])(
    'rejects descendants or unknown cleanup at %s',
    (key) => {
      const result = fixture();
      result[key].activeProcesses = 1;
      expect(desktopPassed(result)).toBe(false);
      result[key].activeProcesses = 0;
      result[key].cleanupUnknown = true;
      expect(desktopPassed(result)).toBe(false);
    },
  );
  it('does not promote missing windows, a single stub process or privilege acceptance', () => {
    for (const mutate of [
      (x) => {
        x.window.Visible = false;
      },
      (x) => {
        x.query.activeProcesses = 1;
      },
      (x) => {
        x.window.ImageHasContent = false;
      },
      (x) => {
        x.query.rootAlive = false;
      },
      (x) => {
        x.launchAllowed = true;
      },
      (x) => {
        x.start.guiEnrollment = true;
      },
      (x) => {
        x.closureConfirmed = false;
      },
      (x) => {
        x.chromiumProfileCreated = false;
      },
      (x) => {
        x.sameEpochRetryRefused = false;
      },
    ]) {
      const result = fixture();
      mutate(result);
      expect(desktopPassed(result)).toBe(false);
    }
  });
});

it('requires sustained fresh packaged monitoring, process lifecycle and cleanup evidence', () => {
  const result = {
    status: 'PASS',
    packaged: true,
    snapshotClass: 'class5',
    fixtureDetected: true,
    fixtureSelectable: true,
    fixtureExited: true,
    pauseRetained: true,
    resumeExpired: true,
    closureConfirmed: true,
    warmupObservedMs: 85000,
    batchCount: 4,
    batches: [{}, {}, {}, {}],
    samples: [
      { at: 1, label: 'Live' },
      { at: 85001, label: 'Scanning' },
    ],
  };
  expect(monitoringPassed(result)).toBe(true);
  for (const patch of [
    { packaged: false },
    { snapshotClass: 'cim' },
    { fixtureSelectable: false },
    { fixtureExited: false },
    { pauseRetained: false },
    { resumeExpired: false },
    { closureConfirmed: false },
    { appCleanupUnconfirmed: true },
    { fixtureCleanupUnconfirmed: true },
    { batchCount: 1 },
    { samples: [] },
    { warmupObservedMs: 1000 },
    {
      samples: [
        { at: 1, label: 'Live' },
        { at: 85001, label: 'Observation unavailable / stale' },
      ],
    },
  ]) {
    expect(monitoringPassed({ ...result, ...patch })).toBe(false);
  }
});
