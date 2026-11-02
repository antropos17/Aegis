import { describe, expect, it, vi } from 'vitest';
import { displayedRisk } from '../../scripts/qualification/windows-native-read-support.mjs';

const actor = {
  agent: 'Aider',
  pid: 4242,
  instanceId: '4242:1655526400000',
  createTime100ns: '133000000000000000',
  instanceIdSource: 'os',
};
const identity = {
  pid: actor.pid,
  instanceId: actor.instanceId,
  createTime100ns: actor.createTime100ns,
};
const snapshot = () => ({
  readiness: { populationReliable: true, identityDegraded: false, monitoringPaused: false },
  agents: [structuredClone(actor)],
});

function fixture({
  before = snapshot(),
  after = snapshot(),
  meta,
  text,
  selected,
  scope,
  state,
} = {}) {
  const app = {
    evaluate: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
  };
  const row = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    locator: (selector) => ({
      innerText: async () =>
        selector === '.roster-meta'
          ? (meta ?? '1 worker process · Observed now')
          : (text ?? '15/100'),
    }),
  };
  const worker = {
    selectOption: vi.fn().mockResolvedValue([actor.instanceId]),
    inputValue: vi.fn().mockResolvedValue(selected ?? actor.instanceId),
  };
  const header = {
    getByRole: () => worker,
    locator: (selector) => ({
      innerText: async () => {
        if (selector === '.observed-state') return state ?? 'Observed now';
        if (selector === '.risk-scope') return scope ?? 'This process · PID 4242';
        return text ?? '15/100';
      },
    }),
  };
  return { page: { locator: () => row, getByRole: () => header }, app, worker };
}

describe('native-read displayed risk belongs to the fixture process', () => {
  it('binds the visible one-worker score to exact OS identity on both sides', async () => {
    const { page, app, worker } = fixture();
    await expect(displayedRisk(page, app, actor)).resolves.toMatchObject({
      score: 15,
      workerCount: 1,
      actorBefore: identity,
      actorAfter: identity,
      displayedInstanceId: actor.instanceId,
      displayedPid: actor.pid,
      observedNow: true,
    });
    expect(app.evaluate).toHaveBeenCalledTimes(2);
    expect(worker.selectOption).toHaveBeenCalledWith(actor.instanceId, { timeout: 10000 });
  });

  it.each(['before', 'after'])('refuses another Aider in the %s population', async (phase) => {
    const population = snapshot();
    population.agents.push({ ...actor, pid: 9000, instanceId: '9000:1655526400000' });
    const { page, app } = fixture({ [phase]: population });
    await expect(displayedRisk(page, app, actor)).rejects.toThrow('risk actor');
  });

  it.each(['pid', 'instanceId', 'createTime100ns'])(
    'refuses a changed %s even when the grouped score is higher',
    async (key) => {
      const after = snapshot();
      after.agents[0][key] = key === 'pid' ? 9999 : actor[key] + '1';
      const { page, app } = fixture({ after });
      await expect(displayedRisk(page, app, actor)).rejects.toThrow('risk actor');
    },
  );

  it('refuses same-millisecond replacement birth without changing the instance key', async () => {
    const after = snapshot();
    after.agents[0].createTime100ns = '133000000000000001';
    const { page, app } = fixture({ after });
    await expect(displayedRisk(page, app, actor)).rejects.toThrow('risk actor');
  });

  it.each([
    ['populationReliable', false],
    ['identityDegraded', true],
    ['monitoringPaused', true],
  ])('refuses an unqualified %s observation', async (key, value) => {
    const before = snapshot();
    before.readiness[key] = value;
    const { page, app } = fixture({ before });
    await expect(displayedRisk(page, app, actor)).rejects.toThrow('risk actor');
  });

  it('refuses a capped population that could omit a competing Aider', async () => {
    const before = snapshot();
    before.agents.push(
      ...Array.from({ length: 127 }, (_, index) => ({ agent: 'Other', pid: index + 1 })),
    );
    const { page, app } = fixture({ before });
    await expect(displayedRisk(page, app, actor)).rejects.toThrow('risk actor');
  });

  it.each(['2 worker processes · Observed now', '1 worker process · Last snapshot'])(
    'refuses ambiguous or retained visible status: %s',
    async (meta) => {
      const { page, app } = fixture({ meta });
      await expect(displayedRisk(page, app, actor)).rejects.toThrow('Displayed actor');
    },
  );

  it('refuses an unknown actor witness before observing any score', async () => {
    const { page, app } = fixture();
    await expect(displayedRisk(page, app, { ...actor, createTime100ns: null })).rejects.toThrow(
      'risk actor',
    );
  });

  it.each([
    { selected: 'another-instance' },
    { scope: 'Highest process score · PID 4242' },
    { scope: 'This process · PID 9999' },
    { state: 'Last reliable observation' },
  ])('refuses a different, grouped or stale visible process %j', async (options) => {
    const { page, app } = fixture(options);
    await expect(displayedRisk(page, app, actor)).rejects.toThrow('Displayed');
  });
});
