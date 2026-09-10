import { measured, type Telemetry } from './host';

export type StatsSection = 'overview' | 'processes' | 'activity' | 'tokens' | 'sensors';
export interface StatsMetric {
  id: string;
  label: string;
  unit: string;
  description: string;
  sections: StatsSection[];
  floor?: number;
}
export const statisticsTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'processes', label: 'Processes' },
  { id: 'activity', label: 'Activity' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'sensors', label: 'Sensors' },
];
export const statisticsMetrics: StatsMetric[] = [
  {
    id: 'cpu',
    label: 'Measured agent CPU',
    unit: '%',
    description:
      'Measured current processes as a share of total machine CPU capacity. Coverage shows how many exact process identities contributed; missing processes are excluded, never assumed idle. Collection time is when AEGIS finished reading the providers. Cached readings retain their time; mixed collections show their span.',
    sections: ['overview', 'processes'],
    floor: 100,
  },
  {
    id: 'memory',
    label: 'Measured agent memory',
    unit: 'MB',
    description:
      'Resident memory of measured current processes. Coverage identifies missing processes; shared pages may be counted in more than one process. Collection time describes the completed provider read, not an exact OS sampling instant.',
    sections: ['overview', 'processes'],
  },
  {
    id: 'processes',
    label: 'Processes',
    unit: '',
    description:
      'Observed agent processes in the latest reliable population. Includes supported synthetic runtime observations.',
    sections: ['overview', 'processes'],
  },
  {
    id: 'products',
    label: 'Agent products',
    unit: '',
    description: 'Distinct agent groups in the latest reliable population.',
    sections: ['processes'],
  },
  {
    id: 'connections',
    label: 'Connections',
    unit: '',
    description:
      'Entries in the latest delivered connection snapshot. This is a count, not network throughput; the bridge does not provide a per-snapshot timestamp.',
    sections: ['overview', 'activity'],
  },
  {
    id: 'fileRate',
    label: 'File observations',
    unit: '/min',
    description:
      'Delivered observations per minute between reliable process scans, including display-history evictions. Resource and token deliveries do not change the sampling interval.',
    sections: ['overview', 'activity'],
  },
  {
    id: 'sensitiveRate',
    label: 'Sensitive observations',
    unit: '/min',
    description:
      'Sensitive observations delivered between reliable process scans, including evicted sensitive records, per minute. Initial history, counter resets and observation gaps have no rate.',
    sections: ['activity'],
  },
  {
    id: 'risk',
    label: 'Highest agent risk',
    unit: '/100',
    description:
      'Highest current agent risk score. This is an assessment of observed evidence, not a CPU or performance measurement.',
    sections: ['activity'],
    floor: 100,
  },
  {
    id: 'tokens',
    label: 'Accumulated tokens',
    unit: '',
    description:
      'Accumulated supported-log measurements for current exact process identities. Coverage shows measured processes; unsupported processes do not erase measured usage. A changing population changes this subtotal.',
    sections: ['tokens'],
  },
  {
    id: 'input',
    label: 'Input tokens',
    unit: '',
    description:
      'Accumulated input tokens from measured current process identities, with explicit coverage.',
    sections: ['tokens'],
  },
  {
    id: 'output',
    label: 'Output tokens',
    unit: '',
    description:
      'Accumulated output tokens from measured current process identities, with explicit coverage.',
    sections: ['tokens'],
  },
  {
    id: 'tokenRate',
    label: 'Token arrival rate',
    unit: '/min',
    description:
      'Change in measured supported-log counters between token deliveries, per minute. A changed measured identity set, counter reset or observation gap interrupts the rate.',
    sections: ['tokens'],
  },
  {
    id: 'cost',
    label: 'Estimated cost',
    unit: 'USD',
    description:
      'Local pricing estimate for the current process population. Model pricing may be incomplete or out of date; this is not a provider bill.',
    sections: ['tokens'],
  },
  {
    id: 'ownCpu',
    label: 'AEGIS CPU',
    unit: '%',
    description:
      'AEGIS main-process CPU time divided by elapsed wall time. One fully used CPU core is 100%; this differs from agent CPU capacity normalization.',
    sections: ['sensors'],
  },
  {
    id: 'ownMemory',
    label: 'AEGIS memory',
    unit: 'MB',
    description:
      'Resident memory of the AEGIS main process. Renderer and helper processes are not included.',
    sections: ['sensors'],
  },
  {
    id: 'ownHeap',
    label: 'AEGIS JavaScript heap',
    unit: 'MB',
    description: 'Used JavaScript heap in the AEGIS main process.',
    sections: ['sensors'],
  },
  {
    id: 'evictions',
    label: 'Display evictions',
    unit: '',
    description:
      'Cumulative records removed from this window’s bounded history. This is display retention, not sensor or audit loss.',
    sections: ['sensors'],
  },
];
/** Format a measured graph value without converting unavailable values to zero.
 * @param value Measurement @param unit Unit @returns Display text @since 0.14.1
 */
export function statisticsValue(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const number = value.toLocaleString(undefined, {
    maximumFractionDigits:
      unit === 'USD' ? 4 : unit === '%' || unit === 'MB' || unit === '/min' ? 1 : 0,
  });
  return unit === 'USD' ? '$' + number : number + (unit ? ' ' + unit : '');
}
/** Sum only exact, unique, fully measured current process identities.
 * @param state Current population @param rows Measurement rows @param key Field @returns Complete sum or unavailable @since 0.14.1
 */
export function completeStatisticsTotal(
  state: Telemetry,
  rows: Record<string, unknown>[],
  key: string,
): number | null {
  if (state.stale || !state.ready || !state.agents.length) return null;
  const ids = state.agents.map((agent) => agent.instanceId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  let total = 0;
  for (const id of ids) {
    const matches = rows.filter((row) => row.instanceId === id);
    const value = matches.length === 1 ? measured(matches[0][key]) : null;
    if (value === null || value < 0) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

export interface StatisticsCoverage {
  measured: number;
  total: number;
}
export interface StatisticsMeasurement extends StatisticsCoverage {
  value: number | null;
  counters: Record<string, number>;
}
/** Sum measured current identities, preserving missing coverage separately.
 * @param state Population @param rows Source rows @param key Field
 * @returns Measured subtotal and exact coverage @since 0.14.1
 */
export function measuredStatisticsTotal(
  state: Telemetry,
  rows: Record<string, unknown>[],
  key: string,
): StatisticsMeasurement {
  const ids = new Set(
    state.agents.map((agent) => agent.instanceId).filter((id): id is string => !!id),
  );
  const total = ids.size + state.agents.filter((agent) => !agent.instanceId).length;
  const counters: Record<string, number> = {};
  if (state.stale || !state.ready) return { value: null, measured: 0, total, counters };
  for (const id of ids) {
    const matches = rows.filter((row) => row.instanceId === id);
    const value = matches.length === 1 ? measured(matches[0][key]) : null;
    if (value !== null && value >= 0) counters[id] = value;
  }
  const values = Object.values(counters);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    value: (values.length || total === 0) && Number.isFinite(sum) ? sum : null,
    measured: values.length,
    total,
    counters,
  };
}
