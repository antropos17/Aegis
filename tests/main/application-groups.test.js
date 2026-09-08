import { describe, expect, it } from 'vitest';
import groups from '../../src/main/application-groups.js';
import utils from '../../src/main/process-utils.js';

function agent(pid, name = 'ChatGPT Desktop', birth = pid * 1000) {
  return {
    agent: name,
    process: 'ChatGPT.exe',
    pid,
    startTime: birth,
    instanceId: `${pid}:${birth}`,
    instanceIdSource: 'os',
  };
}
function observe(agents, parents = {}) {
  return new Map(
    agents.map((a) => [
      a.pid,
      { name: a.process, ppid: parents[a.pid] || 0, startTime: a.startTime },
    ]),
  );
}

describe('application process groups', () => {
  it('combines six desktop children with their root without removing any identity', () => {
    const agents = Array.from({ length: 7 }, (_, i) => agent(i + 1));
    const identities = agents.map((a) => a.instanceId);
    groups.annotateApplicationGroups(
      agents,
      observe(agents, { 2: 1, 3: 2, 4: 1, 5: 1, 6: 1, 7: 2 }),
    );
    expect(agents).toHaveLength(7);
    expect(agents.map((a) => a.instanceId)).toEqual(identities);
    for (const row of agents)
      expect(row.applicationGroup).toEqual({ id: 'app:1:1000', rootPid: 1, processCount: 7 });
  });

  it('keeps independent Codex launches separate under the same shell', () => {
    const agents = [agent(2, 'Codex'), agent(3, 'Codex'), agent(4, 'Codex')];
    const map = observe(agents, { 2: 1, 3: 1, 4: 2 });
    map.set(1, { ppid: 0, name: 'pwsh.exe', startTime: 1 });
    groups.annotateApplicationGroups(agents, map);
    expect(agents.map((a) => a.applicationGroup.rootPid)).toEqual([2, 3, 2]);
    expect(agents.map((a) => a.applicationGroup.processCount)).toEqual([2, 1, 2]);
  });

  it('walks an unmatched intermediary but stops at a different detected tool', () => {
    const agents = [agent(1), agent(3), agent(4, 'Codex'), agent(5)];
    const map = observe(agents, { 3: 2, 4: 1, 5: 4 });
    map.set(2, { ppid: 1, name: 'helper.exe', startTime: 2000 });
    groups.annotateApplicationGroups(agents, map);
    expect(agents.map((a) => a.applicationGroup.rootPid)).toEqual([1, 1, 4, 5]);
  });

  it('refuses an edge to a parent PID reused after the child was born', () => {
    const agents = [agent(1, 'Codex', 5000), agent(2, 'Codex', 2000)];
    groups.annotateApplicationGroups(agents, observe(agents, { 2: 1 }));
    expect(agents.map((a) => a.applicationGroup.rootPid)).toEqual([1, 2]);
  });

  it('never uses old grouping across an outage or after the root disappears', () => {
    const agents = [agent(1), agent(2)];
    const map = observe(agents, { 2: 1 });
    groups.annotateApplicationGroups(agents, map);
    groups.annotateApplicationGroups(agents, undefined);
    expect(agents.every((a) => a.applicationGroup === undefined)).toBe(true);
    map.delete(1);
    groups.annotateApplicationGroups(agents.slice(1), map);
    expect(agents[1].applicationGroup).toEqual({ id: 'app:2:2000', rootPid: 2, processCount: 1 });
  });

  it('leaves synthetic, mismatched and unknown births ungrouped', () => {
    const agents = [agent(0), agent(1), agent(2), agent(3)];
    agents[0].instanceIdSource = 'synthetic';
    agents[1].instanceIdSource = 'unknown';
    const map = observe(agents);
    map.get(2).startTime = null;
    map.get(3).startTime += 1;
    groups.annotateApplicationGroups(agents, map);
    expect(agents.every((a) => a.applicationGroup === undefined)).toBe(true);
  });

  it('rejects cyclic ancestry instead of manufacturing a root', () => {
    const agents = [agent(1, 'Codex', 1000), agent(2, 'Codex', 1000)];
    groups.annotateApplicationGroups(agents, observe(agents, { 1: 2, 2: 1 }));
    expect(agents.every((a) => a.applicationGroup === undefined)).toBe(true);
  });

  it('bounds deep ancestry work', () => {
    const agents = [agent(100)];
    const map = new Map(
      Array.from({ length: 100 }, (_, i) => [i + 1, { ppid: i, startTime: i + 1 }]),
    );
    map.get(100).startTime = agents[0].startTime;
    groups.annotateApplicationGroups(agents, map);
    expect(agents[0].applicationGroup).toBeUndefined();
  });

  it('publishes metadata through real enrichment using only the supplied fresh observation', async () => {
    utils._resetForTest();
    utils._setPlatformForTest({
      providesStartTime: true,
      getParentProcessMap: () => {
        throw Error('extra observation');
      },
    });
    try {
      const agents = [agent(1), agent(2)];
      const map = observe(agents, { 2: 1 });
      await utils.enrichWithParentChains(agents, { processMap: map });
      expect(agents.map((a) => a.applicationGroup.id)).toEqual(['app:1:1000', 'app:1:1000']);
      map.get(1).startTime = 3000;
      await utils.enrichWithParentChains(agents, { processMap: map });
      expect(agents.map((a) => a.applicationGroup.id)).toEqual(['app:1:3000', 'app:2:2000']);
      await utils.enrichWithParentChains(agents, { processMap: new Map() });
      expect(agents.every((a) => a.applicationGroup === undefined)).toBe(true);
    } finally {
      utils._resetForTest();
    }
  });
});
